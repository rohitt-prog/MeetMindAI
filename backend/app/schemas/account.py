from typing import Literal
from pydantic import BaseModel, Field


class AccountDeleteResponse(BaseModel):
    """
    Response model returned after permanent user account and data deletion.
    """
    status: Literal["deleted"] = Field(
        default="deleted",
        description="Indicates successful permanent erasure of the user account and data.",
    )
    meetings_deleted: int = Field(
        ...,
        description="Total number of meeting documents permanently deleted from Cloud Firestore.",
    )
    message: str = Field(
        ...,
        description="Human-readable confirmation of the account erasure operation.",
    )

