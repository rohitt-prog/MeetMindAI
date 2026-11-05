import logging
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.config import settings
from app.core.auth import AuthenticatedUser, get_current_user
from app.core.rate_limit import require_rate_limit
from app.schemas.preferences import (
    UserPreferencesResponse,
    UserPreferencesUpdateRequest,
    ValidateKeyRequest,
    ValidateKeyResponse,
)
from app.services.firebase_service import (
    firebase_service,
    FirebaseOperationError,
)
from app.services.gemini_service import gemini_service

logger = logging.getLogger("meetmind-ai.preferences")

router = APIRouter(tags=["Preferences"])


@router.get(
    "",
    response_model=UserPreferencesResponse,
    status_code=status.HTTP_200_OK,
    summary="Get User Model Preferences",
    description="Retrieves the authenticated user's preferred AI model and system defaults.",
)
def get_user_preferences(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> UserPreferencesResponse:
    """
    Returns the user's active model preference.
    Isolated strictly by the verified Firebase UID.
    """
    try:
        prefs = firebase_service.get_user_preferences(owner_uid=current_user.uid)
        return UserPreferencesResponse(
            selected_model=prefs.get("selected_model", settings.GEMINI_MODEL),
            supported_models=settings.SUPPORTED_GEMINI_MODELS,
            default_model=settings.DEFAULT_GEMINI_MODEL,
        )
    except FirebaseOperationError as e:
        logger.error(f"Error fetching preferences for user '{current_user.uid}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user preferences.",
        )


@router.put(
    "",
    response_model=UserPreferencesResponse,
    status_code=status.HTTP_200_OK,
    summary="Update User Model Preference",
    description="Updates the authenticated user's preferred AI model. Validates against supported allowlist.",
)
def update_user_preferences(
    request: UserPreferencesUpdateRequest,
    current_user: AuthenticatedUser = Depends(
        require_rate_limit("preferences", lambda: settings.RATE_LIMIT_PREFERENCES)
    ),
) -> UserPreferencesResponse:
    """
    Updates the user's model preference in Firestore isolated by their verified UID.
    Validates model against supported allowlist.
    """
    clean_model = (request.selected_model or "").strip()
    if clean_model not in settings.SUPPORTED_GEMINI_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid model '{clean_model}'. Supported models are: {', '.join(settings.SUPPORTED_GEMINI_MODELS)}.",
        )

    try:
        saved = firebase_service.save_user_preferences(
            owner_uid=current_user.uid,
            selected_model=clean_model,
        )
        return UserPreferencesResponse(
            selected_model=saved.get("selected_model", clean_model),
            supported_models=settings.SUPPORTED_GEMINI_MODELS,
            default_model=settings.DEFAULT_GEMINI_MODEL,
        )
    except FirebaseOperationError as e:
        logger.error(f"Error saving preferences for user '{current_user.uid}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user preferences.",
        )


@router.post(
    "/validate-key",
    response_model=ValidateKeyResponse,
    status_code=status.HTTP_200_OK,
    summary="Validate Custom Gemini API Key (BYOK)",
    description="Validates a user-provided Gemini API key without logging or persisting it.",
)
def validate_custom_api_key(
    request: Optional[ValidateKeyRequest] = None,
    x_gemini_api_key: Optional[str] = Header(default=None, alias="X-Gemini-API-Key"),
    current_user: AuthenticatedUser = Depends(
        require_rate_limit("preferences", lambda: settings.RATE_LIMIT_PREFERENCES)
    ),
) -> ValidateKeyResponse:
    """
    Validates a BYOK key via a lightweight test API call.
    Never logs or persists the key.
    """
    api_key_candidate = None
    if x_gemini_api_key and x_gemini_api_key.strip():
        api_key_candidate = x_gemini_api_key.strip()
    elif request and request.api_key and request.api_key.strip():
        api_key_candidate = request.api_key.strip()

    if not api_key_candidate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Custom API key cannot be empty or whitespace.",
        )

    is_valid = gemini_service.validate_api_key(api_key_candidate)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Gemini API key or insufficient permissions.",
        )

    return ValidateKeyResponse(
        valid=True,
        message="Gemini API key verified successfully.",
    )

