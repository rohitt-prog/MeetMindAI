from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status, HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from app.core.config import settings
from app.api.router import api_router
from app.schemas.health import HealthResponse
from app.services.health_service import HealthService
from app.services.firebase_service import firebase_service

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("meetmind-ai")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager for startup and shutdown procedures.
    Safely initializes Firebase if credentials are provided.
    """
    if firebase_service.is_configured():
        try:
            firebase_service.initialize_app()
            logger.info("Firebase Firestore initialized during application startup.")
        except Exception as e:
            logger.warning(f"Firebase initialization deferred: {e}")
    yield

# Initialize FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend API for MeetMind AI — AI-Powered Meeting-to-Action Assistant",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handler for HTTP exceptions
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )

# Global fallback Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception at {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected internal server error occurred."},
    )

# Include API Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Root Service Health Check",
    description="Returns the operational status of the MeetMind AI backend service.",
)
def root_health() -> HealthResponse:
    """
    Root health check endpoint to verify backend availability.
    """
    return HealthService.get_health_status()

@app.get("/", tags=["Root"])
def root():
    return {
        "message": f"Welcome to {settings.APP_NAME} API",
        "docs": "/docs",
        "health": f"{settings.API_V1_STR}/health",
        "root_health": "/health",
        "analyze": f"{settings.API_V1_STR}/meetings/analyze",
        "clarify": f"{settings.API_V1_STR}/meetings/clarify",
        "meetings": f"{settings.API_V1_STR}/meetings",
    }
