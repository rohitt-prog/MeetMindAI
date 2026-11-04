import time
import threading
import logging
import uuid
from collections import deque
from typing import Dict, Tuple, Optional, Callable
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from fastapi import Request, HTTPException, status, Depends

from app.core.config import settings
from app.core.auth import get_current_user, AuthenticatedUser

logger = logging.getLogger("meetmind-ai.ratelimit")

VALID_REDIS_SCHEMES = ("redis", "rediss", "unix", "tcp")
SENSITIVE_QUERY_KEYWORDS = (
    "auth", "password", "token", "secret", "key", "credential", "pass", "pwd", "cert", "api_key"
)


def sanitize_redis_url(url: Optional[str]) -> str:
    """
    Sanitizes a Redis connection URL by redacting credentials in userinfo
    and sensitive query parameters to prevent secret token leakage into application logs.
    """
    if not url:
        return ""
    try:
        parsed = urlsplit(url)

        # Ensure scheme is a recognized Redis URL scheme
        if parsed.scheme.lower() not in VALID_REDIS_SCHEMES:
            return "[REDACTED_REDIS_URL]"

        # 1. Redact credentials in userinfo (username:password or :password)
        netloc = parsed.netloc
        if parsed.password or parsed.username or "@" in netloc:
            user = parsed.username or ""
            host = parsed.hostname or ""
            port_str = f":{parsed.port}" if parsed.port else ""
            if user:
                netloc = f"{user}:***@{host}{port_str}"
            else:
                netloc = f"***@{host}{port_str}"

        # 2. Redact sensitive query parameters
        query = parsed.query
        if query:
            q_pairs = parse_qsl(query, keep_blank_values=True)
            sanitized_pairs = []
            for k, v in q_pairs:
                k_lower = k.lower()
                if any(kw in k_lower for kw in SENSITIVE_QUERY_KEYWORDS):
                    sanitized_pairs.append((k, "REDACTED"))
                else:
                    sanitized_pairs.append((k, v))
            query = urlencode(sanitized_pairs)

        return urlunsplit((parsed.scheme, netloc, parsed.path, query, parsed.fragment))
    except Exception:
        return "[REDACTED_REDIS_URL]"


# Atomic Sliding-Window Rate Limiter Lua Script
# Executed atomically within Redis to eliminate multi-instance race conditions.
LUA_SLIDING_WINDOW_RATE_LIMIT = """
-- MeetMind AI — Atomic Sliding Window Rate Limiter
-- KEYS[1]: rate limit key (e.g. "meetmind:ratelimit:analyze:user_123")
-- ARGV[1]: current_time (number, unix timestamp in seconds)
-- ARGV[2]: window_seconds (number, window duration in seconds)
-- ARGV[3]: limit (number, maximum allowed requests per window)
-- ARGV[4]: unique_member (string, unique request identifier)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local window_start = now - window

-- 1. Purge expired timestamps strictly older than the active sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- 2. Count active requests within the window
local current_count = redis.call('ZCARD', key)

-- 3. Check if quota exhausted
if current_count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldest_score = now
    if oldest and #oldest >= 2 then
        oldest_score = tonumber(oldest[2]) or now
    end
    local retry_after = math.max(1, math.ceil(oldest_score + window - now))
    local reset_at = math.ceil(oldest_score + window)
    return {0, retry_after, 0, reset_at}
end

-- 4. Quota available: atomically record this request with a unique member
redis.call('ZADD', key, now, member)

-- 5. Refresh key expiration TTL with safety buffer
redis.call('EXPIRE', key, math.ceil(window + 10))

-- 6. Calculate remaining quota and reset timestamp
local remaining = limit - (current_count + 1)
local reset_at = math.ceil(now + window)
return {1, 0, remaining, reset_at}
"""


def parse_rate_spec(rate_spec: str) -> Tuple[int, int, str]:
    """
    Parses a rate limit string formatted as 'count/period' (e.g., '10/minute', '5/second', '100/hour').
    Returns: (limit_count, window_seconds, window_name)
    """
    spec = rate_spec.strip().lower()
    if "/" not in spec:
        raise ValueError(f"Invalid rate limit specification: '{rate_spec}'. Expected format 'count/period'.")

    count_str, period = spec.split("/", 1)
    limit = int(count_str.strip())
    period = period.strip()

    if period in ("s", "sec", "second", "seconds"):
        return limit, 1, "second"
    elif period in ("m", "min", "minute", "minutes"):
        return limit, 60, "minute"
    elif period in ("h", "hr", "hour", "hours"):
        return limit, 3600, "hour"
    elif period in ("d", "day", "days"):
        return limit, 86400, "day"
    else:
        raise ValueError(f"Unsupported rate limit time unit: '{period}'. Supported units: second, minute, hour, day.")


class InMemoryRateLimiter:
    """
    Thread-safe, high-precision in-memory sliding-window log rate limiter
    with bounded memory cleanup for stale per-user keys.
    Provides local development fallback and single-process rate protection.
    """

    def __init__(
        self,
        max_keys: int = 10_000,
        cleanup_interval_seconds: float = 60.0,
    ):
        self._lock = threading.Lock()
        self._history: Dict[str, deque] = {}
        self.max_keys = max_keys
        self.cleanup_interval_seconds = cleanup_interval_seconds
        self._last_cleanup = 0.0

    def cleanup_stale_keys(self, now: Optional[float] = None, max_stale_age: float = 3600.0) -> int:
        """
        Public method to purge empty logs or keys older than max_stale_age (seconds).
        Returns the count of purged keys.
        """
        current_time = now if now is not None else time.time()
        with self._lock:
            return self._cleanup_stale_keys_locked(current_time, max_stale_age)

    def _cleanup_stale_keys_locked(self, current_time: float, max_stale_age: float) -> int:
        stale_cutoff = current_time - max_stale_age
        keys_to_remove = []

        for k, log in self._history.items():
            while log and log[0] <= stale_cutoff:
                log.popleft()
            if not log:
                keys_to_remove.append(k)

        for k in keys_to_remove:
            self._history.pop(k, None)

        removed_count = len(keys_to_remove)

        # Enforce maximum key ceiling if still over capacity
        if len(self._history) > self.max_keys:
            excess = len(self._history) - self.max_keys
            overflow_keys = list(self._history.keys())[:excess]
            for k in overflow_keys:
                self._history.pop(k, None)
            removed_count += len(overflow_keys)

        self._last_cleanup = current_time
        return removed_count

    def check_rate_limit(
        self,
        key: str,
        limit: int,
        window_seconds: int,
        now: Optional[float] = None,
    ) -> Tuple[bool, int, int, int, int]:
        """
        Evaluates sliding-window rate limit for a given key.
        Returns: (allowed, retry_after, remaining, limit, reset_at)
        """
        current_time = now if now is not None else time.time()
        window_start = current_time - window_seconds

        with self._lock:
            # Periodic bounded cleanup or emergency cleanup if over capacity
            if (
                current_time - self._last_cleanup >= self.cleanup_interval_seconds
                or len(self._history) >= self.max_keys
            ):
                self._cleanup_stale_keys_locked(current_time, max_stale_age=max(float(window_seconds), 60.0))

            if key not in self._history:
                self._history[key] = deque()

            log = self._history[key]

            # Purge timestamps outside the active sliding window
            while log and log[0] <= window_start:
                log.popleft()

            # Bound capacity to max_keys by evicting oldest keys if over limit
            if len(self._history) > self.max_keys:
                excess = len(self._history) - self.max_keys
                for k in list(self._history.keys()):
                    if k != key:
                        self._history.pop(k, None)
                        excess -= 1
                        if excess <= 0:
                            break

            if len(log) >= limit:
                oldest_timestamp = log[0]
                retry_after = max(1, int(oldest_timestamp + window_seconds - current_time))
                reset_at = int(oldest_timestamp + window_seconds)
                return False, retry_after, 0, limit, reset_at

            # Record current invocation timestamp
            log.append(current_time)
            remaining = max(0, limit - len(log))
            reset_at = int(current_time + window_seconds)
            return True, 0, remaining, limit, reset_at

    def reset(self):
        """Clears all in-memory rate limit records (primarily for testing)."""
        with self._lock:
            self._history.clear()
            self._last_cleanup = 0.0


class RedisRateLimiter:
    """
    Production-grade distributed rate limiter using Redis sorted sets (ZSET)
    and an atomic Lua script.
    Maintains synchronized sliding-window logs across horizontally scaled worker instances
    without concurrency race conditions.
    """

    def __init__(self, redis_url: str, fail_closed: Optional[bool] = None):
        self.redis_url = redis_url
        self.sanitized_url = sanitize_redis_url(redis_url)
        self.fail_closed = (
            fail_closed
            if fail_closed is not None
            else settings.is_rate_limit_fail_closed
        )
        self._redis = None
        self._script = None
        self._fallback = InMemoryRateLimiter()
        self._init_client()

    def _init_client(self):
        try:
            import redis
            self._redis = redis.Redis.from_url(self.redis_url, decode_responses=True)
            self._redis.ping()
            self._script = self._redis.register_script(LUA_SLIDING_WINDOW_RATE_LIMIT)
            logger.info(f"Connected to Redis at {self.sanitized_url} and registered rate limit Lua script.")
        except ImportError:
            mode_desc = "fail-closed mode active" if self.fail_closed else "falling back to in-memory rate limiting"
            logger.warning(
                f"Redis package not installed. {mode_desc.capitalize()}. "
                "Install with 'pip install redis' for multi-instance distributed rate limiting."
            )
            self._redis = None
            self._script = None
        except Exception as e:
            err_type = type(e).__name__
            mode_desc = "fail-closed mode active" if self.fail_closed else "falling back to in-memory rate limiting"
            logger.warning(
                f"Could not connect to Redis at {self.sanitized_url} ({err_type}). {mode_desc.capitalize()}."
            )
            self._redis = None
            self._script = None

    def check_rate_limit(
        self,
        key: str,
        limit: int,
        window_seconds: int,
        now: Optional[float] = None,
    ) -> Tuple[bool, int, int, int, int]:
        """
        Evaluates sliding-window rate limit for a given key atomically via Lua.
        Returns: (allowed, retry_after, remaining, limit, reset_at)
        """
        current_time = now if now is not None else time.time()

        if self._redis is None:
            if self.fail_closed:
                logger.error(
                    f"Redis rate limiter unavailable for key '{key}'; "
                    "failing closed to prevent multi-instance quota bypass."
                )
                retry_after = window_seconds
                reset_at = int(current_time + retry_after)
                return False, retry_after, 0, limit, reset_at
            return self._fallback.check_rate_limit(key, limit, window_seconds, now=current_time)

        redis_key = f"meetmind:ratelimit:{key}"
        unique_member = f"{current_time}:{uuid.uuid4().hex}"

        try:
            # Execute atomic Lua script
            if self._script is not None:
                res = self._script(
                    keys=[redis_key],
                    args=[current_time, window_seconds, limit, unique_member],
                )
            else:
                # Direct eval fallback if register_script was bypassed/mocked
                res = self._redis.eval(
                    LUA_SLIDING_WINDOW_RATE_LIMIT,
                    1,
                    redis_key,
                    current_time,
                    window_seconds,
                    limit,
                    unique_member,
                )

            allowed = bool(res[0] == 1)
            retry_after = int(res[1])
            remaining = int(res[2])
            reset_at = int(res[3])
            return allowed, retry_after, remaining, limit, reset_at

        except Exception as e:
            err_type = type(e).__name__
            if self.fail_closed:
                logger.error(
                    f"Redis rate limit evaluation error ({err_type}) for key '{key}'; "
                    "failing closed to prevent multi-instance quota bypass."
                )
                retry_after = window_seconds
                reset_at = int(current_time + retry_after)
                return False, retry_after, 0, limit, reset_at

            logger.warning(
                f"Redis rate limit evaluation error ({err_type}) for key '{key}'; "
                "falling back to in-memory evaluator."
            )
            return self._fallback.check_rate_limit(key, limit, window_seconds, now=current_time)

    def reset(self):
        """Clears all rate limit records (primarily for testing)."""
        if self._redis is not None:
            try:
                keys = self._redis.keys("meetmind:ratelimit:*")
                if keys:
                    self._redis.delete(*keys)
            except Exception as e:
                err_type = type(e).__name__
                logger.warning(f"Error resetting Redis rate limiter: {err_type}")
        self._fallback.reset()


def create_rate_limiter():
    """
    Instantiates the appropriate rate limiter based on environment configuration.
    In production, always requires RATE_LIMIT_REDIS_URL and refuses to silently fall back
    to InMemoryRateLimiter.
    """
    redis_url = settings.RATE_LIMIT_REDIS_URL.strip() if settings.RATE_LIMIT_REDIS_URL else None

    if redis_url:
        return RedisRateLimiter(
            redis_url=redis_url,
            fail_closed=settings.is_rate_limit_fail_closed,
        )

    # In production, Redis is strictly required. Do not silently use InMemoryRateLimiter in production.
    if settings.ENVIRONMENT.lower() == "production":
        logger.error(
            "Production configuration error: RATE_LIMIT_REDIS_URL is required in production. "
            "Refusing to silently use InMemoryRateLimiter in production."
        )
        raise RuntimeError(
            "Production configuration error: RATE_LIMIT_REDIS_URL is required in production. "
            "Cannot silently use InMemoryRateLimiter in production."
        )

    if settings.RATE_LIMIT_REDIS_REQUIRED:
        logger.warning(
            "RATE_LIMIT_REDIS_REQUIRED is True but RATE_LIMIT_REDIS_URL is not set. "
            "Falling back to InMemoryRateLimiter for local development."
        )

    return InMemoryRateLimiter()


rate_limiter = create_rate_limiter()


def require_rate_limit(endpoint_name: str, rate_spec_getter: Callable[[], str]):
    """
    Reusable FastAPI dependency enforcing per-user rate limits.
    Authenticates the user first; unauthenticated requests are blocked with 401
    and cannot deplete authenticated user quotas.
    Keyed strictly by verified Firebase UID.
    """
    def dependency(
        request: Request,
        current_user: AuthenticatedUser = Depends(get_current_user),
    ) -> AuthenticatedUser:
        rate_spec = rate_spec_getter()
        limit, window_seconds, window_name = parse_rate_spec(rate_spec)
        key = f"{endpoint_name}:{current_user.uid}"

        allowed, retry_after, remaining, limit_val, reset_at = rate_limiter.check_rate_limit(
            key=key,
            limit=limit,
            window_seconds=window_seconds,
        )

        if not allowed:
            logger.warning(
                f"Rate limit exceeded on endpoint '{endpoint_name}' by user '{current_user.uid}' "
                f"({limit_val}/{window_name}). Retry-After: {retry_after}s."
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for endpoint '{endpoint_name}'. Maximum {limit_val} requests per {window_name} allowed.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit_val),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_at),
                },
            )

        # Store rate limit metadata on request state for response headers
        request.state.rate_limit_headers = {
            "X-RateLimit-Limit": str(limit_val),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(reset_at),
        }
        return current_user

    return dependency
