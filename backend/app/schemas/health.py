from pydantic import BaseModel, Field

class HealthResponse(BaseModel):
    status: str = Field(..., description="System status indicator", json_schema_extra={"example": "ok"})
    app: str = Field(..., description="Application name", json_schema_extra={"example": "MeetMind AI"})
