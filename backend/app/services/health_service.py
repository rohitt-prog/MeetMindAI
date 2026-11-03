from app.schemas.health import HealthResponse
from app.core.config import settings

class HealthService:
    @staticmethod
    def get_health_status() -> HealthResponse:
        return HealthResponse(
            status="ok",
            app=settings.APP_NAME,
        )
