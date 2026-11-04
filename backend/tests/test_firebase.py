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
            mock_doc.id = doc_id
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
                        snap.reference = mock_document(doc_id)
                        docs.append(snap)
                return docs

            mock_filtered_query.stream.side_effect = mock_stream
            return mock_filtered_query

        mock_col.where.side_effect = mock_where
        return mock_col

    def mock_batch():
        batch_mock = MagicMock()
        pending_deletes = []

        def batch_delete(ref):
            pending_deletes.append(ref)

        def batch_commit():
            for ref in pending_deletes:
                doc_id = getattr(ref, "id", None)
                if doc_id and doc_id in existing_docs:
                    del existing_docs[doc_id]

        batch_mock.delete.side_effect = batch_delete
        batch_mock.commit.side_effect = batch_commit
        return batch_mock

    mock_db.batch.side_effect = mock_batch
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

# ==============================================================================
# Phase 2B Bulk Deletion Tests
# ==============================================================================


def test_bulk_delete_deletes_only_authenticated_user_records():
    """
    Test that DELETE /api/meetings deletes only records owned by the current user,
    leaving other users' records and unowned legacy records completely intact.
    """
    docs = {
        "m_user1_a": {
            "meeting_id": "m_user1_a",
            "owner_uid": "test_user_default",
            "title": "Meeting 1A",
            "transcript": "Transcript 1A",
        },
        "m_user1_b": {
            "meeting_id": "m_user1_b",
            "owner_uid": "test_user_default",
            "title": "Meeting 1B",
            "transcript": "Transcript 1B",
        },
        "m_user2": {
            "meeting_id": "m_user2",
            "owner_uid": "other_user_456",
            "title": "User 2 Meeting",
            "transcript": "Private Transcript 2",
        },
        "m_legacy_unowned": {
            "meeting_id": "m_legacy_unowned",
            "owner_uid": None,
            "title": "Unowned Legacy Meeting",
            "transcript": "Legacy Transcript",
        },
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["deleted_count"] == 2
        assert "successfully deleted 2 saved meetings" in data["message"].lower()

        # Verify current user's records were deleted
        assert "m_user1_a" not in docs
        assert "m_user1_b" not in docs

        # Verify other user's record and unowned legacy records are intact
        assert "m_user2" in docs
        assert "m_legacy_unowned" in docs
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_leaves_unowned_records_untouched():
    """
    Test that DELETE /api/meetings does not delete unowned legacy records when the user
    has no matching meetings.
    """
    docs = {
        "m_unowned_1": {"meeting_id": "m_unowned_1", "owner_uid": None},
        "m_unowned_2": {"meeting_id": "m_unowned_2", "owner_uid": ""},
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 0
        assert "m_unowned_1" in docs
        assert "m_unowned_2" in docs
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_empty_collection():
    """
    Test bulk delete on an empty Firestore collection returns deleted_count=0.
    """
    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings")
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 0
        assert data["status"] == "deleted"
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_batch_boundaries_and_multiple_batches():
    """
    Test that delete_all_user_meetings properly chunks documents across batch boundaries
    when document count exceeds BATCH_SIZE (400).
    """
    TOTAL_DOCS = 450
    docs = {
        f"m_batch_{i}": {
            "meeting_id": f"m_batch_{i}",
            "owner_uid": "test_user_default",
            "title": f"Batch Meeting {i}",
        }
        for i in range(TOTAL_DOCS)
    }

    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        deleted_count = firebase_service.delete_all_user_meetings("test_user_default")
        assert deleted_count == TOTAL_DOCS
        assert len(docs) == 0
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_fails_safely_on_batch_error():
    """
    Test that if a Firestore batch commit fails, delete_all_user_meetings raises
    FirebaseOperationError and does not report false success.
    """
    docs = {
        "m_err_1": {"meeting_id": "m_err_1", "owner_uid": "test_user_default"},
        "m_err_2": {"meeting_id": "m_err_2", "owner_uid": "test_user_default"},
    }
    mock_db = create_mock_firestore_client(docs)
    # Simulate batch commit failure by overriding side_effect
    mock_batch_instance = MagicMock()
    mock_batch_instance.commit.side_effect = Exception("Firestore transaction timeout")
    mock_db.batch.side_effect = None
    mock_db.batch.return_value = mock_batch_instance

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        with pytest.raises(FirebaseOperationError) as exc_info:
            firebase_service.delete_all_user_meetings("test_user_default")
        assert "Failed to delete meeting records batch" in str(exc_info.value)
    finally:
        firebase_service._client = orig_client

def test_bulk_delete_enforces_authentication():
    """
    Test that DELETE /api/meetings returns 401 Unauthorized when unauthenticated.
    """
    from app.core.auth import get_current_user
    orig_override = app.dependency_overrides.pop(get_current_user, None)

    try:
        response = client.delete("/api/meetings")
        assert response.status_code == 401
        assert "authentication required" in response.json()["detail"].lower()
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override


def test_bulk_delete_enforces_rate_limiting():
    """
    Test that DELETE /api/meetings enforces the 5/minute rate limit.
    """
    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        # First 5 requests should succeed
        for _ in range(5):
            res = client.delete("/api/meetings")
            assert res.status_code == 200

        # 6th request within the minute window must trigger 429 Too Many Requests
        rate_limited_res = client.delete("/api/meetings")
        assert rate_limited_res.status_code == 429
        assert "rate limit exceeded" in rate_limited_res.json()["detail"].lower()
        assert "Retry-After" in rate_limited_res.headers
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_partial_failure_after_first_batch_succeeds():
    """
    Test bulk delete partial failure:
    Simulates 450 user-owned records chunked into Batch 1 (400 records) and Batch 2 (50 records).
    Batch 1 commits successfully, but Batch 2 raises an exception.
    Verifies:
      1. FirebaseOperationError is raised with deleted_count=400.
      2. The error message indicates 400 records deleted before failure.
      3. Original exception is preserved on __cause__.
      4. The 400 records from Batch 1 are deleted, and surviving 50 records remain in the database.
      5. Subsequent retry executes and successfully deletes the remaining 50 records.
    """
    owner_uid = "test_user_partial_fail"
    docs = {
        f"m_batch_{i}": {
            "meeting_id": f"m_batch_{i}",
            "owner_uid": owner_uid,
            "title": f"Meeting {i}",
        }
        for i in range(450)
    }

    mock_db = create_mock_firestore_client(docs)

    commit_count = 0

    def mock_batch_with_second_batch_failure():
        batch_mock = MagicMock()
        pending_deletes = []

        def batch_delete(ref):
            pending_deletes.append(ref)

        def batch_commit():
            nonlocal commit_count
            commit_count += 1
            if commit_count == 2:
                raise Exception("Simulated Firestore timeout on second batch")
            for ref in pending_deletes:
                doc_id = getattr(ref, "id", None)
                if doc_id and doc_id in docs:
                    del docs[doc_id]

        batch_mock.delete.side_effect = batch_delete
        batch_mock.commit.side_effect = batch_commit
        return batch_mock

    mock_db.batch.side_effect = mock_batch_with_second_batch_failure

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        # First attempt: Batch 1 (400) commits, Batch 2 (50) fails
        with pytest.raises(FirebaseOperationError) as exc_info:
            firebase_service.delete_all_user_meetings(owner_uid)

        assert exc_info.value.deleted_count == 400
        assert "400 records deleted before failure" in str(exc_info.value)
        assert exc_info.value.__cause__ is not None
        assert "Simulated Firestore timeout on second batch" in str(exc_info.value.__cause__)

        # Verify 400 records deleted, 50 surviving records remain
        assert len(docs) == 50
        for i in range(400):
            assert f"m_batch_{i}" not in docs
        for i in range(400, 450):
            assert f"m_batch_{i}" in docs

        # Subsequent retry: commits remaining 50 records (commit_count becomes 3 != 2)
        retry_deleted = firebase_service.delete_all_user_meetings(owner_uid)
        assert retry_deleted == 50
        assert len(docs) == 0

        # Further retry returns 0 deleted safely
        empty_retry = firebase_service.delete_all_user_meetings(owner_uid)
        assert empty_retry == 0
    finally:
        firebase_service._client = orig_client


def test_bulk_delete_endpoint_reports_partial_progress_safely():
    """
    Test that the DELETE /api/meetings endpoint returns HTTP 502 with sanitized
    information about how many records were deleted prior to upstream failure.
    """
    owner_uid = "test_user_default"
    docs = {
        f"m_part_{i}": {
            "meeting_id": f"m_part_{i}",
            "owner_uid": owner_uid,
            "title": f"Meeting {i}",
        }
        for i in range(450)
    }
    mock_db = create_mock_firestore_client(docs)
    commit_count = 0

    def mock_batch_failure():
        batch_mock = MagicMock()
        pending_deletes = []

        def batch_delete(ref):
            pending_deletes.append(ref)

        def batch_commit():
            nonlocal commit_count
            commit_count += 1
            if commit_count == 2:
                raise Exception("Internal connection reset")
            for ref in pending_deletes:
                doc_id = getattr(ref, "id", None)
                if doc_id and doc_id in docs:
                    del docs[doc_id]

        batch_mock.delete.side_effect = batch_delete
        batch_mock.commit.side_effect = batch_commit
        return batch_mock

    mock_db.batch.side_effect = mock_batch_failure
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.delete("/api/meetings")
        assert response.status_code == 502
        data = response.json()
        assert "400 records deleted before failure" in data["detail"]
        assert len(docs) == 50
    finally:
        firebase_service._client = orig_client


# ==============================================================================
# Phase 3 Account Deletion Tests
# ==============================================================================


def test_account_deletion_authenticated_success():
    """
    Test authenticated account deletion:
    1. Deletes all Firestore meeting documents owned by the user.
    2. Calls firebase_admin.auth.delete_user(uid) to terminate the Firebase Auth account.
    3. Returns HTTP 200 with AccountDeleteResponse (status='deleted', meetings_deleted=N).
    """
    owner_uid = "test_user_default"
    docs = {
        "m_acct_1": {"meeting_id": "m_acct_1", "owner_uid": owner_uid, "title": "Meeting 1"},
        "m_acct_2": {"meeting_id": "m_acct_2", "owner_uid": owner_uid, "title": "Meeting 2"},
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user") as mock_delete_user:
        try:
            response = client.delete("/api/account")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "deleted"
            assert "user_id" not in data
            assert data["meetings_deleted"] == 2
            assert "user account and 2 meeting records permanently deleted" in data["message"].lower()

            # Verify Firestore meetings for the user were deleted
            assert len(docs) == 0

            # Verify Firebase Auth delete_user was called exactly once with the user UID
            mock_delete_user.assert_called_once_with(owner_uid)
        finally:
            firebase_service._client = orig_client


def test_account_deletion_enforces_authentication():
    """
    Test that DELETE /api/account returns HTTP 401 Unauthorized when unauthenticated.
    """
    from app.core.auth import get_current_user
    orig_override = app.dependency_overrides.pop(get_current_user, None)

    try:
        response = client.delete("/api/account")
        assert response.status_code == 401
        assert "authentication required" in response.json()["detail"].lower()
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override


def test_account_deletion_ownership_isolation():
    """
    Test that DELETE /api/account only deletes meetings belonging to the verified user's UID.
    Other users' meetings and unowned legacy records are preserved.
    """
    owner_uid = "test_user_default"
    other_uid = "other_user_999"
    docs = {
        "m_mine": {"meeting_id": "m_mine", "owner_uid": owner_uid, "title": "My Meeting"},
        "m_other": {"meeting_id": "m_other", "owner_uid": other_uid, "title": "Other User Meeting"},
        "m_legacy": {"meeting_id": "m_legacy", "owner_uid": None, "title": "Unowned Meeting"},
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user"):
        try:
            response = client.delete("/api/account")
            assert response.status_code == 200
            data = response.json()
            assert data["meetings_deleted"] == 1

            # My meeting is deleted
            assert "m_mine" not in docs
            # Other user's meeting and unowned meeting are completely intact
            assert "m_other" in docs
            assert "m_legacy" in docs
        finally:
            firebase_service._client = orig_client


def test_account_deletion_firestore_failure_aborts_before_auth_deletion():
    """
    Test that if Firestore deletion fails, Firebase Auth delete_user is NOT called.
    The account credentials are preserved so the user can re-authenticate or retry.
    Returns HTTP 502 Bad Gateway.
    """
    owner_uid = "test_user_default"
    docs = {
        "m_fail_1": {"meeting_id": "m_fail_1", "owner_uid": owner_uid},
    }
    mock_db = create_mock_firestore_client(docs)
    # Fail batch commit
    mock_batch = MagicMock()
    mock_batch.commit.side_effect = Exception("Firestore transaction timeout")
    mock_db.batch.side_effect = None
    mock_db.batch.return_value = mock_batch

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user") as mock_delete_user:
        try:
            response = client.delete("/api/account")
            assert response.status_code == 502
            assert "failed to delete meeting records batch" in response.json()["detail"].lower()

            # Critical assertion: auth.delete_user MUST NOT be called if Firestore fails!
            mock_delete_user.assert_not_called()
        finally:
            firebase_service._client = orig_client


def test_account_deletion_auth_failure_after_data_deleted():
    """
    Test partial failure when Firestore data is deleted successfully, but
    firebase_admin.auth.delete_user fails.
    Verifies:
      1. Endpoint returns HTTP 502 Bad Gateway.
      2. Does NOT report full success.
      3. Informs the user that meeting data was deleted but auth account deletion failed.
    """
    owner_uid = "test_user_default"
    docs = {
        "m_data_1": {"meeting_id": "m_data_1", "owner_uid": owner_uid},
        "m_data_2": {"meeting_id": "m_data_2", "owner_uid": owner_uid},
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user", side_effect=Exception("Firebase Auth service error 503")):
        try:
            response = client.delete("/api/account")
            assert response.status_code == 502
            detail = response.json()["detail"]
            # Meetings were deleted
            assert len(docs) == 0
            # Error explicitly explains that meetings were deleted, but auth removal failed
            assert "application meeting records (2) were permanently deleted" in detail.lower() or "saved meetings (2) were permanently deleted" in detail.lower()
            assert "failed to remove" in detail.lower() or "could not be removed" in detail.lower()
        finally:
            firebase_service._client = orig_client


def test_account_deletion_safe_production_error_messages():
    """
    Test that when ENVIRONMENT is set to 'production', raw internal exceptions
    and stack traces are NEVER leaked in client error responses.
    """
    owner_uid = "test_user_default"
    docs = {
        "m_secret": {"meeting_id": "m_secret", "owner_uid": owner_uid},
    }
    mock_db = create_mock_firestore_client(docs)
    mock_batch = MagicMock()
    mock_batch.commit.side_effect = Exception("INTERNAL_SECRET_DATABASE_STACKTRACE_LEAK_TEST")
    mock_db.batch.side_effect = None
    mock_db.batch.return_value = mock_batch

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("app.core.config.settings.ENVIRONMENT", "production"):
        try:
            response = client.delete("/api/account")
            assert response.status_code == 502
            detail = response.json()["detail"]
            # Raw stacktrace string must NOT appear
            assert "INTERNAL_SECRET_DATABASE_STACKTRACE_LEAK_TEST" not in detail
            assert "upstream database service is temporarily unavailable" in detail.lower()
        finally:
            firebase_service._client = orig_client


def test_account_deletion_retry_behavior():
    """
    Test that if an initial deletion attempt partially succeeds (e.g. 400 docs deleted in batch 1,
    batch 2 fails), a subsequent retry cleans up the surviving 50 records and finishes auth deletion.
    """
    owner_uid = "test_user_retry"
    docs = {
        f"m_acct_part_{i}": {"meeting_id": f"m_acct_part_{i}", "owner_uid": owner_uid}
        for i in range(450)
    }
    mock_db = create_mock_firestore_client(docs)
    commit_count = 0

    def mock_batch_with_timeout_on_batch_2():
        batch_mock = MagicMock()
        pending = []

        def b_delete(ref):
            pending.append(ref)

        def b_commit():
            nonlocal commit_count
            commit_count += 1
            if commit_count == 2:
                raise Exception("Firestore timeout on batch 2")
            for ref in pending:
                doc_id = getattr(ref, "id", None)
                if doc_id and doc_id in docs:
                    del docs[doc_id]

        batch_mock.delete.side_effect = b_delete
        batch_mock.commit.side_effect = b_commit
        return batch_mock

    mock_db.batch.side_effect = mock_batch_with_timeout_on_batch_2
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user") as mock_delete_user:
        try:
            # First attempt: Batch 1 (400) commits, Batch 2 (50) fails
            with pytest.raises(FirebaseOperationError) as exc_info:
                firebase_service.delete_user_account_and_data(owner_uid)

            assert exc_info.value.deleted_count == 400
            assert len(docs) == 50
            mock_delete_user.assert_not_called()

            # Retry: Batch 2 (50) commits, auth delete succeeds
            deleted = firebase_service.delete_user_account_and_data(owner_uid)
            assert deleted == 50
            assert len(docs) == 0
            mock_delete_user.assert_called_once_with(owner_uid)
        finally:
            firebase_service._client = orig_client


def test_account_deletion_rate_limiting():
    """
    Test that DELETE /api/account enforces the 5/minute rate limit.
    """
    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    with patch("firebase_admin.auth.delete_user"):
        try:
            for _ in range(5):
                res = client.delete("/api/account")
                assert res.status_code == 200

            # 6th request is throttled
            throttled = client.delete("/api/account")
            assert throttled.status_code == 429
            assert "rate limit exceeded" in throttled.json()["detail"].lower()
            assert "Retry-After" in throttled.headers
        finally:
            firebase_service._client = orig_client
