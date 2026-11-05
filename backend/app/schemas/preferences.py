from typing import List, Optional
from pydantic import BaseModel, Field


class UserPreferencesResponse(BaseModel):
    selected_model: str = Field(
        ...,
        description="Currently active preferred model ID",
        json_schema_extra={"example": "gemini-2.5-flash"},
    )
    supported_models: List[str] = Field(
        ...,
        description="List of supported Gemini model IDs",
        json_schema_extra={"example": ["gemini-2.5-flash", "gemini-2.5-pro"]},
    )
    default_model: str = Field(
        ...,
        description="System default model ID",
        json_schema_extra={"example": "gemini-2.5-flash"},
    )


class UserPreferencesUpdateRequest(BaseModel):
    selected_model: str = Field(
        ...,
        description="The Gemini AI model ID to use for meeting processing",
        json_schema_extra={"example": "gemini-2.5-pro"},
    )


class ValidateKeyRequest(BaseModel):
    api_key: Optional[str] = Field(
        default=None,
        description="Optional API key in payload if not sent via header",
        json_schema_extra={"example": "AIzaSy..."},
    )


class ValidateKeyResponse(BaseModel):
    valid: bool = Field(
        ...,
        description="Whether the Gemini API key was validated successfully",
        json_schema_extra={"example": True},
    )
    message: str = Field(
        ...,
        description="Status message describing the validation outcome",
        json_schema_extra={"example": "Gemini API key verified successfully."},
    )

