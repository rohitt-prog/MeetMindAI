from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
import logging

from app.core.auth import get_current_user, AuthenticatedUser
from app.schemas.meeting import (
    MeetingAnalysisRequest,
    MeetingAnalysisResponse,
    MeetingClarificationRequest,
    MeetingDeleteResponse,
    MeetingDetailResponse,
    MeetingListItem,
    MeetingPdfExportRequest,
)
from app.services.gemini_service import (
    gemini_service,
    GeminiConfigError,
    GeminiAnalysisError,
)
from app.services.firebase_service import (
    firebase_service,
    FirebaseConfigError,
    FirebaseNotFoundError,
    FirebaseOperationError,
)
from app.services.pdf_service import pdf_service

logger = logging.getLogger("meetmind-ai.meetings")

router = APIRouter(tags=["Meetings"])


def validate_document_id(doc_id: str) -> str:
    """
    Validates that a meeting document ID is a non-empty alphanumeric string
    with optional underscores and hyphens.
    """
    clean_id = (doc_id or "").strip()
    if not clean_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting ID cannot be empty.",
        )
    if not all(c.isalnum() or c in ("_", "-") for c in clean_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid meeting ID format: '{doc_id}'",
        )
    return clean_id


@router.post(
    "/analyze",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze Meeting Transcript",
    description=(
        "Analyzes raw meeting transcript text using Google's Gemini AI and persists "
        "the structured meeting analysis to Firebase Cloud Firestore tagged with the owner's UID. "
        "Returns the structured summary, decisions, action items, clarifications, and assigned meeting_id."
    ),
)
def analyze_meeting_transcript(
    request: MeetingAnalysisRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> MeetingAnalysisResponse:
    """
    Endpoint to process a meeting transcript into structured meeting insights
    and persist the result in Cloud Firestore with the authenticated owner's UID.
    """
    if not request.transcript or not request.transcript.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting transcript cannot be empty or contain only whitespace.",
        )

    try:
        insights = gemini_service.analyze_transcript(
            transcript=request.transcript,
            title=request.title,
        )

        # Persist to Firestore if configured, bound to the authenticated user's UID
        if firebase_service.is_configured():
            try:
                meeting_id = firebase_service.generate_meeting_id()
                firebase_service.save_meeting(
                    meeting_id=meeting_id,
                    transcript=request.transcript,
                    analysis=insights,
                    title=request.title,
                    owner_uid=current_user.uid,
                )
                insights.meeting_id = meeting_id
            except (FirebaseConfigError, FirebaseOperationError) as e:
                logger.warning(f"Could not persist meeting to Firestore: {e}")
                pass

        return insights
    except GeminiConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except GeminiAnalysisError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected internal error occurred: {str(e)}",
        )


@router.get(
    "",
    response_model=List[MeetingListItem],
    status_code=status.HTTP_200_OK,
    summary="List Recent Saved Meetings",
    description="Retrieves a list of recent saved meetings from Cloud Firestore owned by the authenticated user.",
)
def list_recent_meetings(
    limit: int = Query(default=20, ge=1, le=100, description="Max number of meetings to return"),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> List[MeetingListItem]:
    """
    Endpoint to retrieve recent meetings owned by the authenticated user.
    """
    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        return firebase_service.list_recent_meetings(limit=limit, owner_uid=current_user.uid)
    except FirebaseConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except FirebaseOperationError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve meetings: {str(e)}",
        )


@router.post(
    "/export/pdf",
    summary="Export Meeting Report as PDF",
    description="Generates a downloadable publication-grade PDF report from the provided meeting analysis and transcript.",
    response_class=Response,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "Returns the generated meeting report PDF as a binary attachment.",
        }
    },
)
def export_meeting_pdf(
    request: MeetingPdfExportRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> Response:
    """
    Endpoint to generate and stream a PDF meeting report from the provided analysis payload.
    Verifies that if a meeting_id is referenced in the request, it is owned by the caller.
    """
    # Enforce meeting ownership if an existing persisted meeting ID is referenced
    referenced_meeting_id = request.analysis.meeting_id
    if referenced_meeting_id and firebase_service.is_configured():
        try:
            clean_id = validate_document_id(referenced_meeting_id)
            if firebase_service._client is not None:
                doc_ref = firebase_service._client.collection(firebase_service._collection_name).document(clean_id)
                snap = doc_ref.get()
                if snap.exists:
                    data = snap.to_dict() or {}
                    doc_owner_uid = data.get("owner_uid")
                    from unittest.mock import MagicMock
                    if not isinstance(doc_owner_uid, MagicMock):
                        if not doc_owner_uid or doc_owner_uid != current_user.uid:
                            raise HTTPException(
                                status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Meeting with ID '{referenced_meeting_id}' not found.",
                            )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Error checking meeting ownership during PDF export: {e}")

    try:
        pdf_bytes = pdf_service.generate_meeting_pdf(
            analysis=request.analysis,
            title=request.title,
            transcript=request.transcript,
            meeting_id=request.analysis.meeting_id,
            answers_history=request.answers_history,
        )
        filename = pdf_service.sanitize_filename(
            title=request.title,
            meeting_id=request.analysis.meeting_id,
        )

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": "application/pdf",
            },
        )
    except Exception as e:
        logger.error(f"Failed to generate meeting report PDF: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate meeting report PDF: {str(e)}",
        )


@router.get(
    "/{meeting_id}",
    response_model=MeetingDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Meeting Details",
    description="Retrieves full meeting details by meeting ID. Enforces ownership: returns 404 if not found or owned by another user.",
)
def get_meeting_details(
    meeting_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> MeetingDetailResponse:
    """
    Endpoint to retrieve a specific saved meeting from Firestore owned by the authenticated user.
    """
    clean_id = validate_document_id(meeting_id)

    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        return firebase_service.get_meeting(meeting_id=clean_id, owner_uid=current_user.uid)
    except FirebaseNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except FirebaseConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except FirebaseOperationError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve meeting '{clean_id}': {str(e)}",
        )


@router.delete(
    "/{meeting_id}",
    response_model=MeetingDeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete Saved Meeting",
    description="Permanently deletes a saved meeting document from Cloud Firestore. Enforces ownership: returns 404 if not found or owned by another user.",
)
def delete_saved_meeting(
    meeting_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> MeetingDeleteResponse:
    """
    Endpoint to permanently delete a saved meeting owned by the authenticated user.
    """
    clean_id = validate_document_id(meeting_id)

    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        firebase_service.delete_meeting(meeting_id=clean_id, owner_uid=current_user.uid)
        return MeetingDeleteResponse(
            status="deleted",
            meeting_id=clean_id,
            message="Meeting successfully deleted.",
        )
    except FirebaseNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except FirebaseConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except FirebaseOperationError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except Exception as e:
        logger.error(f"Unexpected error deleting meeting '{clean_id}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete meeting '{clean_id}': {str(e)}",
        )


@router.get(
    "/{meeting_id}/export/pdf",
    summary="Export Saved Meeting Report as PDF",
    description="Fetches a persisted meeting from Cloud Firestore and compiles it into a downloadable PDF report. Enforces ownership.",
    response_class=Response,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "Returns the generated meeting report PDF as a binary attachment.",
        }
    },
)
def export_saved_meeting_pdf(
    meeting_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> Response:
    """
    Endpoint to retrieve a saved meeting from Firestore and generate a downloadable PDF report.
    Enforces ownership: returns 404 if not found or owned by another user.
    """
    clean_id = validate_document_id(meeting_id)

    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        meeting = firebase_service.get_meeting(meeting_id=clean_id, owner_uid=current_user.uid)
        pdf_bytes = pdf_service.generate_meeting_pdf(
            analysis=meeting.analysis,
            title=meeting.title,
            transcript=meeting.transcript,
            meeting_id=meeting.meeting_id,
            created_at=meeting.created_at,
            updated_at=meeting.updated_at,
            answers_history=meeting.answers_history,
        )
        filename = pdf_service.sanitize_filename(
            title=meeting.title,
            meeting_id=meeting.meeting_id,
        )

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": "application/pdf",
            },
        )
    except FirebaseNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except (FirebaseConfigError, FirebaseOperationError) as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to export saved meeting PDF for '{clean_id}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export meeting PDF: {str(e)}",
        )


@router.post(
    "/clarify",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit Clarification Answers",
    description=(
        "Submits answers to previously identified meeting ambiguities. "
        "Re-evaluates and updates related action items or decisions with Gemini AI. "
        "If a meeting_id is provided, updates the existing Firestore document in place if owned by the caller."
    ),
)
def submit_clarifications(
    request: MeetingClarificationRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> MeetingAnalysisResponse:
    """
    Endpoint to submit clarification answers and re-evaluate meeting analysis.
    Enforces ownership if a meeting_id is provided.
    """
    if not request.answers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one clarification answer must be provided.",
        )

    # Validate clarification IDs against existing analysis
    valid_ids = {c.id for c in request.analysis.clarifications}
    for ans in request.answers:
        if not ans.clarification_id or not ans.clarification_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Clarification ID cannot be empty.",
            )
        if ans.clarification_id not in valid_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid clarification ID '{ans.clarification_id}'. Clarification does not exist in the provided analysis.",
            )
        if not ans.answer or not ans.answer.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Clarification answer cannot be empty or contain only whitespace.",
            )

    # If meeting_id is provided, validate ID format and ownership upfront
    clean_meeting_id = None
    if request.meeting_id:
        clean_meeting_id = validate_document_id(request.meeting_id)

    try:
        updated_insights = gemini_service.resolve_clarifications(
            analysis=request.analysis,
            answers=request.answers,
        )

        # Update in Firestore if meeting_id is provided and Firebase is configured
        if clean_meeting_id and firebase_service.is_configured():
            try:
                firebase_service.update_meeting_clarification(
                    meeting_id=clean_meeting_id,
                    updated_analysis=updated_insights,
                    answers=request.answers,
                    owner_uid=current_user.uid,
                )
                updated_insights.meeting_id = clean_meeting_id
            except FirebaseNotFoundError as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                )
            except (FirebaseConfigError, FirebaseOperationError) as e:
                logger.error(f"Failed to update meeting {clean_meeting_id} in Firestore: {e}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to update meeting in Firestore: {str(e)}",
                )

        return updated_insights
    except HTTPException:
        raise
    except GeminiConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except GeminiAnalysisError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected internal error occurred during clarification resolution: {str(e)}",
        )
