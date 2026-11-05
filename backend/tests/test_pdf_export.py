import base64
import io
import re
import zlib
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


def extract_pdf_stream_text(pdf_bytes: bytes) -> str:
    """
    Extracts and decompresses stream text from a ReportLab-generated PDF.
    Decodes Adobe ASCII85 and FlateDecode streams to inspect rendered text.
    """
    extracted_chunks = []
    idx = 0
    while True:
        s_idx = pdf_bytes.find(b"stream", idx)
        if s_idx == -1:
            break
        s_data = pdf_bytes.find(b"\n", s_idx) + 1
        e_idx = pdf_bytes.find(b"endstream", s_data)
        if e_idx == -1:
            break
        stream_bytes = pdf_bytes[s_data:e_idx].strip()
        try:
            flate = base64.a85decode(stream_bytes, adobe=True)
            decomp = zlib.decompress(flate)
            extracted_chunks.append(decomp.decode("latin1", errors="ignore"))
        except Exception:
            try:
                decomp = zlib.decompress(stream_bytes)
                extracted_chunks.append(decomp.decode("latin1", errors="ignore"))
            except Exception:
                extracted_chunks.append(stream_bytes.decode("latin1", errors="ignore"))
        idx = e_idx + 9
    return "\n".join(extracted_chunks)

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

    # Validate actual extracted/rendered PDF stream content
    stream_text = extract_pdf_stream_text(response.content)
    assert "MEETMIND AI" in stream_text
    assert "EXECUTIVE REPORT" in stream_text
    assert "Mobile App Redesign Sync" in stream_text
    assert "1. Executive Summary" in stream_text
    assert "redesign milestones" in stream_text
    assert "2. Key Discussion Topics" in stream_text
    assert "Figma design system token handoff" in stream_text
    assert "3. Confirmed Decisions" in stream_text
    assert "Alex will finalize GraphQL endpoints" in stream_text
    assert "[CONFIRMED]" in stream_text
    assert "4. Assigned Action Items & Deliverables" in stream_text
    assert "GraphQL schema changes" in stream_text
    assert "Alex" in stream_text
    assert "5. Ambiguity Detection & Clarification Audit" in stream_text
    assert "Who will provision test credentials" in stream_text
    assert "[RESOLVED]" in stream_text
    assert "David from DevOps will provision credentials" in stream_text
    assert "6. Source Meeting Transcript" in stream_text
    assert "Sarah: Let us review blockers" in stream_text
    assert "Page 1 of" in stream_text


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

    # Validate actual multi-page stream content and running header/footer
    multipage_text = extract_pdf_stream_text(response.content)
    assert "Page 1 of" in multipage_text
    assert "Page 2 of" in multipage_text
    assert "MEETMIND AI" in multipage_text
    assert "EXECUTIVE INTELLIGENCE REPORT" in multipage_text
    assert "Quarterly Planning" in multipage_text


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
        mock_service.get_meeting.assert_called_once_with(meeting_id="m_persisted_999", owner_uid="test_user_default")


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


def test_pdf_export_deferred_open_follow_ups():
    """
    Test PDF compilation for an analysis with deferred follow-ups.
    Verifies that the PDF generates successfully and handles the deferred follow-ups cards.
    """
    analysis_with_followups = {
        "summary": "Product launch meeting with deferred marketing task.",
        "discussion_points": ["Marketing handoff", "Payment integration"],
        "decisions": ["Deploy Stripe flow by Tuesday"],
        "action_items": [
            {
                "id": "action_1",
                "task": "Inform the marketing team",
                "owner": None,
                "deadline": None,
                "status": "deferred: next meeting",
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": [],
        "open_follow_ups": [
            "Inform the marketing team (owner to be decided in next meeting)"
        ],
    }

    pdf_bytes = pdf_service.generate_meeting_pdf(
        analysis=MeetingAnalysisResponse.model_validate(analysis_with_followups),
        title="Product Launch Planning Sync",
        transcript="Maya: We need to inform marketing, but let's decide who will do that in the next meeting.",
    )

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF-")


def test_pdf_export_vague_deadline_and_active_clarification():
    """
    Test PDF compilation with an action item having a preserved vague deadline ('Friday')
    and an active clarification requirement.
    """
    analysis_vague_deadline = {
        "summary": "QA team sync for regression testing.",
        "discussion_points": ["Test environment readiness"],
        "decisions": [],
        "action_items": [
            {
                "id": "action_1",
                "task": "Prepare the regression test report",
                "owner": "David",
                "deadline": "Friday",
                "status": "pending",
            }
        ],
        "clarification_required": True,
        "clarification_question": "Which specific Friday is intended for the regression test report?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "deadline",
                "original_statement": "David: I'll prepare the regression test report by Friday.",
                "explanation": "Specific calendar Friday is unspecified.",
                "question": "Which specific Friday is intended for the regression test report?",
                "related_action_item_id": "action_1",
                "resolved": False,
            }
        ],
        "open_follow_ups": [],
    }

    pdf_bytes = pdf_service.generate_meeting_pdf(
        analysis=MeetingAnalysisResponse.model_validate(analysis_vague_deadline),
        title="QA Regression Sync",
        transcript="David: I'll prepare the regression test report by Friday.",
    )

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF-")


def test_pdf_export_resolved_meeting():
    """
    Test PDF compilation where clarifications were answered and marked resolved.
    """
    analysis_resolved = {
        "summary": "Meeting with resolved clarifications.",
        "discussion_points": ["Deployment timeline"],
        "decisions": ["Deploy on Friday, Nov 14th"],
        "action_items": [
            {
                "id": "action_1",
                "task": "Execute deployment",
                "owner": "David",
                "deadline": "Friday, Nov 14th at 5 PM",
                "status": "completed",
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "deadline",
                "original_statement": "Deploy by Friday.",
                "explanation": "Resolved with specific date.",
                "question": "Which Friday?",
                "related_action_item_id": "action_1",
                "resolved": True,
            }
        ],
        "open_follow_ups": [],
    }

    pdf_bytes = pdf_service.generate_meeting_pdf(
        analysis=MeetingAnalysisResponse.model_validate(analysis_resolved),
        title="Deployment Complete",
        answers_history=[
            {
                "clarification_id": "clarif_1",
                "answer": "Friday, Nov 14th at 5 PM",
            }
        ],
    )

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF-")


def test_pdf_export_byok_privacy_and_credential_exclusion():
    """
    Phase 2D Security Guarantee:
    Verifies that user API keys (BYOK) are NEVER included in PDF content, headers, or metadata,
    and that the PDF export endpoint does not require or process Gemini API keys.
    """
    sensitive_byok_key = "AIzaSySecretBYOKKey999Phase2D"

    payload = {
        "title": "Executive Privacy & Security Sync",
        "transcript": "Sarah: Reviewing BYOK credential isolation.\nAlex: No secrets in exported documents.",
        "analysis": MOCK_COMPLETE_ANALYSIS,
    }

    # Pass BYOK header to export endpoint - should be completely ignored/excluded
    response = client.post(
        "/api/meetings/export/pdf",
        json=payload,
        headers={"X-Gemini-API-Key": sensitive_byok_key, "X-Gemini-Model": "gemini-2.5-pro"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"

    # 1. Verify key does not appear in response headers
    for header_name, header_val in response.headers.items():
        assert sensitive_byok_key not in header_val, f"BYOK key leaked in header '{header_name}'"

    # 2. Verify key does not appear in binary PDF stream
    raw_pdf_bytes = response.content
    assert sensitive_byok_key.encode("utf-8") not in raw_pdf_bytes, "BYOK key leaked in PDF binary content"

    # 3. Verify key does not appear in decompressed stream text
    stream_text = extract_pdf_stream_text(raw_pdf_bytes)
    assert sensitive_byok_key not in stream_text, "BYOK key leaked in decompressed PDF stream text"


def test_pdf_export_without_gemini_configured():
    """
    Verifies that PDF export operates completely offline and independently of Gemini credentials.
    """
    with patch("app.core.config.settings.GEMINI_API_KEY", ""):
        response = client.post(
            "/api/meetings/export/pdf",
            json={
                "title": "Offline PDF Export Test",
                "analysis": MOCK_COMPLETE_ANALYSIS,
            },
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF-")


def test_pdf_export_xml_escaping_special_chars():
    """
    Verifies that XML special characters (&, <, >, ", ') and symbols in meeting titles,
    summaries, discussion points, decisions, and action items do not break ReportLab XML parsing.
    """
    special_analysis = {
        "summary": "Testing special characters: & < > \" ' and symbols in executive summary.",
        "discussion_points": [
            "Topic with <tags> & ampersands",
            "Quotes: \"double\" & 'single'",
        ],
        "decisions": [
            "Approved: cost < $500 & quality > 90%",
        ],
        "action_items": [
            {
                "id": "action_special",
                "task": "Task with <xml> & entities & symbols <= =>",
                "owner": "Sarah & Alex",
                "deadline": "Q3 < 2027",
                "status": "in_progress",
            }
        ],
        "clarification_required": False,
        "clarifications": [],
        "open_follow_ups": ["Deferred item with & < > symbols"],
    }

    pdf_bytes = pdf_service.generate_meeting_pdf(
        analysis=MeetingAnalysisResponse.model_validate(special_analysis),
        title="Title with <Special> & 'Symbols' \"Report\"",
        transcript="Speaker: Discussion of <tags> & symbols.",
    )

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 2000

    # 4. Verify rendered text in decompressed stream preserves content with special characters
    stream_text = extract_pdf_stream_text(pdf_bytes)
    assert "Testing special characters:" in stream_text
    assert "Approved: cost <" in stream_text
    assert "quality > 90%" in stream_text
    assert "Task with" in stream_text
    assert "entities & symbols" in stream_text
    assert "Deferred item with" in stream_text

