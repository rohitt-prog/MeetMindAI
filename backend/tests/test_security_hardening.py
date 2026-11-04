"""
MeetMind AI — Phase 12 Security Hardening Test Suite
Verifies:
1. Per-user sliding-window rate limiting on billable/heavy endpoints (/analyze, /clarify, PDF export)
2. HTTP 429 response structure, Retry-After header, and X-RateLimit headers
3. User isolation (quotas strictly keyed by verified Firebase UID)
4. Unauthenticated callers blocked with 401 without consuming user quotas
5. Request body byte ceiling enforcement (HTTP 413 for Content-Length and streaming chunks > 1 MiB)
6. Pydantic schema length constraints (HTTP 422 for transcript > 100k, title > 200, answer > 2k)
7. Safe error response sanitization (no internal leaks or str(e) in production)
8. Defensive HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP)
9. Production configuration validation (rejection of wildcards, localhost, disabled auth, missing keys)
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.core.config import Settings, settings
from app.core.auth import get_current_user, AuthenticatedUser
from app.core.rate_limit import (
    rate_limiter,
    create_rate_limiter,
    parse_rate_spec,
    InMemoryRateLimiter,
    RedisRateLimiter,
    sanitize_redis_url,
    LUA_SLIDING_WINDOW_RATE_LIMIT,
)
from app.services.gemini_service import (
    gemini_service,
    GeminiAnalysisError,
    GeminiConfigError,
)
from app.services.firebase_service import firebase_service
from app.schemas.meeting import (
    MeetingAnalysisRequest,
    MeetingClarificationRequest,
    ClarificationAnswer,
    MeetingAnalysisResponse,
    MeetingPdfExportRequest,
)

client = TestClient(app)

MOCK_ANALYSIS_RESPONSE = {
    "meeting_id": "m_hardening_123",
    "summary": "Engineering sync discussing rate limiting and security headers.",
    "discussion_points": ["Payload size limits", "Security headers"],
    "decisions": ["Ceiling set to 1 MiB"],
    "action_items": [
        {
            "id": "action_1",
            "task": "Deploy rate limiting",
            "owner": "Security Team",
            "deadline": "Friday",
            "status": "pending",
        }
    ],
    "clarification_required": False,
    "clarification_question": None,
    "clarifications": [
        {
            "id": "clarif_1",
            "category": "ownership",
            "original_statement": "Deploy rate limiting by Friday",
            "explanation": "Clarified owner",
            "question": "Who deploys it?",
            "related_action_item_id": "action_1",
            "resolved": True,
        }
    ],
    "open_follow_ups": [],
}


# ==============================================================================
# 1. Rate Limiting Tests
# ==============================================================================

def test_parse_rate_spec():
    """Verifies parsing of rate limit strings."""
    assert parse_rate_spec("10/minute") == (10, 60, "minute")
    assert parse_rate_spec("5/second") == (5, 1, "second")
    assert parse_rate_spec("100/hour") == (100, 3600, "hour")
    assert parse_rate_spec("500/day") == (500, 86400, "day")

    with pytest.raises(ValueError):
        parse_rate_spec("invalid_spec")

    with pytest.raises(ValueError):
        parse_rate_spec("10/decade")


def test_in_memory_rate_limiter_logic():
    """Unit test for sliding window math in InMemoryRateLimiter."""
    limiter = InMemoryRateLimiter()
    key = "test_user_key"

    # 2 requests allowed in 60s
    allowed, retry_after, rem, limit, reset_at = limiter.check_rate_limit(key, 2, 60, now=1000.0)
    assert allowed is True
    assert rem == 1

    allowed, retry_after, rem, limit, reset_at = limiter.check_rate_limit(key, 2, 60, now=1010.0)
    assert allowed is True
    assert rem == 0

    # 3rd request rejected
    allowed, retry_after, rem, limit, reset_at = limiter.check_rate_limit(key, 2, 60, now=1020.0)
    assert allowed is False
    assert retry_after == 40  # 1000 + 60 - 1020 = 40
    assert rem == 0


def test_in_memory_rate_limiter_stale_key_cleanup():
    """
    Verifies that InMemoryRateLimiter purges stale per-user keys whose records
    are older than the active window, preventing unbounded dictionary growth.
    """
    limiter = InMemoryRateLimiter(cleanup_interval_seconds=10.0)

    # 3 users make requests at t=1000
    limiter.check_rate_limit("user_1", limit=5, window_seconds=60, now=1000.0)
    limiter.check_rate_limit("user_2", limit=5, window_seconds=60, now=1000.0)
    limiter.check_rate_limit("user_3", limit=5, window_seconds=60, now=1000.0)
    assert len(limiter._history) == 3

    # At t=1070 (70s later), user_1's and user_2's timestamps are outside the 60s window
    # user_3 makes a fresh request at t=1070
    limiter.check_rate_limit("user_3", limit=5, window_seconds=60, now=1070.0)

    # user_1 and user_2 were idle past the window and should be purged
    assert "user_1" not in limiter._history
    assert "user_2" not in limiter._history
    assert "user_3" in limiter._history
    assert len(limiter._history) == 1


def test_in_memory_rate_limiter_max_keys_bounding():
    """
    Verifies that when key count exceeds max_keys, InMemoryRateLimiter
    strictly bounds dictionary size and evicts excess keys.
    """
    limiter = InMemoryRateLimiter(max_keys=5, cleanup_interval_seconds=3600.0)

    # Populate 8 keys
    for i in range(8):
        limiter.check_rate_limit(f"user_{i}", limit=5, window_seconds=60, now=1000.0)

    # Max keys ceiling should be enforced
    assert len(limiter._history) <= 5


def test_in_memory_rate_limiter_concurrent_access_and_cleanup():
    """
    Verifies concurrency safety of InMemoryRateLimiter under concurrent multi-threaded load
    with concurrent key insertion and periodic cleanup.
    """
    import concurrent.futures

    limiter = InMemoryRateLimiter(max_keys=50, cleanup_interval_seconds=0.01)

    def worker(i):
        key = f"thread_user_{i % 20}"
        limiter.check_rate_limit(key, limit=10, window_seconds=60, now=1000.0 + (i * 0.1))
        if i % 5 == 0:
            limiter.cleanup_stale_keys(now=1000.0 + (i * 0.1), max_stale_age=1.0)
        return True

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(worker, range(100)))

    assert all(results)
    assert len(limiter._history) <= 50


def test_rate_limit_analyze_enforced():
    """
    Verifies that POST /api/meetings/analyze enforces rate limiting and returns
    HTTP 429 with Retry-After header and X-RateLimit headers.
    """
    mock_gemini = MagicMock()
    mock_gemini.analyze_transcript.return_value = MeetingAnalysisResponse(**MOCK_ANALYSIS_RESPONSE)

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "RATE_LIMIT_ANALYZE", "2/minute"):
        rate_limiter.reset()

        # Request 1: allowed
        res1 = client.post("/api/meetings/analyze", json={"transcript": "Meeting discussion notes..."})
        assert res1.status_code == 200
        assert res1.headers.get("X-RateLimit-Limit") == "2"
        assert res1.headers.get("X-RateLimit-Remaining") == "1"

        # Request 2: allowed
        res2 = client.post("/api/meetings/analyze", json={"transcript": "Meeting discussion notes..."})
        assert res2.status_code == 200
        assert res2.headers.get("X-RateLimit-Limit") == "2"
        assert res2.headers.get("X-RateLimit-Remaining") == "0"

        # Request 3: blocked by rate limiter
        res3 = client.post("/api/meetings/analyze", json={"transcript": "Meeting discussion notes..."})
        assert res3.status_code == 429
        assert "Rate limit exceeded" in res3.json()["detail"]
        assert "Retry-After" in res3.headers
        assert int(res3.headers["Retry-After"]) >= 1
        assert res3.headers.get("X-RateLimit-Remaining") == "0"


def test_rate_limit_user_isolation():
    """
    Verifies that rate limits are strictly isolated by authenticated UID:
    User A exhausting their quota does NOT affect User B.
    """
    mock_gemini = MagicMock()
    mock_gemini.analyze_transcript.return_value = MeetingAnalysisResponse(**MOCK_ANALYSIS_RESPONSE)

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "RATE_LIMIT_ANALYZE", "1/minute"):
        rate_limiter.reset()

        # User A makes 1 request
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="user_A", email="a@test.com", name="User A", email_verified=True
        )
        res_a1 = client.post("/api/meetings/analyze", json={"transcript": "User A notes"})
        assert res_a1.status_code == 200

        # User A makes second request -> 429
        res_a2 = client.post("/api/meetings/analyze", json={"transcript": "User A notes again"})
        assert res_a2.status_code == 429

        # Switch to User B -> should succeed (quota not consumed)
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="user_B", email="b@test.com", name="User B", email_verified=True
        )
        res_b = client.post("/api/meetings/analyze", json={"transcript": "User B notes"})
        assert res_b.status_code == 200


def test_unauthenticated_requests_do_not_consume_quota():
    """
    Verifies that unauthenticated callers are rejected with 401 before rate
    limit dependency evaluation, preventing quota depletion.
    """
    # Remove auth override so auth middleware runs
    app.dependency_overrides.pop(get_current_user, None)
    rate_limiter.reset()

    # Unauthenticated request fails with 401
    res = client.post("/api/meetings/analyze", json={"transcript": "No auth token"})
    assert res.status_code == 401

    # In-memory limiter should have recorded 0 requests
    assert len(rate_limiter._history) == 0


def test_rate_limit_clarify_enforced():
    """Verifies that POST /api/meetings/clarify enforces rate limiting."""
    mock_gemini = MagicMock()
    mock_gemini.resolve_clarifications.return_value = MeetingAnalysisResponse(**MOCK_ANALYSIS_RESPONSE)

    clarify_payload = {
        "analysis": MOCK_ANALYSIS_RESPONSE,
        "answers": [{"clarification_id": "clarif_1", "answer": "Security team will deploy it."}],
    }

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "RATE_LIMIT_CLARIFY", "1/minute"):
        rate_limiter.reset()

        res1 = client.post("/api/meetings/clarify", json=clarify_payload)
        assert res1.status_code == 200

        res2 = client.post("/api/meetings/clarify", json=clarify_payload)
        assert res2.status_code == 429
        assert "Retry-After" in res2.headers


def test_rate_limit_pdf_export_enforced():
    """Verifies that PDF export endpoints enforce RATE_LIMIT_PDF."""
    pdf_payload = {
        "title": "Rate Limit Test",
        "transcript": "Test notes",
        "analysis": MOCK_ANALYSIS_RESPONSE,
    }

    with patch.object(settings, "RATE_LIMIT_PDF", "1/minute"):
        rate_limiter.reset()

        # Request 1: allowed
        res1 = client.post("/api/meetings/export/pdf", json=pdf_payload)
        assert res1.status_code == 200
        assert res1.headers.get("content-type") == "application/pdf"

        # Request 2: blocked
        res2 = client.post("/api/meetings/export/pdf", json=pdf_payload)
        assert res2.status_code == 429
        assert "Retry-After" in res2.headers


def test_redis_rate_limiter_lua_allowed():
    """
    Verifies that RedisRateLimiter correctly processes an allowed response
    returned by the atomic Lua script.
    """
    mock_redis = MagicMock()
    mock_script = MagicMock()
    # Lua script returns: {allowed (1), retry_after (0), remaining (4), reset_at (1060)}
    mock_script.return_value = [1, 0, 4, 1060]
    mock_redis.register_script.return_value = mock_script

    with patch.dict("sys.modules", {"redis": MagicMock()}):
        limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=False)
        limiter._redis = mock_redis
        limiter._script = mock_script

        allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
            key="test_key", limit=5, window_seconds=60, now=1000.0
        )
        assert allowed is True
        assert retry_after == 0
        assert remaining == 4
        assert limit == 5
        assert reset_at == 1060
        mock_script.assert_called_once()
        call_kwargs = mock_script.call_args.kwargs
        assert call_kwargs["keys"] == ["meetmind:ratelimit:test_key"]
        assert call_kwargs["args"][0] == 1000.0
        assert call_kwargs["args"][1] == 60
        assert call_kwargs["args"][2] == 5


def test_redis_rate_limiter_lua_rejected_and_retry_after():
    """
    Verifies that RedisRateLimiter correctly processes a rejected response
    from the Lua script with Retry-After calculation.
    """
    mock_redis = MagicMock()
    mock_script = MagicMock()
    # Lua script returns: {allowed (0), retry_after (35), remaining (0), reset_at (1060)}
    mock_script.return_value = [0, 35, 0, 1060]
    mock_redis.register_script.return_value = mock_script

    with patch.dict("sys.modules", {"redis": MagicMock()}):
        limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=False)
        limiter._redis = mock_redis
        limiter._script = mock_script

        allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
            key="test_key", limit=5, window_seconds=60, now=1025.0
        )
        assert allowed is False
        assert retry_after == 35
        assert remaining == 0
        assert limit == 5
        assert reset_at == 1060


def test_redis_rate_limiter_unique_member_per_request():
    """
    Verifies that every check_rate_limit invocation generates a unique sorted-set member,
    ensuring that simultaneous requests at the exact same timestamp never overwrite each other.
    """
    mock_redis = MagicMock()
    mock_script = MagicMock()
    mock_script.return_value = [1, 0, 4, 1060]
    mock_redis.register_script.return_value = mock_script

    with patch.dict("sys.modules", {"redis": MagicMock()}):
        limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=False)
        limiter._redis = mock_redis
        limiter._script = mock_script

        # Two calls at the exact same timestamp
        limiter.check_rate_limit(key="user_race", limit=5, window_seconds=60, now=1000.0)
        limiter.check_rate_limit(key="user_race", limit=5, window_seconds=60, now=1000.0)

        assert mock_script.call_count == 2
        member_1 = mock_script.call_args_list[0].kwargs["args"][3]
        member_2 = mock_script.call_args_list[1].kwargs["args"][3]

        assert member_1 != member_2, "Simultaneous requests must generate unique sorted-set members"
        assert member_1.startswith("1000.0:")
        assert member_2.startswith("1000.0:")


def test_redis_rate_limiter_script_failure_in_development_falls_back():
    """
    Verifies that in development (fail_closed=False), a Redis script evaluation failure
    falls back cleanly to the in-memory limiter without interrupting local development.
    """
    mock_redis = MagicMock()
    mock_script = MagicMock()
    mock_script.side_effect = RuntimeError("Redis connection broken")

    with patch.dict("sys.modules", {"redis": MagicMock()}):
        limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=False)
        limiter._redis = mock_redis
        limiter._script = mock_script

        allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
            key="test_dev_fallback", limit=3, window_seconds=60, now=1000.0
        )
        assert allowed is True
        assert remaining == 2
        assert limit == 3


def test_redis_rate_limiter_script_failure_in_production_fails_closed():
    """
    Verifies that in production (fail_closed=True), a Redis script evaluation failure
    fails closed (blocks request) rather than silently allowing unmetered access.
    """
    mock_redis = MagicMock()
    mock_script = MagicMock()
    mock_script.side_effect = RuntimeError("Redis connection broken")

    with patch.dict("sys.modules", {"redis": MagicMock()}):
        limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=True)
        limiter._redis = mock_redis
        limiter._script = mock_script

        allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
            key="test_prod_fail_closed", limit=3, window_seconds=60, now=1000.0
        )
        assert allowed is False
        assert retry_after == 60
        assert remaining == 0
        assert limit == 3


def test_redis_rate_limiter_unavailable_in_production_fails_closed():
    """
    Verifies that when Redis connection is unavailable in production (fail_closed=True),
    requests are blocked to protect multi-instance quotas.
    """
    limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=True)
    limiter._redis = None

    allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
        key="test_prod_unavail", limit=5, window_seconds=60, now=1000.0
    )
    assert allowed is False
    assert retry_after == 60
    assert remaining == 0
    assert reset_at == 1060


def test_redis_rate_limiter_unavailable_in_development_falls_back():
    """
    Verifies that when Redis connection is unavailable in development (fail_closed=False),
    requests fall back to in-memory rate limiting.
    """
    limiter = RedisRateLimiter(redis_url="redis://localhost:6379/0", fail_closed=False)
    limiter._redis = None

    allowed, retry_after, remaining, limit, reset_at = limiter.check_rate_limit(
        key="test_dev_unavail", limit=5, window_seconds=60, now=1000.0
    )
    assert allowed is True
    assert remaining == 4


def test_sanitize_redis_url_credential_and_query_redaction():
    """
    Verifies that sanitize_redis_url thoroughly redacts userinfo credentials
    and sensitive query parameters (auth, password, token, key) while preserving
    safe configuration parameters.
    """
    # Userinfo password
    assert sanitize_redis_url("redis://:secret123@redis.internal:6379/0") == "redis://***@redis.internal:6379/0"
    assert sanitize_redis_url("redis://admin:superpassword@10.0.0.1:6379/2") == "redis://admin:***@10.0.0.1:6379/2"

    # Query string password, token, auth, and api_key
    res1 = sanitize_redis_url("redis://localhost:6379/0?password=secretquery&timeout=5")
    assert "password=REDACTED" in res1
    assert "secretquery" not in res1
    assert "timeout=5" in res1

    res2 = sanitize_redis_url("rediss://cluster.local:6380/0?auth=token123&client_cert=cert.pem&ssl=true")
    assert "auth=REDACTED" in res2
    assert "client_cert=REDACTED" in res2
    assert "token123" not in res2
    assert "ssl=true" in res2

    res3 = sanitize_redis_url("redis://admin:p%40ss@host:6379?api_key=key_xyz&secret_token=tok_abc")
    assert "admin:***" in res3
    assert "p%40ss" not in res3
    assert "api_key=REDACTED" in res3
    assert "secret_token=REDACTED" in res3
    assert "key_xyz" not in res3
    assert "tok_abc" not in res3

    # Safe URLs and edge cases
    assert sanitize_redis_url("redis://localhost:6379/0") == "redis://localhost:6379/0"
    assert sanitize_redis_url("redis://localhost:6379/0?db=1&max_connections=10") == "redis://localhost:6379/0?db=1&max_connections=10"
    assert sanitize_redis_url(None) == ""
    assert sanitize_redis_url("") == ""
    assert sanitize_redis_url("not a valid url ://") == "[REDACTED_REDIS_URL]"


def test_real_redis_concurrency_if_available():
    """
    Concurrency integration test against a live Redis instance if reachable.
    Verifies atomic Lua script guarantees under high concurrent load.
    Skips cleanly if Redis is not installed or unreachable.
    """
    try:
        import redis
        r = redis.Redis.from_url("redis://localhost:6379/0", socket_connect_timeout=0.2)
        r.ping()
    except Exception:
        pytest.skip("Live Redis server not available at localhost:6379, skipping live concurrency test.")

    import concurrent.futures
    limiter = RedisRateLimiter("redis://localhost:6379/0", fail_closed=True)
    limiter.reset()

    key = "concurrent_test_key"
    limit = 5
    window = 60

    # 15 concurrent worker threads attempting to consume quota simultaneously
    def attempt_request(_):
        allowed, _, _, _, _ = limiter.check_rate_limit(key, limit=limit, window_seconds=window)
        return allowed

    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        results = list(executor.map(attempt_request, range(15)))

    allowed_count = sum(1 for r in results if r is True)
    rejected_count = sum(1 for r in results if r is False)

    assert allowed_count == limit, f"Expected exactly {limit} allowed requests, got {allowed_count}"
    assert rejected_count == 10, f"Expected exactly 10 rejected requests, got {rejected_count}"


# ==============================================================================
# 2. Request and Payload Size Limit Tests
# ==============================================================================

def test_content_length_exceeding_1mib_rejected_with_413():
    """
    Verifies that requests with Content-Length > 1 MiB are rejected upfront
    with HTTP 413 Payload Too Large before reaching route handlers.
    """
    headers = {"Content-Length": str(1_048_577), "Content-Type": "application/json"}
    res = client.post("/api/meetings/analyze", headers=headers, content=b"{}")
    assert res.status_code == 413
    assert "Payload Too Large" in res.json()["detail"]


def test_chunked_streaming_payload_exceeding_1mib_rejected_with_413():
    """
    Verifies that streaming or chunked payloads that exceed 1 MiB are rejected
    with HTTP 413 via the metered receive wrapper.
    """
    large_payload = b"X" * (1_048_576 + 100)
    # Post without content-length header to test streaming receive metering
    res = client.post(
        "/api/meetings/analyze",
        headers={"Content-Type": "text/plain"},
        content=large_payload,
    )
    assert res.status_code == 413
    assert "Payload Too Large" in res.json()["detail"]


def test_transcript_exceeding_100k_chars_rejected_with_422():
    """
    Verifies that transcripts exceeding 100,000 characters fail Pydantic validation
    with HTTP 422 Unprocessable Entity.
    """
    oversized_transcript = "A" * 100_001
    res = client.post(
        "/api/meetings/analyze",
        json={"transcript": oversized_transcript},
    )
    assert res.status_code == 422
    assert any("transcript" in str(err) for err in res.json().get("detail", []))


def test_title_exceeding_200_chars_rejected_with_422():
    """
    Verifies that meeting titles exceeding 200 characters fail Pydantic validation
    with HTTP 422.
    """
    oversized_title = "T" * 201
    res = client.post(
        "/api/meetings/analyze",
        json={"title": oversized_title, "transcript": "Valid meeting notes"},
    )
    assert res.status_code == 422
    assert any("title" in str(err) for err in res.json().get("detail", []))


def test_clarification_answer_exceeding_2000_chars_rejected_with_422():
    """
    Verifies that clarification answers exceeding 2,000 characters fail Pydantic validation
    with HTTP 422.
    """
    oversized_answer = "A" * 2001
    payload = {
        "analysis": MOCK_ANALYSIS_RESPONSE,
        "answers": [{"clarification_id": "clarif_1", "answer": oversized_answer}],
    }
    res = client.post("/api/meetings/clarify", json=payload)
    assert res.status_code == 422
    assert any("answer" in str(err) for err in res.json().get("detail", []))


# ==============================================================================
# 3. Safe Error Handling Tests (No Internal Leaks)
# ==============================================================================

def test_production_safe_error_500():
    """
    Verifies that in production mode, unexpected 500 errors return a clean,
    sanitized message and do NOT leak raw str(e), file paths, or stack traces.
    """
    mock_gemini = MagicMock()
    mock_gemini.analyze_transcript.side_effect = RuntimeError("/var/secrets/api_token.key leaked!")

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "ENVIRONMENT", "production"):
        res = client.post("/api/meetings/analyze", json={"transcript": "Testing error leak"})
        assert res.status_code == 500
        detail = res.json()["detail"]
        assert detail == "An internal server error occurred while processing your request. Please try again later."
        assert "secrets" not in detail
        assert "api_token" not in detail
        assert "RuntimeError" not in detail


def test_production_safe_error_502():
    """
    Verifies that in production mode, GeminiAnalysisError returns a sanitized 502 message.
    """
    mock_gemini = MagicMock()
    mock_gemini.analyze_transcript.side_effect = GeminiAnalysisError("google.genai.internal: upstream model quota exhausted at worker 10.0.0.1")

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "ENVIRONMENT", "production"):
        res = client.post("/api/meetings/analyze", json={"transcript": "Testing error leak"})
        assert res.status_code == 502
        detail = res.json()["detail"]
        assert detail == "The upstream AI service is temporarily unavailable. Please try again."
        assert "10.0.0.1" not in detail
        assert "google.genai" not in detail


def test_production_safe_error_503():
    """
    Verifies that in production mode, GeminiConfigError returns a sanitized 503 message.
    """
    mock_gemini = MagicMock()
    mock_gemini.analyze_transcript.side_effect = GeminiConfigError("API key AIzaSyFakeSecretKey is invalid")

    with patch("app.api.routes.meetings.gemini_service", mock_gemini), \
         patch.object(settings, "ENVIRONMENT", "production"):
        res = client.post("/api/meetings/analyze", json={"transcript": "Testing error leak"})
        assert res.status_code == 503
        detail = res.json()["detail"]
        assert detail == "The service is temporarily unavailable."
        assert "AIzaSy" not in detail


# ==============================================================================
# 4. Defensive Security Headers Tests
# ==============================================================================

def test_defensive_security_headers_present():
    """
    Verifies that all API responses contain required defensive HTTP security headers.
    """
    res = client.get("/health")
    assert res.status_code == 200

    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "Content-Security-Policy" in res.headers
    assert "default-src 'self'" in res.headers["Content-Security-Policy"]


# ==============================================================================
# 5. Production Configuration Validation Tests
# ==============================================================================

def test_production_validation_rejects_wildcard_cors():
    """Verifies that production configuration rejects wildcard '*' in CORS_ORIGINS."""
    s = Settings(ENVIRONMENT="production", CORS_ORIGINS=["*"], FIREBASE_PROJECT_ID="prod-id", GEMINI_API_KEY="valid-key")
    with pytest.raises(ValueError, match="Wildcard '\\*' in CORS_ORIGINS is strictly prohibited"):
        s.validate_production_configuration()


def test_production_validation_rejects_localhost_cors():
    """Verifies that production configuration rejects localhost origins."""
    s = Settings(
        ENVIRONMENT="production",
        CORS_ORIGINS=["https://app.meetmind.ai", "http://localhost:5173"],
        FIREBASE_PROJECT_ID="prod-id",
        GEMINI_API_KEY="valid-key",
    )
    with pytest.raises(ValueError, match="Localhost origin"):
        s.validate_production_configuration()


def test_production_validation_rejects_disabled_auth():
    """Verifies that production configuration rejects FIREBASE_AUTH_ENABLED=False."""
    s = Settings(
        ENVIRONMENT="production",
        CORS_ORIGINS=["https://app.meetmind.ai"],
        FIREBASE_AUTH_ENABLED=False,
        FIREBASE_PROJECT_ID="prod-id",
        GEMINI_API_KEY="valid-key",
    )
    with pytest.raises(ValueError, match="FIREBASE_AUTH_ENABLED cannot be False in production"):
        s.validate_production_configuration()


def test_production_validation_rejects_missing_credentials():
    """Verifies that production configuration requires valid FIREBASE_PROJECT_ID and GEMINI_API_KEY."""
    s1 = Settings(ENVIRONMENT="production", CORS_ORIGINS=["https://app.meetmind.ai"], FIREBASE_PROJECT_ID="", GEMINI_API_KEY="valid-key")
    with pytest.raises(ValueError, match="Valid FIREBASE_PROJECT_ID is required"):
        s1.validate_production_configuration()

    s2 = Settings(ENVIRONMENT="production", CORS_ORIGINS=["https://app.meetmind.ai"], FIREBASE_PROJECT_ID="prod-id", GEMINI_API_KEY="")
    with pytest.raises(ValueError, match="Valid GEMINI_API_KEY is required"):
        s2.validate_production_configuration()


def test_production_validation_rejects_missing_redis_regardless_of_required_flag():
    """
    Verifies that production configuration strictly requires a non-empty RATE_LIMIT_REDIS_URL,
    even if RATE_LIMIT_REDIS_REQUIRED is False.
    """
    # 1. Missing Redis URL with RATE_LIMIT_REDIS_REQUIRED=False fails
    s1 = Settings(
        ENVIRONMENT="production",
        CORS_ORIGINS=["https://app.meetmind.ai"],
        FIREBASE_PROJECT_ID="prod-id",
        GEMINI_API_KEY="valid-key",
        RATE_LIMIT_REDIS_REQUIRED=False,
        RATE_LIMIT_REDIS_URL="",
    )
    with pytest.raises(ValueError, match="RATE_LIMIT_REDIS_URL is required in production"):
        s1.validate_production_configuration()

    # 2. Missing Redis URL with RATE_LIMIT_REDIS_REQUIRED=True fails
    s2 = Settings(
        ENVIRONMENT="production",
        CORS_ORIGINS=["https://app.meetmind.ai"],
        FIREBASE_PROJECT_ID="prod-id",
        GEMINI_API_KEY="valid-key",
        RATE_LIMIT_REDIS_REQUIRED=True,
        RATE_LIMIT_REDIS_URL=None,
    )
    with pytest.raises(ValueError, match="RATE_LIMIT_REDIS_URL is required in production"):
        s2.validate_production_configuration()

    # 3. Valid Redis URL passes validation in production
    s3 = Settings(
        ENVIRONMENT="production",
        CORS_ORIGINS=["https://app.meetmind.ai"],
        FIREBASE_PROJECT_ID="prod-id",
        GEMINI_API_KEY="valid-key",
        RATE_LIMIT_REDIS_REQUIRED=False,
        RATE_LIMIT_REDIS_URL="redis://prod-redis:6379/0",
    )
    s3.validate_production_configuration()


def test_rate_limit_fail_closed_configuration_consistency():
    """
    Verifies that fail-closed settings resolve consistently across environments:
    - In development without explicit override, defaults to False (fallback enabled).
    - In production without explicit override, defaults to True (fail-closed enabled).
    - Explicit overrides (True or False) are respected regardless of environment.
    - When RATE_LIMIT_REDIS_REQUIRED is True, defaults to True.
    """
    # 1. Dev default: False
    dev_default = Settings(ENVIRONMENT="development", RATE_LIMIT_FAIL_CLOSED=None, RATE_LIMIT_REDIS_REQUIRED=False)
    assert dev_default.is_rate_limit_fail_closed is False

    # 2. Prod default: True
    prod_default = Settings(ENVIRONMENT="production", RATE_LIMIT_FAIL_CLOSED=None, RATE_LIMIT_REDIS_REQUIRED=False)
    assert prod_default.is_rate_limit_fail_closed is True

    # 3. Explicit override in dev: True
    dev_explicit = Settings(ENVIRONMENT="development", RATE_LIMIT_FAIL_CLOSED=True)
    assert dev_explicit.is_rate_limit_fail_closed is True

    # 4. Explicit override in prod: False
    prod_explicit = Settings(ENVIRONMENT="production", RATE_LIMIT_FAIL_CLOSED=False)
    assert prod_explicit.is_rate_limit_fail_closed is False

    # 5. Redis required enforces fail-closed
    redis_req = Settings(ENVIRONMENT="development", RATE_LIMIT_REDIS_REQUIRED=True, RATE_LIMIT_FAIL_CLOSED=None)
    assert redis_req.is_rate_limit_fail_closed is True


def test_create_rate_limiter_production_missing_redis_refuses_silent_in_memory():
    """
    Verifies that in production, if RATE_LIMIT_REDIS_URL is missing, create_rate_limiter()
    raises RuntimeError regardless of RATE_LIMIT_REDIS_REQUIRED setting, refusing to
    silently fall back to an in-memory rate limiter that would allow multi-instance quota bypass.
    """
    # 1. Production + missing Redis URL + RATE_LIMIT_REDIS_REQUIRED=False must fail
    with patch.object(settings, "ENVIRONMENT", "production"), \
         patch.object(settings, "RATE_LIMIT_REDIS_REQUIRED", False), \
         patch.object(settings, "RATE_LIMIT_REDIS_URL", None):
        with pytest.raises(RuntimeError, match="RATE_LIMIT_REDIS_URL is required in production"):
            create_rate_limiter()

    # 2. Production + missing Redis URL + RATE_LIMIT_REDIS_REQUIRED=True must fail
    with patch.object(settings, "ENVIRONMENT", "production"), \
         patch.object(settings, "RATE_LIMIT_REDIS_REQUIRED", True), \
         patch.object(settings, "RATE_LIMIT_REDIS_URL", ""):
        with pytest.raises(RuntimeError, match="RATE_LIMIT_REDIS_URL is required in production"):
            create_rate_limiter()


def test_create_rate_limiter_production_with_redis_url_proceeds_to_redis_limiter():
    """
    Verifies that in production with a configured Redis URL, create_rate_limiter()
    proceeds to instantiate RedisRateLimiter with fail_closed=True.
    """
    with patch.object(settings, "ENVIRONMENT", "production"), \
         patch.object(settings, "RATE_LIMIT_REDIS_URL", "redis://prod-redis.internal:6379/0"):
        limiter = create_rate_limiter()
        assert isinstance(limiter, RedisRateLimiter)
        assert limiter.fail_closed is True
        assert limiter.sanitized_url == "redis://prod-redis.internal:6379/0"


def test_create_rate_limiter_development_keeps_local_dev_usable_without_redis():
    """
    Verifies that local development remains completely usable without Redis:
    when RATE_LIMIT_REDIS_URL is empty, create_rate_limiter() returns InMemoryRateLimiter
    both when RATE_LIMIT_REDIS_REQUIRED is False and when True (with fallback).
    """
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "RATE_LIMIT_REDIS_REQUIRED", False), \
         patch.object(settings, "RATE_LIMIT_REDIS_URL", None):
        limiter = create_rate_limiter()
        assert isinstance(limiter, InMemoryRateLimiter)

    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "RATE_LIMIT_REDIS_REQUIRED", True), \
         patch.object(settings, "RATE_LIMIT_REDIS_URL", ""):
        limiter = create_rate_limiter()
        assert isinstance(limiter, InMemoryRateLimiter)
