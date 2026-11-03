import logging
from dataclasses import dataclass
from typing import Optional

import firebase_admin
from firebase_admin import auth
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.services.firebase_service import firebase_service

logger = logging.getLogger("meetmind-ai.auth")

# HTTPBearer scheme that does not auto-error, allowing custom 401 responses
http_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedUser:
    """Represents an authenticated user verified via Firebase Admin."""
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    email_verified: bool = False


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
) -> AuthenticatedUser:
    """
    Reusable FastAPI dependency to authenticate requests using Firebase ID tokens.
    Verifies Bearer token with Firebase Admin SDK and returns the user's UID and metadata.
    Raises HTTP 401 Unauthorized for missing, expired, or invalid tokens.
    Never trusts client-supplied UIDs.
    """
    if credentials is None or not credentials.credentials:
        logger.debug("Request rejected: Missing Bearer token in Authorization header.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token in the Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token cannot be empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Ensure Firebase Admin is initialized
    if not firebase_admin._apps:
        try:
            firebase_service.initialize_app()
        except Exception as e:
            logger.error(f"Cannot verify authentication: Firebase Admin initialization failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service is temporarily unavailable.",
            )

    try:
        # Verify the Firebase ID token cryptographically
        decoded_token = auth.verify_id_token(token, check_revoked=False)
        uid = decoded_token.get("uid") or decoded_token.get("sub")

        if not uid or not str(uid).strip():
            logger.warning("Decoded Firebase token does not contain a valid UID.")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Malformed authentication token: missing user ID.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return AuthenticatedUser(
            uid=str(uid).strip(),
            email=decoded_token.get("email"),
            name=decoded_token.get("name"),
            email_verified=bool(decoded_token.get("email_verified", False)),
        )

    except auth.ExpiredIdTokenError as e:
        logger.info(f"Firebase token expired: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired. Please log in again.",
            headers={
                "WWW-Authenticate": 'Bearer error="invalid_token", error_description="The token has expired"'
            },
        )
    except auth.RevokedIdTokenError as e:
        logger.warning(f"Firebase token was revoked: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has been revoked. Please log in again.",
            headers={
                "WWW-Authenticate": 'Bearer error="invalid_token", error_description="The token has been revoked"'
            },
        )
    except (auth.InvalidIdTokenError, auth.CertificateFetchError, ValueError) as e:
        logger.warning(f"Invalid Firebase ID token received: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token. Verification failed.",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during Firebase token verification: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed. Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

