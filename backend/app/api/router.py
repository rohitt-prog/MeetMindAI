from fastapi import APIRouter
from app.api.routes import health

api_router = APIRouter()

# Register routes under /api
api_router.include_router(health.router)
