from fastapi import APIRouter
from app.api.routes import health, meetings, account

api_router = APIRouter()

# Register routes under /api
api_router.include_router(health.router)
api_router.include_router(meetings.router, prefix="/meetings")
api_router.include_router(account.router, prefix="/account")
