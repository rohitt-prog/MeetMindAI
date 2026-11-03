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
from app.schemas.meeting import MeetingAnalysisResponse

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
            "task": "Confirm GraphQL schema changes for user preferences",
            "owner": "Alex",
            "deadline": "Wednesday 4 PM",
            "status": "pending"
        },
        {
            "task": "Provision test credentials for staging sandbox",
            "owner": None,
            "deadline": "Tomorrow morning",
            "status": "pending"
        }
    ],
    "clarification_required": True,
    "clarification_question": "Who will be assigned to provision test credentials for the staging sandbox?"
}

MOCK_VALID_TRANSCRIPT = (
    "Sarah: Let's review the blockers for the milestone release.\n"
    "David: The Figma design system tokens are complete. I need Alex to confirm GraphQL changes by Wednesday 4 PM.\n"
    "Alex: I will finalize the endpoint by Wednesday 4 PM.\n"
    "Priya: We need test credentials for the staging sandbox. Who is provisioning them?\n"
    "Sarah: Someone should provision staging access by tomorrow morning."
)


def test_analyze_valid_transcript():
    """
    Test POST /api/meetings/analyze with a valid transcript and mocked Gemini response.
    """
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(MOCK_INSIGHTS_DICT)
    mock_client.models.generate_content.return_value = mock_response

    # Inject mock client into gemini_service
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
    # Wrap JSON inside markdown block
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
    # Temporary service instance without API key
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
