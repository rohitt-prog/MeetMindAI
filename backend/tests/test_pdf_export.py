import io
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.meeting import (
    MeetingAnalysisResponse,
    ActionItem,
    ClarificationItem,
    MeetingDetailResponse,
)
from app.services.firebase_service import (
    FirebaseService,
    FirebaseNotFoundError,
    firebase_service,
)
from app.services.pdf_service import pdf_service

client = TestClient(app)

MOCK_COMPLETE_ANALYSIS = {
    "meeting_id": "m_1730650000_a1b2c3d4",
    "summary": "The team agreed on redesign milestones, resolved authentication blockers, and scheduled next review.",
    "discussion_points": [
        "Figma design system token handoff from David",
        "GraphQL schema updates for user preferences",
        "Staging sandbox test credentials requirement",
    ],
    "decisions": [
        "Alex will finalize GraphQL endpoints by Wednesday at 4 PM",
        "Session expiration timeout set to 30 minutes",
    ],
    "action_items": [
        {
            "id": "action_1",
            "task": "Confirm and finalize GraphQL schema changes",
            "owner": "Alex",
            "deadline": "Wednesday 4 PM",
            "status": "pending",
        },
        {
            "id": "action_2",
            "task": "Provision test credentials for the staging sandbox",
            "owner": None,
            "deadline": None,
            "status": "pending",
        },
    ],
    "clarification_required": True,
    "clarification_question": "Who will provision test credentials for the staging sandbox?",
    "clarifications": [
        {
            "id": "clarif_1",
            "category": "ownership",
            "original_statement": "Someone should provision staging access by tomorrow morning.",
            "explanation": "No specific individual assigned.",
            "question": "Who will provision test credentials for the staging sandbox?",
            "related_action_item_id": "action_2",
            "resolved": False,
        }
    ],
}


def test_pdf_export_complete_meeting():
    """
    Test POST /api/meetings/export/pdf with full analysis and transcript.
    Verifies 200 OK, application/pdf content type, correct filename header, and valid PDF bytes.
    """
    payload = {
        "title": "Mobile App Redesign Sync",
        "transcript": "Sarah: Let us review blockers.\nAlex: I will finalize GraphQL endpoint by Wednesday.\nPriya: Someone provision credentials.",
        "analysis": MOCK_COMPLETE_ANALYSIS,
        "answers_history": [
            {
                "clarification_id": "clarif_1",
                "answer": "David from DevOps will provision credentials.",
                "timestamp": "2026-11-03T20:00:00Z",
            }
        ],
    }

    response = client.post("/api/meetings/export/pdf", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'attachment; filename="meetmind_mobile_app_redesign_sync.pdf"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")
    assert len(response.content) > 2000


def test_pdf_export_missing_optional_fields():
    """
    Test POST /api/meetings/export/pdf when title, transcript, and optional fields are missing or null.
    Verifies that the PDF generator falls back gracefully without crashing.
    """
    minimal_analysis = {
        "summary": "Brief summary.",
        "discussion_points": [],
        "decisions": [],
        "action_items": [
            {"id": "a1", "task": "Minimal task", "owner": None, "deadline": None, "status": "pending"}
        ],
        "clarification_required": False,
        "clarifications": [],
    }

    payload = {
        "title": None,
        "transcript": None,
        "analysis": minimal_analysis,
    }

    response = client.post("/api/meetings/export/pdf", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'attachment; filename="meetmind_meeting_report.pdf"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")


def test_pdf_export_multipage_content():
    """
    Test PDF generation with large volumes of content (20+ action items, 50-line transcript)
    to ensure flowables span multiple pages cleanly without layout overflow errors.
    """
    many_action_items = [
        {
            "id": f"action_{i}",
            "task": f"Detailed delivery requirement for microservice component {i} including load testing and security review",
            "owner": "Engineer" if i % 2 == 0 else None,
            "deadline": f"Sprint Week {i}",
            "status": "pending",
        }
        for i in range(1, 25)
    ]

    transcript_lines = [
        f"Speaker {i % 3}: Dialogue statement {i} discussing cross-team alignment and architectural prerequisites."
        for i in range(1, 60)
    ]

    multipage_analysis = {
        "summary": "An extensive architecture sync with 24 deliverables and detailed operational questions.",
        "discussion_points": [f"Topic {i} discussion point" for i in range(1, 8)],
        "decisions": [f"Decision {i} finalized" for i in range(1, 5)],
        "action_items": many_action_items,
        "clarification_required": False,
        "clarifications": [],
    }

    payload = {
        "title": "Quarterly Planning & Multi-Page Sync",
        "transcript": "\n".join(transcript_lines),
        "analysis": multipage_analysis,
    }

    response = client.post("/api/meetings/export/pdf", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    # Multi-page PDF should be substantially larger than 5KB
    assert len(response.content) > 8000


def test_export_saved_meeting_pdf_success():
    """
    Test GET /api/meetings/{meeting_id}/export/pdf fetches from Firestore and generates PDF.
    """
    mock_detail = MeetingDetailResponse(
        meeting_id="m_persisted_999",
        title="Persisted Roadmap Sync",
        transcript="Sarah: Roadmap review.\nAlex: I will deliver feature by Friday.",
        created_at="2026-11-03T18:00:00Z",
        updated_at="2026-11-03T18:30:00Z",
        analysis=MeetingAnalysisResponse(**MOCK_COMPLETE_ANALYSIS),
        answers_history=[
            {"clarification_id": "clarif_1", "answer": "Resolved by David.", "timestamp": "2026-11-03T18:30:00Z"}
        ],
    )

    mock_service = MagicMock(spec=FirebaseService)
    mock_service.is_configured.return_value = True
    mock_service.get_meeting.return_value = mock_detail

    with patch("app.api.routes.meetings.firebase_service", mock_service):
        response = client.get("/api/meetings/m_persisted_999/export/pdf")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert 'attachment; filename="meetmind_persisted_roadmap_sync.pdf"' in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF-")
        mock_service.get_meeting.assert_called_once_with(meeting_id="m_persisted_999")


def test_export_saved_meeting_pdf_not_found():
    """
    Test GET /api/meetings/{meeting_id}/export/pdf returns 404 when meeting does not exist in Firestore.
    """
    mock_service = MagicMock(spec=FirebaseService)
    mock_service.is_configured.return_value = True
    mock_service.get_meeting.side_effect = FirebaseNotFoundError("Meeting 'm_missing' not found in Firestore.")

    with patch("app.api.routes.meetings.firebase_service", mock_service):
        response = client.get("/api/meetings/m_missing/export/pdf")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


def test_export_saved_meeting_pdf_unconfigured():
    """
    Test GET /api/meetings/{meeting_id}/export/pdf returns 503 when Firebase is not configured.
    """
    mock_service = MagicMock(spec=FirebaseService)
    mock_service.is_configured.return_value = False

    with patch("app.api.routes.meetings.firebase_service", mock_service):
        response = client.get("/api/meetings/m_any/export/pdf")
        assert response.status_code == 503
        assert "Firebase Firestore is not configured" in response.json()["detail"]


def test_pdf_export_invalid_input():
    """
    Test POST /api/meetings/export/pdf with invalid body (missing required analysis object).
    """
    response = client.post("/api/meetings/export/pdf", json={"title": "Only Title"})
    assert response.status_code == 422  # Unprocessable Entity (Pydantic validation failure)


def test_sanitize_filename_edge_cases():
    """
    Unit test PdfService.sanitize_filename with diverse inputs.
    """
    # 1. Standard title
    fn1 = pdf_service.sanitize_filename("Quarterly Planning Meeting")
    assert fn1 == "meetmind_quarterly_planning_meeting.pdf"

    # 2. Punctuation and symbols
    fn2 = pdf_service.sanitize_filename("DevOps / SRE Sync: [Blockers & Fixes] #1!")
    assert fn2 == "meetmind_devops_sre_sync_blockers_fixes_1.pdf"

    # 3. Truncation of extremely long title
    long_title = "This is a super long meeting title that extends well past the reasonable length limit of typical filenames"
    fn3 = pdf_service.sanitize_filename(long_title)
    assert fn3.startswith("meetmind_")
    assert fn3.endswith(".pdf")
    assert len(fn3) <= 60

    # 4. Empty or None title with meeting_id
    fn4 = pdf_service.sanitize_filename(None, "m_12345_abc")
    assert fn4 == "meetmind_m_12345_abc.pdf"

    # 5. Empty title and empty meeting_id
    fn5 = pdf_service.sanitize_filename("   ", "")
    assert fn5 == "meetmind_meeting_report.pdf"
