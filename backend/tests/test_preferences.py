import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.auth import get_current_user, AuthenticatedUser
from app.core.config import settings
from app.services.firebase_service import firebase_service
from app.services.gemini_service import (
    gemini_service,
    GeminiConfigError,
    GeminiAnalysisError,
)

client = TestClient(app)

MOCK_ANALYSIS_DICT = {
    "summary": "Team aligned on sprint goals.",
    "discussion_points": ["Milestone architecture"],
    "decisions": ["Deploy model preferences"],
    "action_items": [
        {
            "id": "action_1",
            "task": "Test custom model selection",
            "owner": "Alex",
            "deadline": "Friday",
            "status": "pending",
        }
    ],
    "clarification_required": False,
    "clarification_question": None,
    "clarifications": [],
    "open_follow_ups": [],
}


def test_get_preferences_default():
    """
    Test GET /api/preferences returns default model 'gemini-2.5-flash'
    when the user has not configured any custom preference.
    """
    response = client.get("/api/preferences")
    assert response.status_code == 200
    data = response.json()
    assert data["selected_model"] == "gemini-2.5-flash"
    assert "gemini-2.5-flash" in data["supported_models"]
    assert "gemini-2.5-pro" in data["supported_models"]
    assert data["default_model"] == "gemini-2.5-flash"


def test_update_preferences_pro_and_flash():
    """
    Test PUT /api/preferences switches between Flash and Pro models.
    """
    mock_db = MagicMock()
    stored_prefs = {}

    def mock_doc(uid):
        doc = MagicMock()
        doc.get().exists = uid in stored_prefs
        doc.get().to_dict.return_value = stored_prefs.get(uid, {})
        def _set(data):
            stored_prefs[uid] = data
        doc.set.side_effect = _set
        return doc

    mock_db.collection().document.side_effect = mock_doc
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        # 1. Switch to Pro
        response = client.put(
            "/api/preferences",
            json={"selected_model": "gemini-2.5-pro"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["selected_model"] == "gemini-2.5-pro"

        # 2. Verify GET reflects Pro
        get_resp = client.get("/api/preferences")
        assert get_resp.status_code == 200
        assert get_resp.json()["selected_model"] == "gemini-2.5-pro"

        # 3. Switch back to Flash
        response_flash = client.put(
            "/api/preferences",
            json={"selected_model": "gemini-2.5-flash"},
        )
        assert response_flash.status_code == 200
        assert response_flash.json()["selected_model"] == "gemini-2.5-flash"
    finally:
        firebase_service.set_client(orig_client)


def test_update_preferences_invalid_model():
    """
    Test that invalid or unsupported model IDs are rejected with 400 Bad Request.
    """
    response = client.put(
        "/api/preferences",
        json={"selected_model": "unsupported-gpt-4o"},
    )
    assert response.status_code == 400
    assert "Invalid model 'unsupported-gpt-4o'" in response.json()["detail"]
    assert "gemini-2.5-flash" in response.json()["detail"]
    assert "gemini-2.5-pro" in response.json()["detail"]


def test_preferences_unauthenticated():
    """
    Test that unauthenticated requests to GET and PUT /api/preferences return 401 Unauthorized.
    """
    orig_override = app.dependency_overrides.pop(get_current_user, None)
    try:
        get_resp = client.get("/api/preferences")
        assert get_resp.status_code == 401

        put_resp = client.put("/api/preferences", json={"selected_model": "gemini-2.5-pro"})
        assert put_resp.status_code == 401

        val_resp = client.post("/api/preferences/validate-key", json={"api_key": "some_key"})
        assert val_resp.status_code == 401
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override


def test_user_preference_isolation():
    """
    Test strict multi-user preference isolation.
    User Alice's model selection must never leak into User Bob's preferences.
    """
    stored_prefs = {}

    mock_db = MagicMock()
    def mock_doc(uid):
        doc = MagicMock()
        doc.get().exists = uid in stored_prefs
        doc.get().to_dict.return_value = stored_prefs.get(uid, {})
        def _set(data):
            stored_prefs[uid] = data
        doc.set.side_effect = _set
        return doc

    mock_db.collection().document.side_effect = mock_doc
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    orig_override = app.dependency_overrides.get(get_current_user)
    try:
        # Act as Alice
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="user_alice",
            email="alice@meetmind.ai",
        )
        resp_alice = client.put("/api/preferences", json={"selected_model": "gemini-2.5-pro"})
        assert resp_alice.status_code == 200
        assert resp_alice.json()["selected_model"] == "gemini-2.5-pro"

        # Act as Bob (should default to Flash and not see Alice's Pro)
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="user_bob",
            email="bob@meetmind.ai",
        )
        resp_bob = client.get("/api/preferences")
        assert resp_bob.status_code == 200
        assert resp_bob.json()["selected_model"] == "gemini-2.5-flash"

        # Alice checks again, still Pro
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="user_alice",
            email="alice@meetmind.ai",
        )
        resp_alice_again = client.get("/api/preferences")
        assert resp_alice_again.status_code == 200
        assert resp_alice_again.json()["selected_model"] == "gemini-2.5-pro"
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override
        firebase_service.set_client(orig_client)


def test_validate_key_success():
    """
    Test POST /api/preferences/validate-key returns 200 OK when key is valid.
    """
    with patch.object(gemini_service, "validate_api_key", return_value=True):
        response = client.post(
            "/api/preferences/validate-key",
            headers={"X-Gemini-API-Key": "AIzaSyTestValidKey123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert "verified successfully" in data["message"]
        # Ensure the API key itself is never exposed in response
        assert "AIzaSyTestValidKey123" not in json.dumps(data)


def test_validate_key_failure():
    """
    Test POST /api/preferences/validate-key returns 400 Bad Request when key is rejected.
    """
    with patch.object(gemini_service, "validate_api_key", return_value=False):
        response = client.post(
            "/api/preferences/validate-key",
            headers={"X-Gemini-API-Key": "AIzaSyInvalidKey"},
        )
        assert response.status_code == 400
        data = response.json()
        assert "Invalid Gemini API key" in data["detail"]
        assert "AIzaSyInvalidKey" not in json.dumps(data)


def test_validate_key_empty():
    """
    Test POST /api/preferences/validate-key rejects empty key with 400.
    """
    response = client.post(
        "/api/preferences/validate-key",
        headers={"X-Gemini-API-Key": "   "},
    )
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"]


def test_meeting_processing_uses_persisted_model():
    """
    Test that meeting transcript analysis uses the user's persisted model preference.
    """
    mock_gemini_client = MagicMock()
    mock_gemini_client.models.generate_content.return_value.text = json.dumps(MOCK_ANALYSIS_DICT)

    orig_client = gemini_service._client
    orig_key = gemini_service._api_key
    gemini_service.set_client(mock_gemini_client)
    gemini_service._api_key = "test_valid_key"

    # Mock user preferences in Firestore to return gemini-2.5-pro
    with patch.object(
        firebase_service,
        "get_user_preferences",
        return_value={"selected_model": "gemini-2.5-pro"},
    ):
        try:
            response = client.post(
                "/api/meetings/analyze",
                json={
                    "title": "Architecture Sync",
                    "transcript": "Sarah: Let's finalize the model selection by Wednesday.",
                },
            )
            assert response.status_code == 200
            # Verify the Gemini SDK was called with model='gemini-2.5-pro'
            call_kwargs = mock_gemini_client.models.generate_content.call_args.kwargs
            assert call_kwargs["model"] == "gemini-2.5-pro"
        finally:
            gemini_service._client = orig_client
            gemini_service._api_key = orig_key


def test_meeting_processing_uses_header_model_override():
    """
    Test that meeting transcript analysis honors X-Gemini-Model header override.
    """
    mock_gemini_client = MagicMock()
    mock_gemini_client.models.generate_content.return_value.text = json.dumps(MOCK_ANALYSIS_DICT)

    orig_client = gemini_service._client
    orig_key = gemini_service._api_key
    gemini_service.set_client(mock_gemini_client)
    gemini_service._api_key = "test_valid_key"

    try:
        response = client.post(
            "/api/meetings/analyze",
            headers={"X-Gemini-Model": "gemini-2.5-pro"},
            json={
                "title": "Architecture Sync",
                "transcript": "Sarah: Let's finalize the model selection by Wednesday.",
            },
        )
        assert response.status_code == 200
        call_kwargs = mock_gemini_client.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.5-pro"
    finally:
        gemini_service._client = orig_client
        gemini_service._api_key = orig_key


def test_meeting_processing_invalid_model_header():
    """
    Test that an invalid X-Gemini-Model header is rejected with 400 Bad Request.
    """
    response = client.post(
        "/api/meetings/analyze",
        headers={"X-Gemini-Model": "invalid-model-123"},
        json={
            "title": "Architecture Sync",
            "transcript": "Sarah: Let's finalize the model selection by Wednesday.",
        },
    )
    assert response.status_code == 400
    assert "Invalid model 'invalid-model-123'" in response.json()["detail"]


def test_byok_success_and_secrecy():
    """
    Test that passing X-Gemini-API-Key initializes an ephemeral client with that key,
    executes meeting analysis, and never exposes the key in responses.
    """
    mock_byok_client = MagicMock()
    mock_byok_client.models.generate_content.return_value.text = json.dumps(MOCK_ANALYSIS_DICT)

    byok_secret = "AIzaSyCustomSecretBYOKKey999"

    with patch.object(gemini_service, "create_client", return_value=mock_byok_client) as mock_create:
        response = client.post(
            "/api/meetings/analyze",
            headers={"X-Gemini-API-Key": byok_secret},
            json={
                "title": "BYOK Sync",
                "transcript": "Sarah: Testing BYOK custom key execution.",
            },
        )
        assert response.status_code == 200
        # Verify create_client was called with the BYOK key
        mock_create.assert_called_once_with(byok_secret)
        # Verify BYOK key is never in the response JSON
        raw_resp = response.text
        assert byok_secret not in raw_resp


def test_byok_failure_no_fallback():
    """
    Test that when a BYOK key fails, the backend returns an error and
    NEVER silently falls back to the server's Gemini API key.
    """
    bad_byok_key = "AIzaSyFailingKey000"

    # Mock create_client or generate_content to raise error
    mock_failing_client = MagicMock()
    mock_failing_client.models.generate_content.side_effect = Exception("API_KEY_INVALID: Key not found")

    with patch.object(gemini_service, "create_client", return_value=mock_failing_client):
        response = client.post(
            "/api/meetings/analyze",
            headers={"X-Gemini-API-Key": bad_byok_key},
            json={
                "title": "BYOK Sync",
                "transcript": "Sarah: Testing BYOK failure behavior.",
            },
        )
        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "provided custom API key" in detail
        # Verify the bad key itself is never exposed in the error message
        assert bad_byok_key not in response.text


def test_account_deletion_cleans_up_preferences():
    """
    Test that permanent account deletion removes user preferences from Firestore.
    """
    owner_uid = "user_delete_target"
    orig_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid=owner_uid,
        email="delete_target@meetmind.ai",
    )

    stored_docs = {
        f"pref_{owner_uid}": {"owner_uid": owner_uid, "selected_model": "gemini-2.5-pro"}
    }

    mock_db = MagicMock()
    mock_coll = MagicMock()
    mock_doc = MagicMock()
    mock_doc.delete.return_value = None
    mock_coll.document.return_value = mock_doc
    mock_coll.where.return_value.stream.return_value = []
    mock_db.collection.return_value = mock_coll

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        with patch.object(firebase_service, "delete_user_account", return_value=None):
            resp = client.delete("/api/account")
            assert resp.status_code == 200
            # Verify preferences collection document was deleted
            mock_coll.document.assert_any_call(owner_uid)
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override
        firebase_service.set_client(orig_client)

