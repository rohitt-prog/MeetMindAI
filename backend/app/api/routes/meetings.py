from fastapi import APIRouter, HTTPException, status
from app.schemas.meeting import (
    MeetingAnalysisRequest,
    MeetingAnalysisResponse,
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
        "action items with assigned owners and deadlines, and clarification questions."
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
