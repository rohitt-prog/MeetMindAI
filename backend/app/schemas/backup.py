from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator
from app.schemas.meeting import MeetingDetailResponse


class BackupUserSummary(BaseModel):
    uid: str = Field(..., description="Firebase UID of the account that created the backup")
    email: Optional[str] = Field(default=None, description="Email address associated with the account, or null")
    is_demo_user: bool = Field(default=False, description="Flag indicating if the backup originated from a demo user")


class BackupMetrics(BaseModel):
    total_meetings: int = Field(default=0, ge=0, description="Total number of meeting documents included")
    total_action_items: int = Field(default=0, ge=0, description="Sum of action items across meetings")
    total_decisions: int = Field(default=0, ge=0, description="Sum of confirmed decisions across meetings")
    is_complete: bool = Field(default=True, description="Whether the backup contains all user meetings")
    api_limit_reached: bool = Field(default=False, description="Whether query limit was reached during export")
    retrieval_note: Optional[str] = Field(default=None, description="Descriptive note regarding export completeness")


class MeetingBackupPayload(BaseModel):
    version: str = Field(
        default="1.0",
        description="Schema version of the backup format. Supported version: 1.0",
        json_schema_extra={"example": "1.0"},
    )
    backup_type: str = Field(
        default="meetmind_ai_meetings_backup",
        description="Unique identifier for MeetMind AI meeting backups",
        json_schema_extra={"example": "meetmind_ai_meetings_backup"},
    )
    exported_at: str = Field(
        ...,
        description="ISO 8601 timestamp when the backup was generated",
        json_schema_extra={"example": "2026-03-05T12:00:00Z"},
    )
    user: BackupUserSummary
    metrics: BackupMetrics
    meetings: List[MeetingDetailResponse] = Field(
        default_factory=list,
        description="List of meeting detail records included in the backup",
    )


class BackupRestorePayload(BaseModel):
    version: str = Field(
        ...,
        description="Schema version of the backup format. Supported version: 1.0",
        json_schema_extra={"example": "1.0"},
    )
    backup_type: str = Field(
        default="meetmind_ai_meetings_backup",
        description="Unique identifier for MeetMind AI meeting backups",
        json_schema_extra={"example": "meetmind_ai_meetings_backup"},
    )
    exported_at: Optional[str] = Field(
        default=None,
        description="ISO 8601 timestamp when the backup was generated",
    )
    user: Optional[BackupUserSummary] = Field(default=None)
    metrics: Optional[BackupMetrics] = Field(default=None)
    meetings: List[MeetingDetailResponse] = Field(
        ...,
        description="List of meeting detail records to restore",
    )
    conflict_strategy: Optional[Literal["skip", "overwrite"]] = Field(
        default=None,
        description="Optional conflict resolution strategy for existing meeting IDs: 'skip' or 'overwrite'",
    )

    @field_validator("version")
    @classmethod
    def validate_version(cls, v: str) -> str:
        clean = (v or "").strip()
        if clean != "1.0":
            raise ValueError(f"Unsupported backup version '{v}'. Supported versions are: 1.0.")
        return clean

    @field_validator("backup_type")
    @classmethod
    def validate_backup_type(cls, v: str) -> str:
        clean = (v or "").strip()
        if clean != "meetmind_ai_meetings_backup":
            raise ValueError(f"Invalid backup type '{v}'. Expected 'meetmind_ai_meetings_backup'.")
        return clean

    @field_validator("meetings")
    @classmethod
    def validate_meetings_not_empty(cls, v: List[MeetingDetailResponse]) -> List[MeetingDetailResponse]:
        if not v:
            raise ValueError("Backup file contains no meeting records to restore.")
        if len(v) > 500:
            raise ValueError("Backup exceeds maximum limit of 500 meetings per restore request.")
        return v


class BackupRestoreResponse(BaseModel):
    status: str = Field(default="restored", description="Operation status indicator")
    total_records: int = Field(..., description="Total meeting records evaluated in the backup file")
    imported_count: int = Field(..., description="Number of new meeting records successfully imported")
    updated_count: int = Field(default=0, description="Number of existing meeting records updated/overwritten")
    skipped_count: int = Field(default=0, description="Number of existing meeting records skipped")
    message: str = Field(..., description="Human-readable summary of the restore outcome")

