from fastapi import APIRouter
from app.schemas.health import HealthResponse
from app.services.health_service import HealthService

router = APIRouter(tags=["Health"])

@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service Health Check",
    description="Returns the operational status of the MeetMind AI backend service.",
)
def check_health() -> HealthResponse:
    """
    Health check endpoint to verify backend availability.
    """
    return HealthService.get_health_status()
