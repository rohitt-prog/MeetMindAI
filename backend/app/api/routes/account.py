import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.core.auth import AuthenticatedUser, get_current_user
from app.core.rate_limit import require_rate_limit
from app.schemas.account import AccountDeleteResponse
from app.services.firebase_service import (
    firebase_service,
    FirebaseConfigError,
    FirebaseOperationError,
)

logger = logging.getLogger("meetmind-ai.account")

router = APIRouter(tags=["Account"])


def safe_error_message(e: Exception, status_code: int, default_message: str) -> str:
    """
    Returns sanitized error message for client response.
    In production, always returns sanitized default message to prevent information leakage.
    For 500 internal errors, never exposes raw internal exception details.
    """
    if settings.ENVIRONMENT.lower() == "production" or status_code == status.HTTP_500_INTERNAL_SERVER_ERROR:
        return default_message
    return str(e)


@router.delete(
    "",
    response_model=AccountDeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete User Account and Associated Data",
    description=(
        "Permanently erases the authenticated user's account and all associated application data. "
        "Enforces strict authentication and ownership isolation. "
        "First deletes all meeting documents owned by the user, then removes the Firebase Authentication user."
    ),
)
def delete_user_account(
    current_user: AuthenticatedUser = Depends(
        require_rate_limit("account_delete", lambda: settings.RATE_LIMIT_ACCOUNT_DELETE)
    ),
) -> AccountDeleteResponse:
    """
    Endpoint to permanently delete the authenticated user's account and all associated Firestore data.
    """
    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        meetings_deleted = firebase_service.delete_user_account_and_data(owner_uid=current_user.uid)
        return AccountDeleteResponse(
            status="deleted",
            meetings_deleted=meetings_deleted,
            message=f"User account and {meetings_deleted} meeting record{'s' if meetings_deleted != 1 else ''} permanently deleted.",
        )
    except FirebaseConfigError as e:
        logger.error(f"Firebase configuration error in delete_user_account for user '{current_user.uid}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=safe_error_message(e, status.HTTP_503_SERVICE_UNAVAILABLE, "The service is temporarily unavailable."),
        )
    except FirebaseOperationError as e:
        logger.error(f"Firebase operation error in delete_user_account for user '{current_user.uid}': {e}")
        deleted_count = getattr(e, "deleted_count", 0)
        auth_failed = getattr(e, "auth_deletion_failed", False)

        if auth_failed:
            prod_msg = (
                f"Your saved meetings ({deleted_count}) were permanently deleted, but the authentication account "
                f"could not be removed. Please retry to complete account deletion."
            )
        elif deleted_count > 0:
            prod_msg = (
                f"The upstream database service is temporarily unavailable. {deleted_count} record{'s were' if deleted_count != 1 else ' was'} "
                f"deleted before failure. Your authentication account was not deleted. Please retry to complete account deletion."
            )
        else:
            prod_msg = "The upstream database service is temporarily unavailable. Please try again."

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=safe_error_message(e, status.HTTP_502_BAD_GATEWAY, prod_msg),
        )
    except Exception as e:
        logger.exception(f"Unexpected error during account deletion for user '{current_user.uid}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal server error occurred while processing your request. Please try again later.",
        )

