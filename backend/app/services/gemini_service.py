import json
import logging
from typing import Optional
from google import genai
from google.genai import types
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.meeting import MeetingAnalysisResponse

logger = logging.getLogger("meetmind-ai.gemini")

class GeminiServiceError(Exception):
    """Base exception for Gemini service errors."""
    pass

class GeminiConfigError(GeminiServiceError):
    """Raised when Gemini configuration (e.g. API key) is missing or invalid."""
    pass

class GeminiAnalysisError(GeminiServiceError):
    """Raised when Gemini API fails to generate or return valid structured insights."""
    pass


class GeminiService:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self._api_key = api_key or settings.GEMINI_API_KEY
        self._model = model or settings.GEMINI_MODEL
        self._client: Optional[genai.Client] = None

    def _get_client(self) -> genai.Client:
        """
        Initializes and returns a Google GenAI client instance.
        Validates that the API key is configured.
        """
        if self._client is not None:
            return self._client

        api_key = self._api_key
        if not api_key or not api_key.strip() or api_key == "your_gemini_api_key_here":
            raise GeminiConfigError(
                "Gemini API key is not configured. Please set a valid GEMINI_API_KEY in backend/.env."
            )

        try:
            self._client = genai.Client(api_key=api_key.strip())
            return self._client
        except Exception as e:
            logger.error(f"Failed to initialize Google GenAI client: {e}")
            raise GeminiConfigError("Failed to initialize Gemini client with provided configuration.")

    def set_client(self, client: genai.Client) -> None:
        """
        Allows injecting a pre-configured or mock client (primarily for testing).
        """
        self._client = client

    def _build_prompt(self, transcript: str, title: Optional[str] = None) -> str:
        """
        Builds the prompt instructing Gemini to analyze the meeting transcript.
        """
        header = f"Meeting Title: {title}\n\n" if title and title.strip() else ""
        return (
            "You are an expert meeting intelligence assistant for MeetMind AI.\n"
            "Analyze the meeting transcript provided below and extract structured meeting information.\n\n"
            "STRICT EXTRACTION RULES:\n"
            "1. summary: Provide a concise, coherent summary of what took place in the meeting.\n"
            "2. discussion_points: List the major topics and discussion threads covered.\n"
            "3. decisions: List the explicit decisions agreed upon by participants. Do NOT invent decisions not stated in the transcript.\n"
            "4. action_items: Extract all concrete deliverables, tasks, and follow-ups. For each item:\n"
            "   - task: A clear, actionable description of the work.\n"
            "   - owner: The name of the specific person assigned to the task. If no owner was explicitly assigned or if it is ambiguous, use null. NEVER invent owners.\n"
            "   - deadline: The specific due date or timeframe mentioned in the meeting. If no deadline was explicitly stated, use null. NEVER invent deadlines.\n"
            "   - status: Set to 'pending' by default.\n"
            "5. clarification_required: Set to true if any task has ambiguous scope, missing critical owner, or unclear requirements that necessitate follow-up. Set to false if all items are clear.\n"
            "6. clarification_question: If clarification_required is true, provide a direct, professional question asking for clarification on the most critical missing detail. If clarification_required is false, set to null.\n\n"
            f"{header}"
            "MEETING TRANSCRIPT:\n"
            "\"\"\"\n"
            f"{transcript.strip()}\n"
            "\"\"\""
        )

    def analyze_transcript(
        self,
        transcript: str,
        title: Optional[str] = None,
    ) -> MeetingAnalysisResponse:
        """
        Analyzes a raw meeting transcript using Gemini and returns structured meeting insights.
        """
        if not transcript or not transcript.strip():
            raise ValueError("Meeting transcript cannot be empty.")

        client = self._get_client()
        prompt = self._build_prompt(transcript, title)

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MeetingAnalysisResponse,
            temperature=0.1,
        )

        try:
            logger.info(f"Submitting transcript analysis request to Gemini model: {self._model}")
            response = client.models.generate_content(
                model=self._model,
                contents=prompt,
                config=config,
            )
        except Exception as e:
            logger.error(f"Error during Gemini API call: {e}")
            raise GeminiAnalysisError(f"Gemini API request failed: {str(e)}")

        if not response or not response.text:
            logger.error("Gemini returned an empty response.")
            raise GeminiAnalysisError("Received empty response from Gemini API.")

        raw_text = response.text.strip()
        return self._parse_json_response(raw_text)

    def _parse_json_response(self, raw_text: str) -> MeetingAnalysisResponse:
        """
        Parses raw text (handling potential markdown fences) into a MeetingAnalysisResponse.
        """
        cleaned_text = raw_text.strip()

        # Strip markdown fences if present (e.g. ```json ... ```)
        if cleaned_text.startswith("```"):
            lines = cleaned_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned_text = "\n".join(lines).strip()

        try:
            # Validate and parse into Pydantic model
            parsed_data = MeetingAnalysisResponse.model_validate_json(cleaned_text)
            return parsed_data
        except (ValidationError, json.JSONDecodeError) as e:
            logger.error(f"Failed to parse Gemini JSON output: {e}\nRaw output: {raw_text[:200]}")
            raise GeminiAnalysisError(f"Failed to parse structured meeting insights from Gemini response: {str(e)}")

gemini_service = GeminiService()
