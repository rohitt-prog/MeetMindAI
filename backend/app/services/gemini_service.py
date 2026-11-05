import json
import logging
from typing import List, Optional
from google import genai
from google.genai import types
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.meeting import (
    ClarificationAnswer,
    ClarificationItem,
    MeetingAnalysisResponse,
)

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
        self._api_key = api_key if api_key is not None else settings.GEMINI_API_KEY
        self._model = model if model is not None else settings.GEMINI_MODEL
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

    def create_client(self, api_key: str) -> genai.Client:
        """
        Creates an ephemeral Google GenAI client instance using the provided API key.
        Never persists or caches this client instance on self to ensure per-request isolation.
        """
        if not api_key or not api_key.strip() or api_key == "your_gemini_api_key_here":
            raise GeminiConfigError("Invalid or empty Gemini API key provided.")
        try:
            return genai.Client(api_key=api_key.strip())
        except Exception as e:
            logger.error("Failed to initialize Google GenAI client with provided key.")
            raise GeminiConfigError("Failed to initialize Gemini client with provided configuration.")

    def validate_api_key(self, api_key: str) -> bool:
        """
        Validates a user-provided Gemini API key by making a lightweight API call.
        Does not log the API key or persist the client.
        """
        if not api_key or not api_key.strip() or api_key == "your_gemini_api_key_here":
            return False

        try:
            client = self.create_client(api_key.strip())
            client.models.get(model=settings.DEFAULT_GEMINI_MODEL)
            return True
        except Exception:
            logger.warning("User-provided BYOK key validation failed.")
            return False

    def _build_analysis_prompt(self, transcript: str, title: Optional[str] = None) -> str:
        """
        Builds the prompt instructing Gemini to analyze the meeting transcript
        with rigorous ambiguity detection and anti-hallucination guardrails.
        """
        header = f"Meeting Title: {title}\n\n" if title and title.strip() else ""
        return (
            "You are an expert meeting intelligence assistant for MeetMind AI.\n"
            "Analyze the meeting transcript provided below and extract structured meeting information.\n\n"
            "STRICT EXTRACTION & AMBIGUITY DETECTION RULES:\n"
            "1. summary: Provide a concise, coherent summary of what took place in the meeting.\n"
            "2. discussion_points: List the major topics and discussion threads covered.\n"
            "3. decisions: List only explicit, confirmed decisions agreed upon by participants.\n"
            "   - CRITICAL: Distinguish between confirmed decisions versus preliminary suggestions, brainstorming ideas, or conditional proposals (e.g., 'we should consider launching next month' or 'launch date proposed for Nov 20th pending QA review'). If an item is conditional or awaiting review, do NOT record it as a confirmed decision unless the decision was explicitly to wait for review.\n"
            "4. action_items: Extract all concrete deliverables, tasks, and follow-ups. For each item:\n"
            "   - id: Assign a stable ID (e.g., 'action_1', 'action_2').\n"
            "   - task: A clear, actionable description of the work.\n"
            "   - owner: The name of the specific person assigned to the task. If a person volunteers for a task later in the conversation (e.g., 'I will handle that'), use that confirmed owner. If no owner was assigned or if stated vaguely (e.g., 'someone should send the report'), use null. If the owner was explicitly deferred to a future meeting (e.g., 'let's decide who will do that in the next meeting'), use null.\n"
            "   - deadline: The timeframe mentioned in the meeting. If a deadline was stated ambiguously (e.g. 'by Friday' without indicating which Friday), PRESERVE the stated timeframe (e.g., 'Friday') and create a clarification item for it. Do NOT set to null if a deadline was mentioned. Only use null if NO deadline was mentioned at all. NEVER invent calendar dates.\n"
            "   - status: Set to 'deferred' (or 'deferred: owner to be decided in next meeting') if participants explicitly agreed to defer assignment or execution to the next meeting or future date. Otherwise set to 'pending'.\n"
            "5. clarifications: A list of structured clarification items for meaningful ambiguities that require user input:\n"
            "   - id: Assign a stable ID (e.g., 'clarif_1', 'clarif_2').\n"
            "   - category: One of 'ownership', 'deadline', 'task_scope', 'decision_vs_suggestion', 'missing_context'.\n"
            "   - original_statement: The verbatim or excerpted quote from the transcript exhibiting ambiguity.\n"
            "   - explanation: A concise explanation of what is unclear.\n"
            "   - question: A polite, direct clarification question seeking the missing detail.\n"
            "   - related_action_item_id: The ID of the related action item (e.g., 'action_1') if applicable, or null.\n"
            "   - resolved: Always false during initial extraction.\n"
            "   * CRITICAL DISTINCTION: Do NOT generate clarification questions for tasks or decisions that participants explicitly deferred to a future meeting (e.g., 'let's decide who will do that in the next meeting'). Those are open follow-ups, NOT immediate clarification questions.\n"
            "6. open_follow_ups: A list of string descriptions for explicitly deferred tasks, follow-ups, or decisions that the transcript states will be decided or handled in a future meeting or date (e.g., 'Inform the marketing team (owner to be decided in next meeting)'). If none, return an empty list.\n"
            "7. clarification_required: Set to true if any clarification item is present in 'clarifications'. Set to false if no immediate clarification items exist (even if open_follow_ups exist).\n"
            "8. clarification_question: If clarification_required is true, set to the question of the first clarification item. If false, set to null.\n\n"
            f"{header}"
            "MEETING TRANSCRIPT:\n"
            "\"\"\"\n"
            f"{transcript.strip()}\n"
            "\"\"\""
        )

    def _build_clarification_prompt(
        self,
        analysis: MeetingAnalysisResponse,
        answers: List[ClarificationAnswer],
    ) -> str:
        """
        Builds the prompt instructing Gemini to re-evaluate and update the meeting analysis
        based on the user's clarification answers.
        """
        analysis_json = analysis.model_dump_json(indent=2)
        answers_json = json.dumps([ans.model_dump() for ans in answers], indent=2)

        return (
            "You are an expert meeting intelligence assistant for MeetMind AI.\n"
            "Your task is to update an existing structured meeting analysis based on clarification answers provided by the user.\n\n"
            "EXISTING MEETING ANALYSIS:\n"
            f"{analysis_json}\n\n"
            "USER CLARIFICATION ANSWERS:\n"
            f"{answers_json}\n\n"
            "RE-EVALUATION & UPDATE RULES:\n"
            "1. Re-evaluate ONLY the specific items (action items, decisions, summary) associated with each answered clarification.\n"
            "2. When a user's answer provides clear, definitive information:\n"
            "   - If the clarification was about ownership: update the related action item's 'owner' with the confirmed person's name.\n"
            "   - If the clarification was about a deadline: update the related action item's 'deadline' with the confirmed timeframe.\n"
            "   - If the clarification was about task scope: update the related action item's 'task' description.\n"
            "   - If the clarification was about decision vs suggestion:\n"
            "     * If the user confirms it is an approved decision, add it to 'decisions'.\n"
            "     * If the user states it is not a decision (just a suggestion/rejected/tabled), do NOT add it to 'decisions'.\n"
            "   - Mark that clarification item's 'resolved' field to true.\n"
            "3. When a user's answer is vague, says 'I don't know', 'not sure', 'TBD', 'still undecided', or does NOT provide sufficient information to resolve the ambiguity:\n"
            "   - Leave that clarification item's 'resolved' field as false.\n"
            "   - Do NOT update action items or decisions with placeholder/unconfirmed values. Keep owners/deadlines as null or original ambiguous value.\n"
            "4. NEVER overwrite, delete, or modify unrelated action items, decisions, discussion points, or open_follow_ups.\n"
            "5. Preserve all existing action item IDs and clarification IDs exactly.\n"
            "6. Preserve all existing open_follow_ups entries exactly.\n"
            "7. Overall Status:\n"
            "   - If any clarification remains unresolved (resolved == false), set 'clarification_required' to true, and set 'clarification_question' to the question of the first unresolved clarification.\n"
            "   - If ALL clarifications are now resolved (resolved == true), set 'clarification_required' to false, and set 'clarification_question' to null."
        )

    def analyze_transcript(
        self,
        transcript: str,
        title: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> MeetingAnalysisResponse:
        """
        Analyzes a raw meeting transcript using Gemini and returns structured meeting insights
        with ambiguity detection. Supports custom target model and optional BYOK API key.
        """
        if not transcript or not transcript.strip():
            raise ValueError("Meeting transcript cannot be empty.")

        target_model = model or self._model
        if api_key:
            client = self.create_client(api_key)
        else:
            client = self._get_client()

        prompt = self._build_analysis_prompt(transcript, title)

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MeetingAnalysisResponse,
            temperature=0.1,
        )

        try:
            logger.info(f"Submitting transcript analysis request to Gemini model: {target_model}")
            response = client.models.generate_content(
                model=target_model,
                contents=prompt,
                config=config,
            )
        except Exception as e:
            if api_key:
                logger.error("Error during Gemini API call with custom BYOK key")
                sanitized_msg = str(e).replace(api_key, "[REDACTED]")
                raise GeminiAnalysisError(f"Gemini API request failed using provided API key: {sanitized_msg}")
            logger.error(f"Error during Gemini API call: {e}")
            raise GeminiAnalysisError(f"Gemini API request failed: {str(e)}")

        if not response or not response.text:
            logger.error("Gemini returned an empty response.")
            raise GeminiAnalysisError("Received empty response from Gemini API.")

        raw_text = response.text.strip()
        parsed_response = self._parse_json_response(raw_text)

        # Post-process: ensure action item IDs and clarification consistency
        return self._post_process_analysis(parsed_response)

    def resolve_clarifications(
        self,
        analysis: MeetingAnalysisResponse,
        answers: List[ClarificationAnswer],
        model: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> MeetingAnalysisResponse:
        """
        Re-evaluates and updates an existing meeting analysis based on submitted clarification answers.
        Supports custom target model and optional BYOK API key.
        """
        if not answers:
            raise ValueError("At least one clarification answer must be provided.")

        valid_ids = {c.id for c in analysis.clarifications}
        for ans in answers:
            if not ans.clarification_id or not ans.clarification_id.strip():
                raise ValueError("Clarification ID cannot be empty.")
            if ans.clarification_id not in valid_ids:
                raise ValueError(
                    f"Invalid clarification ID '{ans.clarification_id}'. Clarification does not exist in the provided analysis."
                )
            if not ans.answer or not ans.answer.strip():
                raise ValueError("Clarification answer cannot be empty or contain only whitespace.")

        target_model = model or self._model
        if api_key:
            client = self.create_client(api_key)
        else:
            client = self._get_client()

        prompt = self._build_clarification_prompt(analysis, answers)

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MeetingAnalysisResponse,
            temperature=0.1,
        )

        try:
            logger.info(f"Submitting clarification resolution request to Gemini model: {target_model}")
            response = client.models.generate_content(
                model=target_model,
                contents=prompt,
                config=config,
            )
        except Exception as e:
            if api_key:
                logger.error("Error during Gemini clarification API call with custom BYOK key")
                sanitized_msg = str(e).replace(api_key, "[REDACTED]")
                raise GeminiAnalysisError(f"Gemini API request failed using provided API key: {sanitized_msg}")
            logger.error(f"Error during Gemini clarification API call: {e}")
            raise GeminiAnalysisError(f"Gemini API request failed: {str(e)}")

        if not response or not response.text:
            logger.error("Gemini returned an empty response during clarification.")
            raise GeminiAnalysisError("Received empty response from Gemini API.")

        raw_text = response.text.strip()
        updated_response = self._parse_json_response(raw_text)

        # Post-process: enforce status consistency and ID preservation
        return self._post_process_analysis(updated_response, original_analysis=analysis)

    def _post_process_analysis(
        self,
        analysis: MeetingAnalysisResponse,
        original_analysis: Optional[MeetingAnalysisResponse] = None,
    ) -> MeetingAnalysisResponse:
        """
        Guarantees stable action item IDs, preserves unrelated items,
        populates open_follow_ups from deferred items, and enforces
        consistent clarification status.
        """
        # 1. Initialize open_follow_ups if None
        if analysis.open_follow_ups is None:
            analysis.open_follow_ups = []
        existing_followups = set(analysis.open_follow_ups)

        # Ensure every new action item has an ID and detect explicitly deferred items
        for idx, item in enumerate(analysis.action_items, start=1):
            if not item.id:
                item.id = f"action_{idx}"

            status_lower = (item.status or "").lower()
            if status_lower.startswith("deferred") or "next meeting" in status_lower:
                reason = "owner to be decided in next meeting" if not item.owner else "deferred"
                fu_text = f"{item.task} ({reason})"
                if fu_text not in existing_followups and not any(item.task.lower() in ef.lower() for ef in existing_followups):
                    analysis.open_follow_ups.append(fu_text)
                    existing_followups.add(fu_text)

        # 2. If original analysis is provided, safeguard against accidental LLM drops
        if original_analysis:
            # Merge and preserve clarifications
            updated_clarifs_by_id = {c.id: c for c in analysis.clarifications}
            merged_clarifications = []
            seen_ids = set()

            # Preserve order from original, updating with new resolution state
            for orig_c in original_analysis.clarifications:
                if orig_c.id in updated_clarifs_by_id:
                    merged_clarifications.append(updated_clarifs_by_id[orig_c.id])
                else:
                    # Model omitted this unaddressed clarification; preserve it
                    merged_clarifications.append(orig_c)
                seen_ids.add(orig_c.id)

            # Append any genuinely new clarifications returned by model
            for c in analysis.clarifications:
                if c.id not in seen_ids:
                    merged_clarifications.append(c)
                    seen_ids.add(c.id)

            analysis.clarifications = merged_clarifications

            # Preserve unrelated action items that may have been omitted by LLM
            existing_action_ids = {a.id for a in analysis.action_items if a.id}
            existing_action_tasks = {a.task.strip().lower() for a in analysis.action_items}
            for orig_item in original_analysis.action_items:
                if orig_item.id and orig_item.id not in existing_action_ids:
                    # Check if same task under different ID already present
                    if orig_item.task.strip().lower() not in existing_action_tasks:
                        analysis.action_items.append(orig_item)

            # Preserve discussion points if LLM response truncated them
            existing_dp_lower = {dp.strip().lower() for dp in analysis.discussion_points}
            for orig_dp in original_analysis.discussion_points:
                if orig_dp.strip().lower() not in existing_dp_lower:
                    analysis.discussion_points.append(orig_dp)

            # Preserve open_follow_ups from original_analysis
            if original_analysis.open_follow_ups:
                for orig_fu in original_analysis.open_follow_ups:
                    if orig_fu not in existing_followups:
                        analysis.open_follow_ups.append(orig_fu)
                        existing_followups.add(orig_fu)

        # 3. Ensure deferred tasks don't retain redundant immediate clarification questions
        deferred_task_ids = {
            item.id for item in analysis.action_items
            if item.id and (item.status or "").lower().startswith("deferred")
        }
        if deferred_task_ids:
            # Filter out clarifications asking who owns a task when owner is explicitly deferred
            filtered_clarifications = []
            for c in analysis.clarifications:
                if c.related_action_item_id in deferred_task_ids and c.category == "ownership":
                    continue
                filtered_clarifications.append(c)
            analysis.clarifications = filtered_clarifications

        # 4. Evaluate unresolved clarifications
        unresolved = [c for c in analysis.clarifications if not c.resolved]
        if unresolved:
            analysis.clarification_required = True
            if not analysis.clarification_question:
                analysis.clarification_question = unresolved[0].question
        else:
            analysis.clarification_required = False
            analysis.clarification_question = None

        return analysis

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
