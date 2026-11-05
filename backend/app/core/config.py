from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import json
import logging

logger = logging.getLogger("meetmind-ai.config")


class Settings(BaseSettings):
    APP_NAME: str = "MeetMind AI"
    APP_VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    ENVIRONMENT: str = "development"
    
    # CORS Configuration
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    # Google Gemini Configuration
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-2.5-flash"
    DEFAULT_GEMINI_MODEL: str = "gemini-2.5-flash"
    SUPPORTED_GEMINI_MODELS: List[str] = ["gemini-2.5-flash", "gemini-2.5-pro"]

    # Firebase Configuration (Cloud Firestore & Authentication)
    FIREBASE_PROJECT_ID: Optional[str] = None
    FIREBASE_CREDENTIALS_PATH: Optional[str] = None
    FIREBASE_CREDENTIALS_JSON: Optional[str] = None
    FIRESTORE_COLLECTION_MEETINGS: str = "meetings"
    FIRESTORE_COLLECTION_PREFERENCES: str = "user_preferences"
    FIREBASE_AUTH_ENABLED: bool = True

    # Rate Limiting Configuration (Phase 12)
    RATE_LIMIT_ANALYZE: str = "10/minute"
    RATE_LIMIT_CLARIFY: str = "10/minute"
    RATE_LIMIT_PDF: str = "20/minute"
    RATE_LIMIT_BULK_DELETE: str = "5/minute"
    RATE_LIMIT_ACCOUNT_DELETE: str = "5/minute"
    RATE_LIMIT_PREFERENCES: str = "30/minute"
    RATE_LIMIT_REDIS_URL: Optional[str] = None
    RATE_LIMIT_FAIL_CLOSED: Optional[bool] = None
    RATE_LIMIT_REDIS_REQUIRED: bool = False

    @property
    def is_rate_limit_fail_closed(self) -> bool:
        """
        Determines whether rate limiting should fail closed on Redis failures.
        - Honors explicit RATE_LIMIT_FAIL_CLOSED if set (True or False).
        - Defaults to True in production (or when RATE_LIMIT_REDIS_REQUIRED is True).
        - Defaults to False in development/testing (falls back to in-memory limiter).
        """
        if self.RATE_LIMIT_FAIL_CLOSED is not None:
            return self.RATE_LIMIT_FAIL_CLOSED
        return (self.ENVIRONMENT.lower() == "production") or self.RATE_LIMIT_REDIS_REQUIRED

    # Request Payload Limits (Phase 12)
    MAX_REQUEST_BODY_BYTES: int = 1_048_576  # 1 MiB ceiling
    MAX_TRANSCRIPT_CHARS: int = 100_000      # 100,000 characters ceiling

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, str) and v.startswith("["):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
        return v

    def validate_production_configuration(self) -> None:
        """
        Validates configuration consistency and security guards.
        In production, prevents insecure defaults (wildcards, missing credentials, disabled auth).
        """
        if self.ENVIRONMENT.lower() == "production":
            # 1. Prohibit wildcard CORS with credentials
            if "*" in self.CORS_ORIGINS:
                raise ValueError(
                    "Production configuration error: Wildcard '*' in CORS_ORIGINS is strictly prohibited when allow_credentials=True."
                )

            # 2. Prohibit localhost origins in production
            for origin in self.CORS_ORIGINS:
                if "localhost" in origin or "127.0.0.1" in origin:
                    raise ValueError(
                        f"Production configuration error: Localhost origin '{origin}' is not permitted in production CORS_ORIGINS."
                    )

            # 3. Ensure Authentication cannot be disabled in production
            if not self.FIREBASE_AUTH_ENABLED:
                raise ValueError(
                    "Production configuration error: FIREBASE_AUTH_ENABLED cannot be False in production."
                )

            # 4. Ensure Firebase project is configured
            if not self.FIREBASE_PROJECT_ID or self.FIREBASE_PROJECT_ID == "your-firebase-project-id":
                raise ValueError(
                    "Production configuration error: Valid FIREBASE_PROJECT_ID is required in production."
                )

            # 5. Ensure Gemini API key is configured
            if not self.GEMINI_API_KEY or self.GEMINI_API_KEY == "your_gemini_api_key_here":
                raise ValueError(
                    "Production configuration error: Valid GEMINI_API_KEY is required in production."
                )

            # 6. Verify Redis requirement in production
            if not (self.RATE_LIMIT_REDIS_URL and self.RATE_LIMIT_REDIS_URL.strip()):
                raise ValueError(
                    "Production configuration error: RATE_LIMIT_REDIS_URL is required in production."
                )

            logger.info("Production security and configuration verification passed.")

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
