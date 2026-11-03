from typing import List, Optional
from pydantic import BaseModel, Field, field_validator

class ActionItem(BaseModel):
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

class MeetingAnalysisRequest(BaseModel):
    title: Optional[str] = Field(
        default=None,
        description="Optional title or topic of the meeting",
        json_schema_extra={"example": "Sprint Architecture Sync"}
    )
    transcript: str = Field(
        ...,
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
