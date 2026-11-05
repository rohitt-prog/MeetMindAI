import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.firebase_service import (
    firebase_service,
    FirebaseConfigError,
    FirebaseOperationError,
)
from app.core.config import settings

client = TestClient(app)


def create_mock_firestore_client(existing_docs=None):
    """
    Creates an isolated mock Firestore client that maintains an in-memory document dictionary.
    Supports queries, documents, and atomic batches (delete, set, commit).
    """
    if existing_docs is None:
        existing_docs = {}

    mock_db = MagicMock()

    def mock_collection(name):
        mock_col = MagicMock()

        def mock_document(doc_id=None):
            if doc_id is None:
                doc_id = f"auto_{len(existing_docs) + 1}"
            mock_doc = MagicMock()
            mock_doc.id = doc_id

            def mock_get():
                snap = MagicMock()
                if doc_id in existing_docs:
                    snap.exists = True
                    snap.to_dict.return_value = existing_docs[doc_id]
                else:
                    snap.exists = False
                    snap.to_dict.return_value = None
                return snap

            def mock_set(data, merge=False):
                existing_docs[doc_id] = data

            def mock_delete():
                if doc_id in existing_docs:
                    del existing_docs[doc_id]

            mock_doc.get.side_effect = mock_get
            mock_doc.set.side_effect = mock_set
            mock_doc.delete.side_effect = mock_delete
            return mock_doc

        mock_col.document.side_effect = mock_document

        def mock_where(filter=None, **kwargs):
            mock_filtered_query = MagicMock()
            target_owner = getattr(filter, "value", None) if filter else None

            def mock_stream():
                docs = []
                for doc_id, doc_data in list(existing_docs.items()):
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
        pending_sets = []

        def batch_delete(ref):
            pending_deletes.append(ref)

        def batch_set(ref, data):
            pending_sets.append((ref, data))

        def batch_commit():
            for ref in pending_deletes:
                doc_id = getattr(ref, "id", None)
                if doc_id and doc_id in existing_docs:
                    del existing_docs[doc_id]
            for ref, data in pending_sets:
                doc_id = getattr(ref, "id", None)
                if doc_id:
                    existing_docs[doc_id] = data

        batch_mock.delete.side_effect = batch_delete
        batch_mock.set.side_effect = batch_set
        batch_mock.commit.side_effect = batch_commit
        return batch_mock

    mock_db.batch.side_effect = mock_batch
    mock_db.collection.side_effect = mock_collection
    return mock_db


@pytest.fixture(autouse=True)
def mock_auth():
    """Mock auth to simulate an authenticated user."""
    from app.core.auth import get_current_user, AuthenticatedUser

    mock_user = AuthenticatedUser(
        uid="user_test_backup",
        email="test_backup@meetmind.ai",
        name="Test User",
        email_verified=True,
    )
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield mock_user
    app.dependency_overrides.pop(get_current_user, None)


# ==============================================================================
# 1. JSON Backup Export Tests
# ==============================================================================


def test_export_backup_authenticated_success():
    """Verify that an authenticated user can export their complete meeting library as a JSON backup."""
    owner_uid = "user_test_backup"
    docs = {
        "m_001": {
            "meeting_id": "m_001",
            "owner_uid": owner_uid,
            "title": "Sprint Planning",
            "transcript": "Alice: We need to finalize the roadmap by Friday.",
            "created_at": "2026-03-01T10:00:00Z",
            "updated_at": "2026-03-01T10:00:00Z",
            "analysis": {
                "meeting_id": "m_001",
                "summary": "Team aligned on sprint roadmap deliverables.",
                "discussion_points": ["Roadmap priorities"],
                "decisions": ["Deploy to staging on Thursday"],
                "action_items": [
                    {
                        "id": "action_1",
                        "task": "Finalize roadmap",
                        "owner": "Alice",
                        "deadline": "Friday",
                        "status": "pending",
                    }
                ],
                "clarification_required": False,
                "clarifications": [],
                "open_follow_ups": [],
            },
            "answers_history": [],
        },
        "m_other": {
            "meeting_id": "m_other",
            "owner_uid": "someone_else",
            "title": "Private meeting",
            "transcript": "Secret transcript",
            "analysis": {"summary": "Other user summary", "clarification_required": False},
        },
    }

    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.get("/api/meetings/backup")
        assert response.status_code == 200
        payload = response.json()

        assert payload["version"] == "1.0"
        assert payload["backup_type"] == "meetmind_ai_meetings_backup"
        assert "exported_at" in payload
        assert payload["user"]["uid"] == owner_uid
        assert payload["user"]["email"] == "test_backup@meetmind.ai"
        assert payload["metrics"]["total_meetings"] == 1
        assert payload["metrics"]["total_action_items"] == 1
        assert payload["metrics"]["total_decisions"] == 1
        assert len(payload["meetings"]) == 1
        assert payload["meetings"][0]["meeting_id"] == "m_001"
        assert payload["meetings"][0]["title"] == "Sprint Planning"
    finally:
        firebase_service._client = orig_client


def test_export_backup_empty_library():
    """Verify that export succeeds cleanly for a user with zero saved meetings."""
    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.get("/api/meetings/backup")
        assert response.status_code == 200
        payload = response.json()

        assert payload["metrics"]["total_meetings"] == 0
        assert payload["metrics"]["total_action_items"] == 0
        assert payload["metrics"]["total_decisions"] == 0
        assert payload["meetings"] == []
    finally:
        firebase_service._client = orig_client


def test_export_backup_firestore_not_configured():
    """Verify 503 is returned if Firestore is not configured."""
    with patch.object(firebase_service, "is_configured", return_value=False):
        response = client.get("/api/meetings/backup")
        assert response.status_code == 503
        assert "not configured" in response.json()["detail"].lower()


# ==============================================================================
# 2. JSON Backup Restore Tests
# ==============================================================================


def sample_valid_backup():
    return {
        "version": "1.0",
        "backup_type": "meetmind_ai_meetings_backup",
        "exported_at": "2026-03-01T12:00:00Z",
        "user": {
            "uid": "any_source_uid",
            "email": "source@example.com",
            "is_demo_user": False,
        },
        "metrics": {
            "total_meetings": 2,
            "total_action_items": 1,
            "total_decisions": 1,
            "is_complete": True,
        },
        "meetings": [
            {
                "meeting_id": "m_restored_1",
                "title": "Architecture Review",
                "transcript": "Bob: We are migrating to PostgreSQL next week.",
                "created_at": "2026-02-28T09:00:00Z",
                "updated_at": "2026-02-28T09:00:00Z",
                "analysis": {
                    "meeting_id": "m_restored_1",
                    "summary": "Team agreed to migrate to PostgreSQL.",
                    "discussion_points": ["Database scaling"],
                    "decisions": ["Approved PostgreSQL migration"],
                    "action_items": [
                        {
                            "id": "act_1",
                            "task": "Create schema migration scripts",
                            "owner": "Bob",
                            "deadline": "Tuesday",
                            "status": "pending",
                        }
                    ],
                    "clarification_required": False,
                    "clarifications": [],
                    "open_follow_ups": [],
                },
                "answers_history": [],
            },
            {
                "meeting_id": "m_restored_2",
                "title": "Design Sync",
                "transcript": "Carol: Color tokens are updated in Figma.",
                "created_at": "2026-02-27T14:00:00Z",
                "updated_at": "2026-02-27T14:00:00Z",
                "analysis": {
                    "meeting_id": "m_restored_2",
                    "summary": "Figma design system tokens refreshed.",
                    "discussion_points": ["Dark mode contrast"],
                    "decisions": ["Use slate-950 for dark backgrounds"],
                    "action_items": [],
                    "clarification_required": False,
                    "clarifications": [],
                    "open_follow_ups": [],
                },
                "answers_history": [],
            },
        ],
    }


def test_restore_backup_success_skip_strategy():
    """Verify restore successfully writes new documents and skips existing ones when conflict_strategy=skip."""
    owner_uid = "user_test_backup"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            "owner_uid": owner_uid,
            "title": "Original Meeting 1",
            "transcript": "Existing transcript.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=skip", json=backup)
        assert response.status_code == 200
        result = response.json()

        assert result["status"] == "restored"
        assert result["total_records"] == 2
        assert result["imported_count"] == 1  # m_restored_2
        assert result["skipped_count"] == 1   # m_restored_1
        assert result["updated_count"] == 0

        # Existing doc was untouched
        assert docs["m_restored_1"]["title"] == "Original Meeting 1"
        # New doc was created and assigned to caller
        assert "m_restored_2" in docs
        assert docs["m_restored_2"]["owner_uid"] == owner_uid
        assert docs["m_restored_2"]["title"] == "Design Sync"
    finally:
        firebase_service._client = orig_client


def test_restore_backup_success_overwrite_strategy():
    """Verify restore updates existing documents when conflict_strategy=overwrite."""
    owner_uid = "user_test_backup"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            "owner_uid": owner_uid,
            "title": "Original Meeting 1",
            "transcript": "Existing transcript.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=overwrite", json=backup)
        assert response.status_code == 200
        result = response.json()

        assert result["status"] == "restored"
        assert result["total_records"] == 2
        assert result["imported_count"] == 1  # m_restored_2
        assert result["updated_count"] == 1   # m_restored_1 overwritten
        assert result["skipped_count"] == 0

        # Existing doc was updated
        assert docs["m_restored_1"]["title"] == "Architecture Review"
        assert docs["m_restored_1"]["owner_uid"] == owner_uid
    finally:
        firebase_service._client = orig_client


def test_restore_backup_cross_user_collision_protection():
    """Verify that if a meeting ID in the backup matches another user's document, it is never overwritten."""
    caller_uid = "user_test_backup"
    victim_uid = "victim_user_999"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            "owner_uid": victim_uid,
            "title": "Victim's Confidential Meeting",
            "transcript": "Top secret content.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=overwrite", json=backup)
        assert response.status_code == 200
        result = response.json()

        # The victim's document MUST remain completely untouched!
        assert docs["m_restored_1"]["owner_uid"] == victim_uid
        assert docs["m_restored_1"]["title"] == "Victim's Confidential Meeting"

        # The restored meeting was assigned a newly generated ID for caller
        caller_docs = [d for d in docs.values() if d.get("owner_uid") == caller_uid]
        assert len(caller_docs) == 2
        titles = {d.get("title") for d in caller_docs}
        assert "Architecture Review" in titles
        assert "Design Sync" in titles
    finally:
        firebase_service._client = orig_client


def test_restore_backup_rejects_unsupported_version():
    """Verify restore rejects backups with an unsupported schema version."""
    backup = sample_valid_backup()
    backup["version"] = "2.0"

    response = client.post("/api/meetings/restore", json=backup)
    assert response.status_code == 422 or response.status_code == 400
    detail = response.json().get("detail", "")
    assert "unsupported backup version" in str(detail).lower() or "version" in str(detail).lower()


def test_restore_backup_rejects_invalid_backup_type():
    """Verify restore rejects non-MeetMind backup payloads."""
    backup = sample_valid_backup()
    backup["backup_type"] = "generic_backup"

    response = client.post("/api/meetings/restore", json=backup)
    assert response.status_code == 422 or response.status_code == 400
    detail = response.json().get("detail", "")
    assert "invalid backup type" in str(detail).lower() or "backup_type" in str(detail).lower()


def test_restore_backup_rejects_empty_meetings():
    """Verify restore rejects a backup that has an empty meetings list."""
    backup = sample_valid_backup()
    backup["meetings"] = []

    response = client.post("/api/meetings/restore", json=backup)
    assert response.status_code == 422 or response.status_code == 400
    detail = response.json().get("detail", "")
    assert "no meeting records" in str(detail).lower() or "meetings" in str(detail).lower()


def test_restore_backup_rejects_internal_duplicate_ids():
    """Verify restore rejects a backup containing internal duplicate meeting IDs."""
    backup = sample_valid_backup()
    # Duplicate the first meeting ID
    backup["meetings"].append(backup["meetings"][0].copy())

    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.post("/api/meetings/restore", json=backup)
        assert response.status_code == 400
        assert "duplicate meeting id" in response.json()["detail"].lower()
    finally:
        firebase_service._client = orig_client


def test_restore_backup_rejects_missing_transcript():
    """Verify restore rejects a meeting missing its transcript before saving any documents."""
    backup = sample_valid_backup()
    backup["meetings"][0]["transcript"] = "   "

    mock_db = create_mock_firestore_client({})
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        response = client.post("/api/meetings/restore", json=backup)
        assert response.status_code == 400
        assert "empty transcript" in response.json()["detail"].lower()
        # Verify no documents were written
        assert len(mock_db.collection("meetings").document("m_restored_2").get().exists or []) == 0
    finally:
        firebase_service._client = orig_client


def test_restore_backup_rejects_malformed_json():
    """Verify HTTP 422/400 on malformed JSON payload."""
    response = client.post(
        "/api/meetings/restore",
        content="not a valid json string",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_restore_backup_excludes_credentials_and_secrets():
    """Verify credentials, tokens, or BYOK API keys injected into the JSON are never stored."""
    owner_uid = "user_test_backup"
    docs = {}
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        # Inject malicious / secret credentials into the payload
        backup["api_key"] = "AIzaSySecretApiKey123456"
        backup["meetings"][0]["gemini_api_key"] = "AIzaSySecretApiKeyInMeeting"
        backup["meetings"][0]["owner_uid"] = "attacker_uid"

        response = client.post("/api/meetings/restore", json=backup)
        assert response.status_code == 200

        doc1 = docs["m_restored_1"]
        # Forced caller ownership
        assert doc1["owner_uid"] == owner_uid
        # Secrets are completely absent
        assert "api_key" not in doc1
        assert "gemini_api_key" not in doc1
    finally:
        firebase_service._client = orig_client


def test_restore_backup_firestore_batch_failure_raises_502():
    """Verify that if Firestore batch commit fails, 502 Bad Gateway is returned."""
    mock_db = create_mock_firestore_client({})
    mock_batch = MagicMock()
    mock_batch.commit.side_effect = Exception("Firestore atomic transaction failed")
    mock_db.batch.side_effect = None
    mock_db.batch.return_value = mock_batch

    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore", json=backup)
        assert response.status_code == 502
        detail = response.json()["detail"].lower()
        assert "failed to commit" in detail or "unavailable" in detail
    finally:
        firebase_service._client = orig_client


def test_restore_backup_existing_missing_owner_uid_never_overwritten():
    """
    Verify that an existing document with a missing owner_uid (or None) is never overwritten,
    even when conflict_strategy='overwrite'. A fresh unique meeting ID must be allocated for the caller.
    """
    caller_uid = "user_test_backup"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            # owner_uid is missing entirely
            "title": "Unowned Legacy Document",
            "transcript": "Legacy transcript that must not be altered.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=overwrite", json=backup)
        assert response.status_code == 200
        result = response.json()

        # Existing unowned document MUST remain untouched
        assert docs["m_restored_1"]["title"] == "Unowned Legacy Document"
        assert "owner_uid" not in docs["m_restored_1"]

        # Caller gets fresh IDs: 2 imported, 0 updated, 0 skipped
        assert result["imported_count"] == 2
        assert result["updated_count"] == 0
        assert result["skipped_count"] == 0

        # Restored records are owned by caller under new ID
        caller_docs = [d for d in docs.values() if d.get("owner_uid") == caller_uid]
        assert len(caller_docs) == 2
        titles = {d.get("title") for d in caller_docs}
        assert "Architecture Review" in titles
        assert "Design Sync" in titles
    finally:
        firebase_service._client = orig_client


def test_restore_backup_existing_empty_owner_uid_never_overwritten():
    """
    Verify that an existing document with an empty or whitespace owner_uid is never overwritten,
    even when conflict_strategy='overwrite'. A fresh unique meeting ID must be allocated.
    """
    caller_uid = "user_test_backup"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            "owner_uid": "   ",  # whitespace owner
            "title": "Blank Owner Document",
            "transcript": "Blank owner transcript.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=overwrite", json=backup)
        assert response.status_code == 200
        result = response.json()

        # Existing document remains untouched
        assert docs["m_restored_1"]["title"] == "Blank Owner Document"
        assert docs["m_restored_1"]["owner_uid"] == "   "

        # 2 imported, 0 updated
        assert result["imported_count"] == 2
        assert result["updated_count"] == 0

        caller_docs = [d for d in docs.values() if d.get("owner_uid") == caller_uid]
        assert len(caller_docs) == 2
    finally:
        firebase_service._client = orig_client


def test_restore_backup_exact_caller_owner_uid_overwritten():
    """
    Verify that an existing document IS overwritten ONLY when existing_owner exactly matches clean_uid.
    """
    caller_uid = "user_test_backup"
    docs = {
        "m_restored_1": {
            "meeting_id": "m_restored_1",
            "owner_uid": caller_uid,  # exact match
            "title": "Old Caller Title",
            "transcript": "Old caller transcript.",
        }
    }
    mock_db = create_mock_firestore_client(docs)
    orig_client = firebase_service._client
    firebase_service.set_client(mock_db)

    try:
        backup = sample_valid_backup()
        response = client.post("/api/meetings/restore?conflict_strategy=overwrite", json=backup)
        assert response.status_code == 200
        result = response.json()

        # Document was overwritten
        assert result["updated_count"] == 1
        assert result["imported_count"] == 1  # m_restored_2 was new
        assert docs["m_restored_1"]["title"] == "Architecture Review"
        assert docs["m_restored_1"]["owner_uid"] == caller_uid
    finally:
        firebase_service._client = orig_client


def test_allocate_unique_meeting_id_avoids_collisions():
    """
    Verify that _allocate_unique_meeting_id generates a new ID if candidate collides with existing document.
    """
    docs = {
        "m_colliding_1": {"meeting_id": "m_colliding_1", "owner_uid": "someone"},
    }
    mock_db = create_mock_firestore_client(docs)
    coll_ref = mock_db.collection("meetings")

    reserved = {"m_colliding_1"}
    # Patch generate_meeting_id to return m_colliding_1 first, then m_fresh_2
    call_count = 0

    def mock_generate():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "m_colliding_1"
        return "m_fresh_2"

    with patch.object(firebase_service, "generate_meeting_id", side_effect=mock_generate):
        allocated = firebase_service._allocate_unique_meeting_id(coll_ref, reserved)
        assert allocated == "m_fresh_2"
        assert "m_fresh_2" in reserved


def test_allocate_unique_meeting_id_propagates_firestore_error():
    """
    Verify that if Firestore .get() raises an error during uniqueness check,
    _allocate_unique_meeting_id raises FirebaseOperationError and never returns an unverified candidate.
    """
    mock_db = MagicMock()
    mock_col = MagicMock()
    mock_doc = MagicMock()
    mock_doc.get.side_effect = Exception("Firestore socket timeout")
    mock_col.document.return_value = mock_doc
    mock_db.collection.return_value = mock_col

    reserved = set()
    with pytest.raises(FirebaseOperationError) as exc_info:
        firebase_service._allocate_unique_meeting_id(mock_col, reserved)

    assert "Failed to verify meeting ID uniqueness in Firestore" in str(exc_info.value)
    assert len(reserved) == 0


def test_allocate_unique_meeting_id_exhaustion_raises_error():
    """
    Verify that if collision retries are exhausted across all attempts (including fallback),
    _allocate_unique_meeting_id raises FirebaseOperationError.
    """
    mock_db = MagicMock()
    mock_col = MagicMock()
    mock_doc = MagicMock()
    # Simulate that EVERY candidate already exists in Firestore
    mock_snap = MagicMock()
    mock_snap.exists = True
    mock_doc.get.return_value = mock_snap
    mock_col.document.return_value = mock_doc
    mock_db.collection.return_value = mock_col

    reserved = set()
    with pytest.raises(FirebaseOperationError) as exc_info:
        firebase_service._allocate_unique_meeting_id(mock_col, reserved, max_attempts=15)

    assert "Failed to allocate a unique meeting ID after 15 attempts due to collisions" in str(exc_info.value)


def test_allocate_unique_meeting_id_fallback_checks_firestore_and_reserved():
    """
    Verify that high-entropy fallback (attempt >= 10) is checked against both reserved_ids
    and Firestore before being accepted.
    """
    mock_col = MagicMock()
    attempt_count = 0
    checked_candidates = []

    def mock_document(candidate_id):
        nonlocal attempt_count
        checked_candidates.append(candidate_id)
        mock_doc = MagicMock()

        def mock_get():
            nonlocal attempt_count
            attempt_count += 1
            snap = MagicMock()
            # First 10 attempts (standard IDs) collide; 11th attempt (fallback) succeeds
            snap.exists = (attempt_count <= 10)
            return snap

        mock_doc.get.side_effect = mock_get
        return mock_doc

    mock_col.document.side_effect = mock_document

    reserved = set()
    allocated = firebase_service._allocate_unique_meeting_id(mock_col, reserved, max_attempts=15)

    # Must have attempted 11 times
    assert attempt_count == 11
    # 11th candidate is the high-entropy fallback (contains timestamp and full uuid hex)
    assert allocated in reserved
    assert allocated == checked_candidates[-1]
    assert allocated.startswith("m_")
    # Verify fallback ID has full uuid hex (32 hex characters)
    parts = allocated.split("_")
    assert len(parts) == 3
    assert len(parts[2]) == 32
