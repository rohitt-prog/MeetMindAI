from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
import logging

from app.schemas.meeting import (
    MeetingAnalysisRequest,
    MeetingAnalysisResponse,
    MeetingClarificationRequest,
    MeetingDetailResponse,
    MeetingListItem,
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

logger = logging.getLogger("meetmind-ai.meetings")

router = APIRouter(tags=["Meetings"])

@router.post(
    "/analyze",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze Meeting Transcript",
    description=(
        "Analyzes raw meeting transcript text using Google's Gemini AI and persists "
        "the structured meeting analysis to Firebase Cloud Firestore. "
        "Returns the structured summary, decisions, action items, clarifications, and assigned meeting_id."
    ),
)
def analyze_meeting_transcript(
    request: MeetingAnalysisRequest,
) -> MeetingAnalysisResponse:
    """
    Endpoint to process a meeting transcript into structured meeting insights
    and persist the result in Cloud Firestore.
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

        # Persist to Firestore if configured
        if firebase_service.is_configured():
            try:
                meeting_id = firebase_service.generate_meeting_id()
                firebase_service.save_meeting(
                    meeting_id=meeting_id,
                    transcript=request.transcript,
                    analysis=insights,
                    title=request.title,
                )
                insights.meeting_id = meeting_id
            except (FirebaseConfigError, FirebaseOperationError) as e:
                logger.warning(f"Could not persist meeting to Firestore: {e}")
                # We do not fail the analysis if only persistence fails, but attach warning
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
    description="Retrieves a list of recent saved meetings from Cloud Firestore ordered by most recently updated.",
)
def list_recent_meetings(
    limit: int = Query(default=20, ge=1, le=100, description="Max number of meetings to return"),
) -> List[MeetingListItem]:
    """
    Endpoint to retrieve recent meetings from Firestore.
    """
    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        return firebase_service.list_recent_meetings(limit=limit)
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


@router.get(
    "/{meeting_id}",
    response_model=MeetingDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Meeting Details",
    description="Retrieves full meeting details including transcript, analysis, and clarification history by meeting ID.",
)
def get_meeting_details(
    meeting_id: str,
) -> MeetingDetailResponse:
    """
    Endpoint to retrieve a specific saved meeting from Firestore.
    """
    if not firebase_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not configured. Please configure FIREBASE_PROJECT_ID and credentials in backend/.env.",
        )

    try:
        return firebase_service.get_meeting(meeting_id=meeting_id)
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
            detail=f"Failed to retrieve meeting '{meeting_id}': {str(e)}",
        )


@router.post(
    "/clarify",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit Clarification Answers",
    description=(
        "Submits answers to previously identified meeting ambiguities. "
        "Re-evaluates and updates related action items or decisions with Gemini AI. "
        "If a meeting_id is provided, updates the existing Firestore document in place."
    ),
)
def submit_clarifications(
    request: MeetingClarificationRequest,
) -> MeetingAnalysisResponse:
    """
    Endpoint to submit clarification answers and re-evaluate meeting analysis.
    Optionally persists the update back to Firestore if meeting_id is supplied.
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

    try:
        updated_insights = gemini_service.resolve_clarifications(
            analysis=request.analysis,
            answers=request.answers,
        )

        # Update in Firestore if meeting_id is provided
        if request.meeting_id and firebase_service.is_configured():
            try:
                firebase_service.update_meeting_clarification(
                    meeting_id=request.meeting_id,
                    updated_analysis=updated_insights,
                    answers=request.answers,
                )
                updated_insights.meeting_id = request.meeting_id
            except FirebaseNotFoundError as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                )
            except (FirebaseConfigError, FirebaseOperationError) as e:
                logger.error(f"Failed to update meeting {request.meeting_id} in Firestore: {e}")
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
