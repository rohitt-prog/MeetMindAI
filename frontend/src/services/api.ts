import {
  HealthCheckResponse,
  MeetingAnalysisRequest,
  MeetingAnalysisResponse,
  MeetingClarificationRequest,
  MeetingDeleteResponse,
  MeetingListItem,
  MeetingDetailResponse,
  MeetingPdfExportRequest,
} from '../types/index';

/**
 * Base URL for the MeetMind AI backend API.
 * Configured via Vite environment variable VITE_API_BASE_URL.
 */
export const API_BASE_URL: string =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL) ||
  'http://localhost:8000';

class ApiService {
  private baseUrl: string;
  private authTokenGetter: (() => Promise<string | null>) | null = null;
  private onUnauthorized: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Registers a token getter function that provides the current Firebase ID token.
   */
  setAuthTokenGetter(getter: () => Promise<string | null>): void {
    this.authTokenGetter = getter;
  }

  /**
   * Registers a callback invoked when any request receives an HTTP 401 Unauthorized response.
   */
  setOnUnauthorized(callback: () => void): void {
    this.onUnauthorized = callback;
  }

  /**
   * Asynchronously retrieves the Authorization header with the current Bearer token.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (this.authTokenGetter) {
      try {
        const token = await this.authTokenGetter();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (err) {
        console.warn('Failed to resolve auth token for API request:', err);
      }
    }
    return headers;
  }

  /**
   * Triggers the unauthorized handler when a 401 status is encountered.
   */
  private handleUnauthorizedResponse(status: number): void {
    if (status === 401 && this.onUnauthorized) {
      this.onUnauthorized();
    }
  }

  /**
   * Check backend service health status.
   * Calls GET /api/health (falls back to GET /health if needed).
   */
  async getHealth(): Promise<HealthCheckResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      let response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      // Graceful fallback to root /health if /api/health returned 404
      if (response.status === 404) {
        response = await fetch(`${this.baseUrl}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        throw new Error(
          `Health check failed with status: ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as HealthCheckResponse;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Health check request timed out after 5 seconds.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Analyze a meeting transcript with Gemini AI and persist with authenticated owner UID.
   * Calls POST /api/meetings/analyze
   */
  async analyzeMeeting(
    request: MeetingAnalysisRequest
  ): Promise<MeetingAnalysisResponse> {
    const url = `${this.baseUrl}/api/meetings/analyze`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Analysis request failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string | unknown };
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail
              .map((e: { msg?: string }) => e.msg || '')
              .filter(Boolean)
              .join(', ');
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
        if (err.name === 'AbortError') {
          throw new Error('Analysis request timed out after 60 seconds. Please check your network and backend status.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl}. Please verify the server is running.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while analyzing the meeting.');
    } finally {
      clearTimeout(timeoutId);
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Clarification update failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string | unknown };
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail
              .map((e: { msg?: string }) => e.msg || '')
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // fallback
        }

        if (response.status === 404) {
          errorMessage = 'Meeting not found or you do not have permission to update it.';
        } else if (response.status === 503) {
          errorMessage = 'Gemini API key is not configured in backend/.env.';
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingAnalysisResponse;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Clarification request timed out after 60 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to reach backend at ${this.baseUrl} to submit clarifications.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while submitting clarification answers.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retrieve recent saved meetings owned by the authenticated user from Firestore.
   * Calls GET /api/meetings?limit={limit}
   */
  async listMeetings(limit: number = 20): Promise<MeetingListItem[]> {
    const url = `${this.baseUrl}/api/meetings?limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }

        let errorMessage = `Failed to list meetings (${response.status})`;
        try {
          const errorJson = (await response.json()) as { detail?: string };
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingListItem[];
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Listing meetings timed out after 10 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(`Unable to connect to backend at ${this.baseUrl}.`);
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while listing recent meetings.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retrieve details of a specific saved meeting owned by the user.
   * Calls GET /api/meetings/{meeting_id}
   */
  async getMeeting(meetingId: string): Promise<MeetingDetailResponse> {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }

        let errorMessage = `Failed to get meeting (${response.status})`;
        try {
          const errorJson = (await response.json()) as { detail?: string };
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }

        if (response.status === 404) {
          errorMessage = `Meeting with ID '${meetingId}' not found.`;
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingDetailResponse;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Retrieving meeting details timed out after 10 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(`Unable to connect to backend at ${this.baseUrl}.`);
        }
        throw err;
      }
      throw new Error(`An unexpected error occurred while loading meeting '${meetingId}'.`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Permanently deletes a saved meeting by meeting ID from Cloud Firestore.
   * Enforces ownership: returns 404 if not found or owned by another user.
   * Calls DELETE /api/meetings/{id}
   */
  async deleteMeeting(meetingId: string): Promise<MeetingDeleteResponse> {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          ...authHeaders,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }

        let errorMessage = `Failed to delete meeting with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string };
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }

        if (response.status === 404) {
          errorMessage = `Meeting '${meetingId}' not found or already deleted.`;
        } else if (response.status === 503) {
          errorMessage = 'Firebase Firestore is not configured on the backend.';
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as MeetingDeleteResponse;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Delete meeting request timed out after 15 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl} to delete meeting.`
          );
        }
        throw err;
      }
      throw new Error(`An unexpected error occurred while deleting meeting '${meetingId}'.`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Export unsaved or current meeting analysis as a PDF report.
   * Calls POST /api/meetings/export/pdf
   */
  async exportMeetingPdf(request: MeetingPdfExportRequest): Promise<{ blob: Blob; filename: string }> {
    const url = `${this.baseUrl}/api/meetings/export/pdf`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/pdf, application/json',
          ...authHeaders,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }

        let errorMessage = `PDF export failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string };
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        throw new Error(errorMessage);
      }

      // Extract filename from Content-Disposition header if available
      let filename = 'meetmind_meeting_report.pdf';
      const disposition = response.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, '').trim();
        }
      }

      const blob = await response.blob();
      return { blob, filename };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('PDF export timed out after 30 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(`Unable to connect to backend at ${this.baseUrl} to export PDF.`);
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while generating the PDF report.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Export a saved meeting by ID as a PDF report.
   * Calls GET /api/meetings/{meeting_id}/export/pdf
   */
  async exportSavedMeetingPdf(meetingId: string): Promise<{ blob: Blob; filename: string }> {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/export/pdf`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const authHeaders = await this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/pdf, application/json',
          ...authHeaders,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleUnauthorizedResponse(response.status);

        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }

        let errorMessage = `PDF export failed with status: ${response.status}`;
        try {
          const errorJson = (await response.json()) as { detail?: string };
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }

        if (response.status === 404) {
          errorMessage = `Meeting '${meetingId}' not found or access denied.`;
        }

        throw new Error(errorMessage);
      }

      let filename = `meetmind_${meetingId}.pdf`;
      const disposition = response.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, '').trim();
        }
      }

      const blob = await response.blob();
      return { blob, filename };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('PDF export timed out after 30 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(`Unable to connect to backend at ${this.baseUrl} to export PDF.`);
        }
        throw err;
      }
      throw new Error(`An unexpected error occurred while exporting meeting '${meetingId}' to PDF.`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Helper utility to trigger a browser file download from a Blob
   */
  downloadBlob(blob: Blob, filename: string): void {
    if (typeof window === 'undefined') return;
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
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
