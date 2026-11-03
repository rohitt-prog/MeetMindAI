import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.firebase_service import (
    FirebaseService,
    FirebaseConfigError,
    FirebaseNotFoundError,
    FirebaseOperationError,
    firebase_service,
)
from app.services.gemini_service import gemini_service
from app.schemas.meeting import MeetingAnalysisResponse

client = TestClient(app)

MOCK_SAVED_MEETING_DATA = {
    "meeting_id": "m_test_123456",
    "owner_uid": "test_user_default",
    "title": "Mobile App Sync",
    "transcript": "Sarah: Let's review blockers. Alex will finalize GraphQL endpoint by Wednesday 4 PM.",
    "created_at": "2026-11-03T20:00:00Z",
    "updated_at": "2026-11-03T20:00:00Z",
    "analysis": {
        "summary": "The team reviewed mobile app blockers and assigned GraphQL endpoint work to Alex.",
        "discussion_points": ["Milestone release blockers", "GraphQL schema changes"],
        "decisions": ["Alex will finalize GraphQL endpoint by Wednesday 4 PM"],
        "action_items": [
            {
                "id": "action_1",
                "task": "Finalize GraphQL endpoint",
                "owner": "Alex",
                "deadline": "Wednesday 4 PM",
                "status": "pending",
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": [],
    },
    "answers_history": [],
}


def create_mock_firestore_client(existing_docs=None):
    """
    Creates a mock Firestore client simulating Firestore collection and document behavior.
    """
    if existing_docs is None:
        existing_docs = {"m_test_123456": MOCK_SAVED_MEETING_DATA}

    mock_db = MagicMock()

    def mock_collection(col_name):
        mock_col = MagicMock()

        def mock_document(doc_id):
            mock_doc = MagicMock()

            def mock_get():
                snap = MagicMock()
                if doc_id in existing_docs:
                    snap.exists = True
                    snap.id = doc_id
                    snap.to_dict.return_value = existing_docs[doc_id]
                else:
                    snap.exists = False
                    snap.to_dict.return_value = None
                return snap

            def mock_set(data):
                existing_docs[doc_id] = data

            def mock_update(data):
                if doc_id not in existing_docs:
                    raise Exception("Document not found for update")
                existing_docs[doc_id].update(data)

            def mock_delete():
                if doc_id in existing_docs:
                    del existing_docs[doc_id]

            mock_doc.get.side_effect = mock_get
            mock_doc.set.side_effect = mock_set
            mock_doc.update.side_effect = mock_update
            mock_doc.delete.side_effect = mock_delete
            return mock_doc

        def mock_order_by(field, direction=None):
            mock_query = MagicMock()

            def mock_limit(n):
                mock_limited_query = MagicMock()

                def mock_stream():
                    docs = []
                    for doc_id, doc_data in existing_docs.items():
                        snap = MagicMock()
                        snap.exists = True
                        snap.id = doc_id
                        snap.to_dict.return_value = doc_data
                        docs.append(snap)
                    return docs[:n]

                mock_limited_query.stream.side_effect = mock_stream
                return mock_limited_query

            mock_query.limit.side_effect = mock_limit
            return mock_query

        def mock_col_stream():
            docs = []
            for doc_id, doc_data in existing_docs.items():
                snap = MagicMock()
                snap.exists = True
                snap.id = doc_id
                snap.to_dict.return_value = doc_data
                docs.append(snap)
            return docs

        mock_col.stream.side_effect = mock_col_stream
        mock_col.document.side_effect = mock_document
        mock_col.order_by.side_effect = mock_order_by

        def mock_where(*args, **kwargs):
            mock_filtered_query = MagicMock()
            target_owner = None
            if "filter" in kwargs:
                f = kwargs["filter"]
                target_owner = getattr(f, "value", None)
            elif len(args) >= 3:
                target_owner = args[2]

            def mock_stream():
                docs = []
                for doc_id, doc_data in existing_docs.items():
                    if target_owner is None or doc_data.get("owner_uid") == target_owner:
                        snap = MagicMock()
                        snap.exists = True
                        snap.id = doc_id
                        snap.to_dict.return_value = doc_data
                        docs.append(snap)
                return docs

            mock_filtered_query.stream.side_effect = mock_stream
            return mock_filtered_query

        mock_col.where.side_effect = mock_where
        return mock_col

    mock_db.collection.side_effect = mock_collection
    return mock_db


# ==============================================================================
# Phase 6 Firebase Tests
# ==============================================================================

def test_firebase_unconfigured_error():
    """
    Test that GET /api/meetings returns 503 Service Unavailable when Firebase is not configured.
    """
    unconfigured_service = MagicMock(spec=FirebaseService)
    unconfigured_service.is_configured.return_value = False

    with patch("app.api.routes.meetings.firebase_service", unconfigured_service):
        response = client.get("/api/meetings")
        assert response.status_code == 503
        assert "Firebase Firestore is not configured" in response.json()["detail"]


def test_analyze_persists_to_firestore():
    """
    Test that POST /api/meetings/analyze persists the meeting to Firestore and returns meeting_id.
    """
    docs_store = {}
    mock_firestore = create_mock_firestore_client(docs_store)

    # Mock Gemini call
    mock_gemini_client = MagicMock()
    mock_gemini_response = MagicMock()
    mock_gemini_response.text = json.dumps(MOCK_SAVED_MEETING_DATA["analysis"])
    mock_gemini_client.models.generate_content.return_value = mock_gemini_response

    orig_gemini_client = gemini_service._client
    orig_gemini_key = gemini_service._api_key
    orig_firestore_client = firebase_service._client

    gemini_service._api_key = "test_key"
    gemini_service.set_client(mock_gemini_client)
    firebase_service.set_client(mock_firestore)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={
                "title": "Mobile App Sync",
                "transcript": "Sarah: Let's review blockers. Alex will finalize GraphQL endpoint by Wednesday 4 PM.",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["meeting_id"] is not None
        assert data["meeting_id"].startswith("m_")
        assert data["summary"] == MOCK_SAVED_MEETING_DATA["analysis"]["summary"]

        # Verify that Firestore document was created
        saved_id = data["meeting_id"]
        assert saved_id in docs_store
        assert docs_store[saved_id]["title"] == "Mobile App Sync"
        assert docs_store[saved_id]["analysis"]["summary"] == data["summary"]
    finally:
        gemini_service._client = orig_gemini_client
        gemini_service._api_key = orig_gemini_key
        firebase_service._client = orig_firestore_client


def test_list_recent_meetings_success():
    """
    Test GET /api/meetings retrieves lightweight list of meetings.
    """
    docs_store = {
        "m_1": {
            "meeting_id": "m_1",
            "owner_uid": "test_user_default",
            "title": "Meeting 1",
            "transcript": "Transcript 1",
            "created_at": "2026-11-03T18:00:00Z",
            "updated_at": "2026-11-03T19:00:00Z",
            "analysis": {
                "summary": "Summary 1",
                "discussion_points": ["DP1"],
                "decisions": ["D1"],
                "action_items": [{"id": "a1", "task": "Task 1", "owner": "Alex", "deadline": None, "status": "pending"}],
                "clarification_required": False,
                "clarifications": [],
            },
        },
        "m_2": {
            "meeting_id": "m_2",
            "owner_uid": "test_user_default",
            "title": "Meeting 2",
            "transcript": "Transcript 2",
            "created_at": "2026-11-03T20:00:00Z",
            "updated_at": "2026-11-03T21:00:00Z",
            "analysis": {
                "summary": "Summary 2",
                "discussion_points": [],
                "decisions": [],
                "action_items": [],
                "clarification_required": True,
                "clarifications": [{"id": "c1", "resolved": False}],
            },
        },
    }
    mock_firestore = create_mock_firestore_client(docs_store)
    orig_firestore_client = firebase_service._client
    firebase_service.set_client(mock_firestore)

    try:
        response = client.get("/api/meetings?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        # Ordered by updated_at descending (m_2: 21:00, m_1: 19:00)
        assert data[0]["meeting_id"] == "m_2"
        assert data[0]["clarification_required"] is True
        assert data[0]["unresolved_clarifications_count"] == 1
        assert data[1]["meeting_id"] == "m_1"
        assert data[1]["action_items_count"] == 1
        assert data[1]["decisions_count"] == 1
    finally:
        firebase_service._client = orig_firestore_client


def test_get_meeting_details_success():
    """
    Test GET /api/meetings/{id} retrieves complete meeting details with transcript and analysis.
    """
    docs_store = {"m_test_123456": MOCK_SAVED_MEETING_DATA}
    mock_firestore = create_mock_firestore_client(docs_store)
    orig_firestore_client = firebase_service._client
    firebase_service.set_client(mock_firestore)

    try:
        response = client.get("/api/meetings/m_test_123456")
        assert response.status_code == 200
        data = response.json()
        assert data["meeting_id"] == "m_test_123456"
        assert data["title"] == "Mobile App Sync"
        assert data["transcript"] == MOCK_SAVED_MEETING_DATA["transcript"]
        assert data["analysis"]["summary"] == MOCK_SAVED_MEETING_DATA["analysis"]["summary"]
        assert len(data["analysis"]["action_items"]) == 1
    finally:
        firebase_service._client = orig_firestore_client


def test_get_meeting_details_not_found():
    """
    Test GET /api/meetings/{id} returns 404 Not Found for non-existent meeting.
    """
    mock_firestore = create_mock_firestore_client({})
    orig_firestore_client = firebase_service._client
    firebase_service.set_client(mock_firestore)

    try:
        response = client.get("/api/meetings/non_existent_id")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_firestore_client


def test_clarify_updates_existing_meeting():
    """
    Test POST /api/meetings/clarify with meeting_id updates existing Firestore document in place.
    """
    initial_meeting = {
        "meeting_id": "m_target_update",
        "owner_uid": "test_user_default",
        "title": "Sprint Sync",
        "transcript": "Someone should provision credentials.",
        "created_at": "2026-11-03T18:00:00Z",
        "updated_at": "2026-11-03T18:00:00Z",
        "analysis": {
            "summary": "Initial summary.",
            "discussion_points": [],
            "decisions": [],
            "action_items": [
                {
                    "id": "action_1",
                    "task": "Provision credentials",
                    "owner": None,
                    "deadline": None,
                    "status": "pending",
                }
            ],
            "clarification_required": True,
            "clarification_question": "Who will provision credentials?",
            "clarifications": [
                {
                    "id": "clarif_1",
                    "category": "ownership",
                    "original_statement": "Someone should provision credentials.",
                    "explanation": "No owner assigned.",
                    "question": "Who will provision credentials?",
                    "related_action_item_id": "action_1",
                    "resolved": False,
                }
            ],
        },
        "answers_history": [],
    }

    docs_store = {"m_target_update": initial_meeting}
    mock_firestore = create_mock_firestore_client(docs_store)

    resolved_analysis = {
        "summary": "David assigned to provision credentials.",
        "discussion_points": [],
        "decisions": [],
        "action_items": [
            {
                "id": "action_1",
                "task": "Provision credentials",
                "owner": "David",
                "deadline": "Tomorrow",
                "status": "pending",
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone should provision credentials.",
                "explanation": "No owner assigned.",
                "question": "Who will provision credentials?",
                "related_action_item_id": "action_1",
                "resolved": True,
            }
        ],
    }

    mock_gemini_client = MagicMock()
    mock_gemini_response = MagicMock()
    mock_gemini_response.text = json.dumps(resolved_analysis)
    mock_gemini_client.models.generate_content.return_value = mock_gemini_response

    orig_gemini_client = gemini_service._client
    orig_gemini_key = gemini_service._api_key
    orig_firestore_client = firebase_service._client

    gemini_service._api_key = "test_key"
    gemini_service.set_client(mock_gemini_client)
    firebase_service.set_client(mock_firestore)

    try:
        response = client.post(
            "/api/meetings/clarify",
            json={
                "meeting_id": "m_target_update",
                "analysis": initial_meeting["analysis"],
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "David will do it tomorrow.",
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["meeting_id"] == "m_target_update"
        assert data["action_items"][0]["owner"] == "David"
        assert data["clarifications"][0]["resolved"] is True

        # Verify Firestore document was updated in-place without duplicate
        assert len(docs_store) == 1
        updated_doc = docs_store["m_target_update"]
        assert updated_doc["analysis"]["action_items"][0]["owner"] == "David"
        assert len(updated_doc["answers_history"]) == 1
        assert updated_doc["answers_history"][0]["answer"] == "David will do it tomorrow."
    finally:
        gemini_service._client = orig_gemini_client
        gemini_service._api_key = orig_gemini_key
        firebase_service._client = orig_firestore_client


def test_clarify_meeting_not_found():
    """
    Test POST /api/meetings/clarify with non-existent meeting_id returns 404 Not Found.
    """
    mock_firestore = create_mock_firestore_client({})
    orig_firestore_client = firebase_service._client
    firebase_service.set_client(mock_firestore)

    analysis_with_clarif = {
        "summary": "Summary",
        "discussion_points": [],
        "decisions": [],
        "action_items": [],
        "clarification_required": True,
        "clarification_question": "Question?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone do it.",
                "explanation": "No owner.",
                "question": "Who will do it?",
                "related_action_item_id": None,
                "resolved": False,
            }
        ],
    }

    # Mock Gemini
    mock_gemini_client = MagicMock()
    mock_gemini_response = MagicMock()
    mock_gemini_response.text = json.dumps(analysis_with_clarif)
    mock_gemini_client.models.generate_content.return_value = mock_gemini_response

    orig_gemini_client = gemini_service._client
    orig_gemini_key = gemini_service._api_key
    gemini_service._api_key = "test_key"
    gemini_service.set_client(mock_gemini_client)

    try:
        response = client.post(
            "/api/meetings/clarify",
            json={
                "meeting_id": "missing_id_999",
                "analysis": analysis_with_clarif,
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "Answer text",
                    }
                ],
            },
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        gemini_service._client = orig_gemini_client
        gemini_service._api_key = orig_gemini_key
        firebase_service._client = orig_firestore_client


def test_firestore_operation_failure():
    """
    Test that an unexpected Firestore error returns 502 Bad Gateway.
    """
    failing_db = MagicMock()
    failing_db.collection.side_effect = Exception("Firestore connection timed out")

    orig_firestore_client = firebase_service._client
    firebase_service.set_client(failing_db)

    try:
        response = client.get("/api/meetings")
        assert response.status_code == 502
        assert "Firestore connection timed out" in response.json()["detail"]
    finally:
        firebase_service._client = orig_firestore_client


def test_delete_meeting_success():
    """
    Test successful deletion of a saved meeting from Firestore.
    """
    docs = {"m_to_delete_1": dict(MOCK_SAVED_MEETING_DATA)}
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings/m_to_delete_1")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["meeting_id"] == "m_to_delete_1"
        assert "m_to_delete_1" not in docs

        # Subsequent retrieval should return 404
        get_res = client.get("/api/meetings/m_to_delete_1")
        assert get_res.status_code == 404
    finally:
        firebase_service._client = orig_client


def test_delete_meeting_not_found():
    """
    Test deleting a non-existent meeting returns 404.
    """
    docs = {}
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings/m_nonexistent_999")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client


def test_delete_meeting_unconfigured():
    """
    Test that deleting when Firebase is unconfigured returns 503.
    """
    with patch.object(firebase_service, "is_configured", return_value=False):
        response = client.delete("/api/meetings/m_test_123")
        assert response.status_code == 503
        assert "not configured" in response.json()["detail"].lower()


def test_delete_meeting_invalid_id():
    """
    Test that invalid meeting ID format returns 400.
    """
    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings/bad%20id%24%24")
        assert response.status_code == 400
        assert "invalid meeting id format" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client


def test_export_pdf_after_delete_returns_404():
    """
    Test that requesting PDF export on a deleted meeting returns 404.
    """
    docs = {"m_to_delete_pdf": dict(MOCK_SAVED_MEETING_DATA)}
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        # Pre-check: PDF export succeeds while meeting exists
        pre_res = client.get("/api/meetings/m_to_delete_pdf/export/pdf")
        assert pre_res.status_code == 200

        # Delete meeting
        del_res = client.delete("/api/meetings/m_to_delete_pdf")
        assert del_res.status_code == 200

        # PDF export now fails with 404
        post_res = client.get("/api/meetings/m_to_delete_pdf/export/pdf")
        assert post_res.status_code == 404
        assert "not found" in post_res.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client
