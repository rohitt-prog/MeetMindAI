import {
  HealthCheckResponse,
  MeetingAnalysisRequest,
  MeetingAnalysisResponse,
  MeetingClarificationRequest,
} from '../types';

/**
 * Base URL for the MeetMind AI backend API.
 * Configured via Vite environment variable VITE_API_BASE_URL.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Check backend service health status.
   * Calls GET /api/health
   */
  async getHealth(): Promise<HealthCheckResponse> {
    const url = `${this.baseUrl}/api/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Health check failed with status: ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as HealthCheckResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Analyze a meeting transcript with Gemini AI.
   * Calls POST /api/meetings/analyze
   */
  async analyzeMeeting(
    request: MeetingAnalysisRequest
  ): Promise<MeetingAnalysisResponse> {
    const url = `${this.baseUrl}/api/meetings/analyze`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        let errorMessage = `Analysis request failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string | unknown };
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail.map((e: { msg?: string }) => e.msg || '').join(', ');
          }
        } catch {
          // If response body is not JSON, use default error message
        }

        if (response.status === 503) {
          errorMessage = 'Gemini API key is not configured. Please add GEMINI_API_KEY to your backend/.env file.';
        } else if (response.status === 502) {
          errorMessage = `Gemini AI analysis failed: ${errorMessage}`;
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingAnalysisResponse;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl}. Please verify the server is running.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while analyzing the meeting.');
    }
  }

  /**
   * Submit clarification answers to refine the analysis.
   * Calls POST /api/meetings/clarify
   */
  async clarifyMeeting(
    request: MeetingClarificationRequest
  ): Promise<MeetingAnalysisResponse> {
    const url = `${this.baseUrl}/api/meetings/clarify`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        let errorMessage = `Clarification update failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string | unknown };
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          }
        } catch {
          // fallback
        }

        if (response.status === 503) {
          errorMessage = 'Gemini API key is not configured in backend/.env.';
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingAnalysisResponse;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to reach backend at ${this.baseUrl} to submit clarifications.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while submitting clarification answers.');
    }
  }

  /**
   * Helper to retrieve current base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const apiService = new ApiService(API_BASE_URL);
export default apiService;
