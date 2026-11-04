import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.auth import get_current_user, AuthenticatedUser
from app.services.firebase_service import firebase_service
from app.services.gemini_service import gemini_service
from app.schemas.meeting import MeetingAnalysisResponse
from tests.test_firebase import create_mock_firestore_client

client = TestClient(app)

MOCK_ANALYSIS_DATA = {
    "summary": "Meeting to discuss Q4 roadmap goals and engineering action items.",
    "discussion_points": ["Roadmap review", "Authentication rollout"],
    "decisions": ["Roll out Firebase authentication across all endpoints"],
    "action_items": [
        {
            "id": "action_1",
            "task": "Deploy Firebase auth dependency",
            "owner": "Alex",
            "deadline": "Friday 5 PM",
            "status": "pending",
        }
    ],
    "clarification_required": False,
    "clarification_question": None,
    "clarifications": [],
    "open_follow_ups": [],
}


def test_missing_auth_token_returns_401():
    """
    Test that requests missing the Authorization header return HTTP 401 Unauthorized
    with the WWW-Authenticate: Bearer header.
    """
    # Remove any test dependency override so real get_current_user runs
    app.dependency_overrides.pop(get_current_user, None)

    try:
        endpoints = [
            ("GET", "/api/meetings"),
            ("POST", "/api/meetings/analyze"),
            ("GET", "/api/meetings/m_test_123"),
            ("DELETE", "/api/meetings/m_test_123"),
            ("DELETE", "/api/meetings"),
            ("DELETE", "/api/account"),
            ("GET", "/api/meetings/m_test_123/export/pdf"),
            ("POST", "/api/meetings/clarify"),
            ("POST", "/api/meetings/export/pdf"),
        ]

        for method, path in endpoints:
            if method == "GET":
                response = client.get(path)
            elif method == "DELETE":
                response = client.delete(path)
            elif method == "POST":
                response = client.post(path, json={"transcript": "Testing transcript content."})

            assert response.status_code == 401, f"{method} {path} should require authentication"
            assert "WWW-Authenticate" in response.headers
            assert "Bearer" in response.headers["WWW-Authenticate"]
            assert "authentication required" in response.json()["detail"].lower()
    finally:
        # Restore default test user for subsequent tests
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="test_user_default", email="test@meetmind.ai"
        )


def test_invalid_and_expired_tokens_return_401():
    """
    Test that invalid or expired Firebase ID tokens return HTTP 401 Unauthorized.
    """
    app.dependency_overrides.pop(get_current_user, None)

    try:
        from firebase_admin import auth as fb_auth

        # 1. Invalid ID token
        with patch.object(fb_auth, "verify_id_token", side_effect=fb_auth.InvalidIdTokenError("Token is malformed")):
            res = client.get("/api/meetings", headers={"Authorization": "Bearer invalid_token_xyz"})
            assert res.status_code == 401
            assert "invalid authentication token" in res.json()["detail"].lower()
            assert "invalid_token" in res.headers.get("WWW-Authenticate", "")

        # 2. Expired ID token
        with patch.object(fb_auth, "verify_id_token", side_effect=fb_auth.ExpiredIdTokenError("Token has expired", None)):
            res = client.get("/api/meetings", headers={"Authorization": "Bearer expired_token_xyz"})
            assert res.status_code == 401
            assert "expired" in res.json()["detail"].lower()
            assert "The token has expired" in res.headers.get("WWW-Authenticate", "")
    finally:
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="test_user_default", email="test@meetmind.ai"
        )


def test_authenticated_access_success():
    """
    Test that providing a valid token allows successful access to protected routes.
    """
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_alice", email="alice@company.com"
    )

    docs_store = {}
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.get("/api/meetings")
        assert response.status_code == 200
        assert response.json() == []
    finally:
        firebase_service._client = orig_client


def test_meeting_creation_stores_correct_owner_uid():
    """
    Test that when an authenticated user analyzes and persists a meeting,
    the document in Firestore contains their Firebase UID as owner_uid.
    """
    user_alice = AuthenticatedUser(uid="uid_alice_123", email="alice@meetmind.ai")
    app.dependency_overrides[get_current_user] = lambda: user_alice

    docs_store = {}
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    mock_gemini = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(MOCK_ANALYSIS_DATA)
    mock_gemini.models.generate_content.return_value = mock_resp

    orig_gemini = gemini_service._client
    orig_key = gemini_service._api_key
    gemini_service._api_key = "test_key"
    gemini_service.set_client(mock_gemini)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={
                "title": "Alice's Team Architecture Sync",
                "transcript": "Alice: Let's discuss microservices. Bob will implement auth.",
            },
        )
        assert response.status_code == 200
        assigned_id = response.json()["meeting_id"]
        assert assigned_id in docs_store

        saved_doc = docs_store[assigned_id]
        assert saved_doc["owner_uid"] == "uid_alice_123"
        assert saved_doc["title"] == "Alice's Team Architecture Sync"
    finally:
        gemini_service._client = orig_gemini
        gemini_service._api_key = orig_key
        firebase_service._client = orig_client


def test_user_a_cannot_read_user_b_meeting():
    """
    BOLA / Multi-user Isolation Test:
    User B creates a confidential meeting.
    User A attempts to retrieve it via GET /api/meetings/{id}.
    Expected: HTTP 404 Not Found (prevents disclosing existence).
    """
    docs_store = {
        "m_confidential_b": {
            "meeting_id": "m_confidential_b",
            "owner_uid": "user_b_uid",
            "title": "Confidential Executive Compensation",
            "transcript": "Secret executive transcript.",
            "created_at": "2026-11-04T00:00:00Z",
            "updated_at": "2026-11-04T00:00:00Z",
            "analysis": MOCK_ANALYSIS_DATA,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    # Act as User A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_a_uid", email="user_a@company.com"
    )

    try:
        response = client.get("/api/meetings/m_confidential_b")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client


def test_user_a_cannot_delete_user_b_meeting():
    """
    BOLA / Deletion Security Test:
    User A attempts to delete User B's meeting.
    Expected: HTTP 404 Not Found.
    The document in Firestore remains untouched.
    """
    docs_store = {
        "m_target_b": {
            "meeting_id": "m_target_b",
            "owner_uid": "user_b_uid",
            "title": "User B Core Roadmap",
            "transcript": "Important transcript.",
            "created_at": "2026-11-04T00:00:00Z",
            "updated_at": "2026-11-04T00:00:00Z",
            "analysis": MOCK_ANALYSIS_DATA,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    # Act as User A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_a_uid", email="user_a@company.com"
    )

    try:
        response = client.delete("/api/meetings/m_target_b")
        assert response.status_code == 404
        # Verify document still exists in Firestore!
        assert "m_target_b" in docs_store
    finally:
        firebase_service._client = orig_client


def test_user_a_cannot_export_user_b_meeting_pdf():
    """
    BOLA / PDF Export Security Test:
    User A attempts to export a PDF for User B's meeting.
    Expected: HTTP 404 Not Found.
    """
    docs_store = {
        "m_confidential_pdf": {
            "meeting_id": "m_confidential_pdf",
            "owner_uid": "user_b_uid",
            "title": "Private Financial Report",
            "transcript": "Confidential budget data.",
            "created_at": "2026-11-04T00:00:00Z",
            "updated_at": "2026-11-04T00:00:00Z",
            "analysis": MOCK_ANALYSIS_DATA,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    # Act as User A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_a_uid", email="user_a@company.com"
    )

    try:
        response = client.get("/api/meetings/m_confidential_pdf/export/pdf")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client


def test_user_a_cannot_clarify_user_b_meeting():
    """
    BOLA / Clarification Workflow Test:
    User A attempts to submit clarifications for User B's meeting.
    Expected: HTTP 404 Not Found.
    """
    clarif_analysis = dict(MOCK_ANALYSIS_DATA)
    clarif_analysis["clarifications"] = [
        {
            "id": "clarif_1",
            "category": "ownership",
            "original_statement": "Someone provision staging.",
            "explanation": "Missing owner.",
            "question": "Who will provision staging?",
            "resolved": False,
        }
    ]

    docs_store = {
        "m_clarify_target": {
            "meeting_id": "m_clarify_target",
            "owner_uid": "user_b_uid",
            "title": "User B Planning",
            "transcript": "Someone provision staging.",
            "created_at": "2026-11-04T00:00:00Z",
            "updated_at": "2026-11-04T00:00:00Z",
            "analysis": clarif_analysis,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    # Mock Gemini resolution
    mock_gemini = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(MOCK_ANALYSIS_DATA)
    mock_gemini.models.generate_content.return_value = mock_resp

    orig_gemini = gemini_service._client
    orig_key = gemini_service._api_key
    gemini_service._api_key = "test_key"
    gemini_service.set_client(mock_gemini)

    # Act as User A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_a_uid", email="user_a@company.com"
    )

    try:
        response = client.post(
            "/api/meetings/clarify",
            json={
                "meeting_id": "m_clarify_target",
                "analysis": clarif_analysis,
                "answers": [{"clarification_id": "clarif_1", "answer": "David will do it."}],
            },
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        gemini_service._client = orig_gemini
        gemini_service._api_key = orig_key
        firebase_service._client = orig_client


def test_ownerless_legacy_records_are_quarantined():
    """
    Legacy Meeting Quarantine Test:
    Existing records created before Phase 11 have no owner_uid (or None).
    Expected:
      - Quarantined: Not exposed in any user's meeting list.
      - Direct access via GET /api/meetings/{id} returns 404.
      - Deletion attempt returns 404.
    """
    docs_store = {
        "m_legacy_pre_phase11": {
            "meeting_id": "m_legacy_pre_phase11",
            "owner_uid": None,  # Legacy record with no owner
            "title": "Legacy Pre-Phase 11 Meeting",
            "transcript": "Historical meeting notes.",
            "created_at": "2026-10-01T00:00:00Z",
            "updated_at": "2026-10-01T00:00:00Z",
            "analysis": MOCK_ANALYSIS_DATA,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    # Authenticated user logs in
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_carol", email="carol@meetmind.ai"
    )

    try:
        # 1. User listing meetings does NOT see legacy meeting
        list_res = client.get("/api/meetings")
        assert list_res.status_code == 200
        assert len(list_res.json()) == 0

        # 2. Attempting to fetch legacy meeting by ID returns 404
        get_res = client.get("/api/meetings/m_legacy_pre_phase11")
        assert get_res.status_code == 404

        # 3. Attempting to delete legacy meeting returns 404
        del_res = client.delete("/api/meetings/m_legacy_pre_phase11")
        assert del_res.status_code == 404
        # Verify legacy record is non-destructively preserved
        assert "m_legacy_pre_phase11" in docs_store
    finally:
        firebase_service._client = orig_client


def test_legacy_meeting_migration_utility():
    """
    Legacy Meeting Migration Script Test:
    Simulates the migration utility assigning an unowned record to an admin/target user.
    After migration, the target user can successfully retrieve and list the meeting.
    """
    from scripts.migrate_legacy_meetings import find_legacy_meetings, migrate_meetings

    docs_store = {
        "m_legacy_to_migrate": {
            "meeting_id": "m_legacy_to_migrate",
            "owner_uid": None,
            "title": "Important Legacy Sync",
            "transcript": "Legacy transcript.",
            "created_at": "2026-10-15T00:00:00Z",
            "updated_at": "2026-10-15T00:00:00Z",
            "analysis": MOCK_ANALYSIS_DATA,
            "answers_history": [],
        }
    }
    mock_db = create_mock_firestore_client(docs_store)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        # 1. Run migration script logic to assign to 'user_migrated_owner'
        target_uid = "user_migrated_owner"
        legacy_records = find_legacy_meetings()
        assert len(legacy_records) == 1
        assert legacy_records[0][0] == "m_legacy_to_migrate"

        migrate_meetings(legacy_records, target_uid=target_uid, dry_run=False)

        # Verify document was updated non-destructively
        assert docs_store["m_legacy_to_migrate"]["owner_uid"] == target_uid
        assert "_legacy_migrated_at" in docs_store["m_legacy_to_migrate"]

        # 2. Now user_migrated_owner logs in and retrieves the meeting
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid=target_uid, email="owner@meetmind.ai"
        )

        get_res = client.get("/api/meetings/m_legacy_to_migrate")
        assert get_res.status_code == 200
        assert get_res.json()["title"] == "Important Legacy Sync"

        list_res = client.get("/api/meetings")
        assert list_res.status_code == 200
        assert len(list_res.json()) == 1
        assert list_res.json()[0]["meeting_id"] == "m_legacy_to_migrate"
    finally:
        firebase_service._client = orig_client

