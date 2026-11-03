import { HealthCheckResponse } from '../types';

/**
 * Base URL for the MeetMind AI backend API.
 * Configured via Vite environment variable VITE_API_BASE_URL.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash if present
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
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Health check failed with status: ${response.status} ${response.statusText}`);
      }

      const data: HealthCheckResponse = await response.json();
      return data;
    } finally {
      clearTimeout(timeoutId);
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
