import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.gemini_service import (
    GeminiService,
    GeminiConfigError,
    GeminiAnalysisError,
    gemini_service,
)
from app.schemas.meeting import (
    ActionItem,
    ClarificationItem,
    MeetingAnalysisResponse,
)

client = TestClient(app)

MOCK_INSIGHTS_DICT = {
    "summary": "The team aligned on the mobile app redesign milestones and resolved authentication blockers.",
    "discussion_points": [
        "Figma design system token handoff",
        "GraphQL schema updates for user preferences",
        "Session timeout configuration"
    ],
    "decisions": [
        "Session expiration timeout is established at 30 minutes"
    ],
    "action_items": [
        {
            "id": "action_1",
            "task": "Confirm GraphQL schema changes for user preferences",
            "owner": "Alex",
            "deadline": "Wednesday 4 PM",
            "status": "pending"
        },
        {
            "id": "action_2",
            "task": "Provision test credentials for staging sandbox",
            "owner": None,
            "deadline": "Tomorrow morning",
            "status": "pending"
        }
    ],
    "clarification_required": True,
    "clarification_question": "Who will be assigned to provision test credentials for the staging sandbox?",
    "clarifications": [
        {
            "id": "clarif_1",
            "category": "ownership",
            "original_statement": "Someone should provision staging access by tomorrow morning.",
            "explanation": "No specific individual or team was assigned to provision staging access.",
            "question": "Who will be assigned to provision test credentials for the staging sandbox?",
            "related_action_item_id": "action_2",
            "resolved": False
        }
    ]
}

MOCK_VALID_TRANSCRIPT = (
    "Sarah: Let's review the blockers for the milestone release.\n"
    "David: The Figma design system tokens are complete. I need Alex to confirm GraphQL changes by Wednesday 4 PM.\n"
    "Alex: I will finalize the endpoint by Wednesday 4 PM.\n"
    "Priya: We need test credentials for the staging sandbox. Who is provisioning them?\n"
    "Sarah: Someone should provision staging access by tomorrow morning."
)


# ==============================================================================
# Phase 2 Regression Tests
# ==============================================================================

def test_analyze_valid_transcript():
    """
    Test POST /api/meetings/analyze with a valid transcript and mocked Gemini response.
    """
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(MOCK_INSIGHTS_DICT)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={
                "title": "Mobile App Sync",
                "transcript": MOCK_VALID_TRANSCRIPT,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"] == MOCK_INSIGHTS_DICT["summary"]
        assert len(data["discussion_points"]) == 3
        assert len(data["decisions"]) == 1
        assert len(data["action_items"]) == 2
        assert data["action_items"][0]["owner"] == "Alex"
        assert data["action_items"][1]["owner"] is None
        assert data["clarification_required"] is True
        assert "provision test credentials" in data["clarification_question"]
        assert len(data["clarifications"]) == 1
        assert data["clarifications"][0]["id"] == "clarif_1"
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_analyze_empty_transcript_validation():
    """
    Test that empty transcript or whitespace-only transcript is rejected with 400 or 422.
    """
    # Test completely empty string
    response_empty = client.post(
        "/api/meetings/analyze",
        json={"title": "Test Meeting", "transcript": ""},
    )
    assert response_empty.status_code in [400, 422]

    # Test whitespace-only string
    response_whitespace = client.post(
        "/api/meetings/analyze",
        json={"title": "Test Meeting", "transcript": "   \n\t  "},
    )
    assert response_whitespace.status_code in [400, 422]

    # Test missing transcript field
    response_missing = client.post(
        "/api/meetings/analyze",
        json={"title": "Test Meeting"},
    )
    assert response_missing.status_code == 422


def test_gemini_response_parsing_with_markdown_fences():
    """
    Test that markdown code fences (```json ... ```) are cleanly stripped and parsed.
    """
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = f"```json\n{json.dumps(MOCK_INSIGHTS_DICT, indent=2)}\n```"
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": MOCK_VALID_TRANSCRIPT},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"] == MOCK_INSIGHTS_DICT["summary"]
        assert data["clarification_required"] is True
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_gemini_api_error_handling():
    """
    Test that an upstream Gemini API error returns 502 Bad Gateway without exposing keys.
    """
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = Exception("Resource has been exhausted (quota exceeded)")

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": MOCK_VALID_TRANSCRIPT},
        )

        assert response.status_code == 502
        assert "Gemini API request failed" in response.json()["detail"]
        assert "quota exceeded" in response.json()["detail"]
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_missing_api_key_behavior():
    """
    Test that when GEMINI_API_KEY is not configured or is a placeholder, a 503 is returned.
    """
    empty_service = GeminiService(api_key="")

    with patch("app.api.routes.meetings.gemini_service", empty_service):
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": MOCK_VALID_TRANSCRIPT},
        )
        assert response.status_code == 503
        assert "Gemini API key is not configured" in response.json()["detail"]


def test_unparseable_gemini_response():
    """
    Test that invalid non-JSON output from Gemini returns 502 Bad Gateway.
    """
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "Sorry, I am not able to generate JSON output."
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": MOCK_VALID_TRANSCRIPT},
        )

        assert response.status_code == 502
        assert "Failed to parse structured meeting insights" in response.json()["detail"]
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


# ==============================================================================
# Phase 3 Ambiguity Detection & Clarification Workflow Tests
# ==============================================================================

def test_clear_transcript_no_clarification():
    """
    Test meeting analysis with unambiguous instructions: no clarification required.
    """
    clear_insights = {
        "summary": "Team aligned on shipping staging environment on Friday.",
        "discussion_points": ["Staging deployment schedule"],
        "decisions": ["Deploy build to staging on Friday at 5 PM"],
        "action_items": [
            {
                "id": "action_1",
                "task": "Deploy staging build",
                "owner": "David",
                "deadline": "Friday 5 PM",
                "status": "pending"
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": []
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(clear_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": "David will deploy the staging build on Friday at 5 PM."},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["clarification_required"] is False
        assert data["clarification_question"] is None
        assert len(data["clarifications"]) == 0
        assert data["action_items"][0]["owner"] == "David"
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_ambiguous_owner_detection():
    """
    Test detecting ambiguous ownership ('Someone should send the report').
    Owner must be null and a structured clarification must be generated.
    """
    owner_ambiguous_insights = {
        "summary": "Discussed monthly progress report delivery.",
        "discussion_points": ["Progress report submission"],
        "decisions": [],
        "action_items": [
            {
                "id": "action_1",
                "task": "Send the monthly progress report",
                "owner": None,
                "deadline": "End of week",
                "status": "pending"
            }
        ],
        "clarification_required": True,
        "clarification_question": "Who will be responsible for sending the monthly progress report?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone should send the report by end of week.",
                "explanation": "No owner was assigned for sending the report.",
                "question": "Who will be responsible for sending the monthly progress report?",
                "related_action_item_id": "action_1",
                "resolved": False
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(owner_ambiguous_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": "Someone should send the report by end of week."},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["clarification_required"] is True
        assert data["action_items"][0]["owner"] is None
        assert len(data["clarifications"]) == 1
        assert data["clarifications"][0]["category"] == "ownership"
        assert data["clarifications"][0]["related_action_item_id"] == "action_1"
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_ambiguous_deadline_detection():
    """
    Test detecting ambiguous deadline ('Let's finish this by Friday').
    """
    deadline_ambiguous_insights = {
        "summary": "Team agreed to finish the sprint review.",
        "discussion_points": ["Sprint review completion"],
        "decisions": [],
        "action_items": [
            {
                "id": "action_1",
                "task": "Finish the sprint review document",
                "owner": "Sarah",
                "deadline": None,
                "status": "pending"
            }
        ],
        "clarification_required": True,
        "clarification_question": "Which specific Friday and time is intended for finishing the sprint review?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "deadline",
                "original_statement": "Let's finish this by Friday.",
                "explanation": "The specific calendar date and time for Friday was not specified.",
                "question": "Which specific Friday and time is intended for finishing the sprint review?",
                "related_action_item_id": "action_1",
                "resolved": False
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(deadline_ambiguous_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": "Sarah: Let's finish this by Friday."},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["action_items"][0]["deadline"] is None
        assert data["clarifications"][0]["category"] == "deadline"
        assert data["clarification_required"] is True
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_suggestion_vs_decision_detection():
    """
    Test that a suggestion ('We should consider launching next month')
    is NOT recorded as an approved decision, and is flagged for clarification.
    """
    suggestion_insights = {
        "summary": "Team discussed launch timelines and considered target dates.",
        "discussion_points": ["Launch timeline proposal"],
        "decisions": [],  # NOT added as decision
        "action_items": [],
        "clarification_required": True,
        "clarification_question": "Was launching next month agreed upon as an approved decision, or is it an open suggestion?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "decision_vs_suggestion",
                "original_statement": "We should consider launching next month.",
                "explanation": "This statement was framed as a suggestion rather than a confirmed team decision.",
                "question": "Was launching next month agreed upon as an approved decision, or is it an open suggestion?",
                "related_action_item_id": None,
                "resolved": False
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(suggestion_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": "Alex: We should consider launching next month."},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["decisions"]) == 0
        assert len(data["clarifications"]) == 1
        assert data["clarifications"][0]["category"] == "decision_vs_suggestion"
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_multiple_distinct_clarifications():
    """
    Test transcript producing multiple distinct clarifications (ownership + deadline).
    """
    multi_clarif_insights = {
        "summary": "Discussed analytics pipeline and release review.",
        "discussion_points": ["Analytics pipeline", "Release review"],
        "decisions": [],
        "action_items": [
            {
                "id": "action_1",
                "task": "Export analytics telemetry",
                "owner": None,
                "deadline": None,
                "status": "pending"
            },
            {
                "id": "action_2",
                "task": "Review release checklist",
                "owner": "Priya",
                "deadline": None,
                "status": "pending"
            }
        ],
        "clarification_required": True,
        "clarification_question": "Who will handle exporting analytics telemetry?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone needs to export analytics telemetry.",
                "explanation": "No owner assigned for telemetry export.",
                "question": "Who will handle exporting analytics telemetry?",
                "related_action_item_id": "action_1",
                "resolved": False
            },
            {
                "id": "clarif_2",
                "category": "deadline",
                "original_statement": "Priya will review release checklist sometime soon.",
                "explanation": "No clear deadline specified for checklist review.",
                "question": "What is the specific due date for Priya to review the release checklist?",
                "related_action_item_id": "action_2",
                "resolved": False
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(multi_clarif_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/analyze",
            json={"transcript": "Someone needs to export analytics telemetry. Priya will review release checklist sometime soon."},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["clarifications"]) == 2
        categories = {c["category"] for c in data["clarifications"]}
        assert "ownership" in categories
        assert "deadline" in categories
        assert data["clarification_required"] is True
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_clarify_valid_answer_resolves_ambiguity():
    """
    Test POST /api/meetings/clarify when a valid answer is submitted.
    The related action item should be updated and clarification marked resolved.
    """
    initial_analysis = MeetingAnalysisResponse.model_validate(MOCK_INSIGHTS_DICT)

    resolved_insights = {
        "summary": "The team aligned on mobile app redesign milestones and assigned staging access to David.",
        "discussion_points": [
            "Figma design system token handoff",
            "GraphQL schema updates for user preferences",
            "Session timeout configuration"
        ],
        "decisions": [
            "Session expiration timeout is established at 30 minutes"
        ],
        "action_items": [
            {
                "id": "action_1",
                "task": "Confirm GraphQL schema changes for user preferences",
                "owner": "Alex",
                "deadline": "Wednesday 4 PM",
                "status": "pending"
            },
            {
                "id": "action_2",
                "task": "Provision test credentials for staging sandbox",
                "owner": "David",  # Owner resolved!
                "deadline": "Tomorrow morning",
                "status": "pending"
            }
        ],
        "clarification_required": False,
        "clarification_question": None,
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone should provision staging access by tomorrow morning.",
                "explanation": "No specific individual or team was assigned to provision staging access.",
                "question": "Who will be assigned to provision test credentials for the staging sandbox?",
                "related_action_item_id": "action_2",
                "resolved": True  # Marked resolved!
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(resolved_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/clarify",
            json={
                "analysis": initial_analysis.model_dump(),
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "David from DevOps will provision the staging access."
                    }
                ]
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["action_items"][1]["owner"] == "David"
        assert data["clarifications"][0]["resolved"] is True
        assert data["clarification_required"] is False
        assert data["clarification_question"] is None
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_clarify_unresolved_answer_keeps_ambiguity():
    """
    Test POST /api/meetings/clarify when the user's answer does not resolve the ambiguity
    (e.g., 'We still don't know'). Clarification remains unresolved.
    """
    initial_analysis = MeetingAnalysisResponse.model_validate(MOCK_INSIGHTS_DICT)

    unresolved_insights = {
        "summary": "The team aligned on mobile app redesign blockers; staging access owner remains unassigned.",
        "discussion_points": [
            "Figma design system token handoff",
            "GraphQL schema updates for user preferences",
            "Session timeout configuration"
        ],
        "decisions": [
            "Session expiration timeout is established at 30 minutes"
        ],
        "action_items": [
            {
                "id": "action_1",
                "task": "Confirm GraphQL schema changes for user preferences",
                "owner": "Alex",
                "deadline": "Wednesday 4 PM",
                "status": "pending"
            },
            {
                "id": "action_2",
                "task": "Provision test credentials for staging sandbox",
                "owner": None,  # Still null!
                "deadline": "Tomorrow morning",
                "status": "pending"
            }
        ],
        "clarification_required": True,
        "clarification_question": "Who will be assigned to provision test credentials for the staging sandbox?",
        "clarifications": [
            {
                "id": "clarif_1",
                "category": "ownership",
                "original_statement": "Someone should provision staging access by tomorrow morning.",
                "explanation": "No specific individual or team was assigned to provision staging access.",
                "question": "Who will be assigned to provision test credentials for the staging sandbox?",
                "related_action_item_id": "action_2",
                "resolved": False  # Still unresolved!
            }
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(unresolved_insights)
    mock_client.models.generate_content.return_value = mock_response

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        response = client.post(
            "/api/meetings/clarify",
            json={
                "analysis": initial_analysis.model_dump(),
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "We still do not know who will handle it."
                    }
                ]
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["action_items"][1]["owner"] is None
        assert data["clarifications"][0]["resolved"] is False
        assert data["clarification_required"] is True
    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key


def test_clarify_invalid_clarification_id():
    """
    Test POST /api/meetings/clarify with an invalid clarification ID returns 400 Bad Request.
    """
    initial_analysis = MeetingAnalysisResponse.model_validate(MOCK_INSIGHTS_DICT)

    response = client.post(
        "/api/meetings/clarify",
        json={
            "analysis": initial_analysis.model_dump(),
            "answers": [
                {
                    "clarification_id": "non_existent_clarif_999",
                    "answer": "David will do it."
                }
            ]
        }
    )

    assert response.status_code == 400
    assert "Invalid clarification ID" in response.json()["detail"]


def test_clarify_empty_answer():
    """
    Test POST /api/meetings/clarify with an empty answer string returns 400 Bad Request.
    """
    initial_analysis = MeetingAnalysisResponse.model_validate(MOCK_INSIGHTS_DICT)

    response = client.post(
        "/api/meetings/clarify",
        json={
            "analysis": initial_analysis.model_dump(),
            "answers": [
                {
                    "clarification_id": "clarif_1",
                    "answer": "   "
                }
            ]
        }
    )

    assert response.status_code == 400
    assert "Clarification answer cannot be empty" in response.json()["detail"]


def test_clarify_gemini_failure_and_malformed_response():
    """
    Test POST /api/meetings/clarify returns 502 Bad Gateway when Gemini fails or returns malformed text.
    """
    initial_analysis = MeetingAnalysisResponse.model_validate(MOCK_INSIGHTS_DICT)

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = Exception("Upstream Gemini quota exceeded")

    original_client = gemini_service._client
    original_key = gemini_service._api_key
    gemini_service._api_key = "test_valid_api_key"
    gemini_service.set_client(mock_client)

    try:
        # Test Gemini API exception -> 502
        response_err = client.post(
            "/api/meetings/clarify",
            json={
                "analysis": initial_analysis.model_dump(),
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "David will do it."
                    }
                ]
            }
        )
        assert response_err.status_code == 502
        assert "Gemini API request failed" in response_err.json()["detail"]

        # Test malformed non-JSON output -> 502
        mock_client.models.generate_content.side_effect = None
        mock_response = MagicMock()
        mock_response.text = "This is not valid JSON output."
        mock_client.models.generate_content.return_value = mock_response

        response_malformed = client.post(
            "/api/meetings/clarify",
            json={
                "analysis": initial_analysis.model_dump(),
                "answers": [
                    {
                        "clarification_id": "clarif_1",
                        "answer": "David will do it."
                    }
                ]
            }
        )
        assert response_malformed.status_code == 502
        assert "Failed to parse structured meeting insights" in response_malformed.json()["detail"]

    finally:
        gemini_service._client = original_client
        gemini_service._api_key = original_key
