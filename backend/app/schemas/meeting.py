from typing import List, Optional
from pydantic import BaseModel, Field, field_validator
from app.core.config import settings

class ActionItem(BaseModel):
    id: Optional[str] = Field(
        default=None,
        description="Stable identifier for the action item (e.g., action_1)",
        json_schema_extra={"example": "action_1"}
    )
    task: str = Field(
        ...,
        description="Actionable task or deliverable description",
        json_schema_extra={"example": "Complete the database migration script"}
    )
    owner: Optional[str] = Field(
        default=None,
        description="Assigned owner or null if unassigned or ambiguous",
        json_schema_extra={"example": "Alex"}
    )
    deadline: Optional[str] = Field(
        default=None,
        description="Target deadline/due date or null if not explicitly mentioned",
        json_schema_extra={"example": "Wednesday 4 PM"}
    )
    status: str = Field(
        default="pending",
        description="Current status of the action item (e.g., pending, in_progress, completed)",
        json_schema_extra={"example": "pending"}
    )

class ClarificationItem(BaseModel):
    id: str = Field(
        ...,
        description="Stable identifier for the clarification item (e.g., clarif_1)",
        json_schema_extra={"example": "clarif_1"}
    )
    category: str = Field(
        ...,
        description="Type or category of ambiguity (ownership, deadline, task_scope, decision_vs_suggestion, missing_context)",
        json_schema_extra={"example": "ownership"}
    )
    original_statement: str = Field(
        ...,
        description="The verbatim or excerpted quote from the transcript exhibiting ambiguity",
        json_schema_extra={"example": "Someone should provision staging access by tomorrow morning."}
    )
    explanation: str = Field(
        ...,
        description="Concise explanation of why the statement is ambiguous and what is missing",
        json_schema_extra={"example": "No specific individual or team was assigned to provision staging access."}
    )
    question: str = Field(
        ...,
        description="A direct, professional clarification question addressing the ambiguity",
        json_schema_extra={"example": "Who is specifically responsible for provisioning the staging sandbox access?"}
    )
    related_action_item_id: Optional[str] = Field(
        default=None,
        description="Optional ID of the related action item if ambiguity pertains to a specific task",
        json_schema_extra={"example": "action_2"}
    )
    resolved: bool = Field(
        default=False,
        description="Whether this ambiguity has been resolved through user clarification",
        json_schema_extra={"example": False}
    )

class MeetingAnalysisRequest(BaseModel):
    title: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Optional title or topic of the meeting",
        json_schema_extra={"example": "Sprint Architecture Sync"}
    )
    transcript: str = Field(
        ...,
        max_length=settings.MAX_TRANSCRIPT_CHARS,
        description="Raw meeting transcript or conversational notes",
        json_schema_extra={"example": "Sarah: Let's finalize the API spec by Friday..."}
    )

    @field_validator("transcript")
    @classmethod
    def validate_transcript_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Meeting transcript cannot be empty or contain only whitespace.")
        return v.strip()

class MeetingAnalysisResponse(BaseModel):
    meeting_id: Optional[str] = Field(
        default=None,
        description="Unique identifier for the persisted meeting document in Firestore",
        json_schema_extra={"example": "m_1730650000_a1b2c3d4"}
    )
    summary: str = Field(
        ...,
        description="Concise summary of the meeting",
        json_schema_extra={"example": "The team aligned on the mobile app redesign milestones and resolved authentication blockers."}
    )
    discussion_points: List[str] = Field(
        default_factory=list,
        description="List of key topics and discussion points covered",
        json_schema_extra={"example": ["Figma design system token handoff", "GraphQL schema updates"]}
    )
    decisions: List[str] = Field(
        default_factory=list,
        description="List of decisions agreed upon during the meeting",
        json_schema_extra={"example": ["Session expiration timeout set to 30 minutes"]}
    )
    action_items: List[ActionItem] = Field(
        default_factory=list,
        description="List of structured action items extracted from the transcript"
    )
    clarification_required: bool = Field(
        ...,
        description="Boolean flag indicating whether any task or information requires clarification",
        json_schema_extra={"example": True}
    )
    clarification_question: Optional[str] = Field(
        default=None,
        description="Proactive clarifying question addressing ambiguous tasks, missing owners, or missing prerequisites",
        json_schema_extra={"example": "Who is responsible for provisioning the staging sandbox test credentials?"}
    )
    clarifications: List[ClarificationItem] = Field(
        default_factory=list,
        description="Structured list of ambiguity clarifications identified in the meeting transcript"
    )
    open_follow_ups: List[str] = Field(
        default_factory=list,
        description="List of explicitly deferred tasks, follow-ups, or decisions postponed to a future meeting or date",
        json_schema_extra={"example": ["Inform the marketing team (owner to be decided in next meeting)"]}
    )

class ClarificationAnswer(BaseModel):
    clarification_id: str = Field(
        ...,
        max_length=64,
        description="The ID of the clarification being answered (e.g., clarif_1)",
        json_schema_extra={"example": "clarif_1"}
    )
    answer: str = Field(
        ...,
        max_length=2000,
        description="The user's response providing clarification",
        json_schema_extra={"example": "David from Infrastructure will provision the staging access."}
    )

class MeetingClarificationRequest(BaseModel):
    meeting_id: Optional[str] = Field(
        default=None,
        max_length=128,
        description="Optional Firestore meeting ID to update the existing persisted record in-place",
        json_schema_extra={"example": "m_1730650000_a1b2c3d4"}
    )
    analysis: MeetingAnalysisResponse = Field(
        ...,
        description="The existing meeting analysis object to be updated with clarification answers"
    )
    answers: List[ClarificationAnswer] = Field(
        ...,
        description="List of clarification answers submitted by the user",
        min_length=1,
        max_length=50
    )

class MeetingListItem(BaseModel):
    meeting_id: str = Field(..., description="Unique meeting ID in Firestore")
    owner_uid: Optional[str] = Field(default=None, description="Firebase UID of the meeting owner")
    title: Optional[str] = Field(default=None, description="Optional meeting title")
    summary: str = Field(..., description="Executive summary snippet or text")
    created_at: str = Field(..., description="ISO 8601 creation timestamp")
    updated_at: str = Field(..., description="ISO 8601 last update timestamp")
    action_items_count: int = Field(default=0, description="Total number of action items")
    decisions_count: int = Field(default=0, description="Total number of confirmed decisions")
    clarification_required: bool = Field(default=False, description="Whether clarification is still needed")
    unresolved_clarifications_count: int = Field(default=0, description="Count of open ambiguities")
    open_follow_ups_count: int = Field(default=0, description="Count of explicitly deferred follow-up items")

class MeetingDetailResponse(BaseModel):
    meeting_id: str = Field(..., description="Unique meeting ID in Firestore")
    owner_uid: Optional[str] = Field(default=None, description="Firebase UID of the meeting owner")
    title: Optional[str] = Field(default=None, description="Meeting title or null")
    transcript: str = Field(..., description="Full meeting transcript text")
    created_at: str = Field(..., description="ISO 8601 creation timestamp")
    updated_at: str = Field(..., description="ISO 8601 last update timestamp")
    analysis: MeetingAnalysisResponse = Field(..., description="Structured meeting analysis")
    answers_history: List[dict] = Field(default_factory=list, description="Historical clarification answers audit log")

class MeetingPdfExportRequest(BaseModel):
    title: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Optional meeting title",
        json_schema_extra={"example": "Mobile App Redesign Sync"}
    )
    transcript: Optional[str] = Field(
        default=None,
        max_length=settings.MAX_TRANSCRIPT_CHARS,
        description="Optional meeting transcript",
        json_schema_extra={"example": "Sarah: Let's review the blockers for the milestone release..."}
    )
    analysis: MeetingAnalysisResponse = Field(
        ...,
        description="Structured meeting analysis object to render into the report"
    )
    answers_history: Optional[List[dict]] = Field(
        default_factory=list,
        description="Optional historical clarification answers audit log"
    )

class MeetingDeleteResponse(BaseModel):
    status: str = Field(default="deleted", description="Operation status indicator")
    meeting_id: str = Field(..., description="Unique meeting ID of the deleted meeting")
    message: str = Field(default="Meeting successfully deleted.", description="Human-readable outcome message")

class BulkMeetingDeleteResponse(BaseModel):
    status: str = Field(default="deleted", description="Operation status indicator")
    deleted_count: int = Field(..., description="Total number of meeting documents permanently deleted")
    message: str = Field(default="All saved meetings have been permanently deleted.", description="Human-readable outcome message")

