from fastapi import APIRouter, HTTPException, status
from app.schemas.meeting import (
    MeetingAnalysisRequest,
    MeetingAnalysisResponse,
    MeetingClarificationRequest,
)
from app.services.gemini_service import (
    gemini_service,
    GeminiConfigError,
    GeminiAnalysisError,
)

router = APIRouter(tags=["Meetings"])

@router.post(
    "/analyze",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze Meeting Transcript",
    description=(
        "Analyzes raw meeting transcript text using Google's Gemini AI. "
        "Extracts structured summary, discussion points, decisions, "
        "action items with assigned owners and deadlines, and structured clarification questions."
    ),
)
def analyze_meeting_transcript(
    request: MeetingAnalysisRequest,
) -> MeetingAnalysisResponse:
    """
    Endpoint to process a meeting transcript into structured meeting insights.
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


@router.post(
    "/clarify",
    response_model=MeetingAnalysisResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit Clarification Answers",
    description=(
        "Submits answers to previously identified meeting ambiguities. "
        "Re-evaluates and updates related action items or decisions with Gemini AI, "
        "leaving unresolved questions flagged if the answers are insufficient."
    ),
)
def submit_clarifications(
    request: MeetingClarificationRequest,
) -> MeetingAnalysisResponse:
    """
    Endpoint to submit clarification answers and re-evaluate meeting analysis.
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
        return updated_insights
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
