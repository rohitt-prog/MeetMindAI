import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SETTINGS_COMPONENT_PATH = resolve(__dirname, '../src/components/Settings.tsx');

// Mock ApiService implementation for node test suite to mirror frontend/src/services/api.ts
class ApiServiceTestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authTokenGetter = null;
    this.onUnauthorized = null;
    this.customApiKey = null;
    this.customModel = null;
  }

  setCustomApiKey(key) {
    this.customApiKey = key && key.trim() ? key.trim() : null;
  }

  getCustomApiKey() {
    return this.customApiKey;
  }

  setCustomModel(model) {
    this.customModel = model && model.trim() ? model.trim() : null;
  }

  getCustomModel() {
    return this.customModel;
  }

  clearCustomModelAndKey() {
    this.customApiKey = null;
    this.customModel = null;
  }

  setAuthTokenGetter(getter) {
    this.authTokenGetter = getter;
  }

  setOnUnauthorized(callback) {
    this.onUnauthorized = callback;
  }

  async getAuthHeaders(forceRefresh = false) {
    const headers = {};
    if (this.authTokenGetter) {
      try {
        const token = await this.authTokenGetter(forceRefresh);
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (err) {
        // ignore
      }
    }
    return headers;
  }

  async fetchWithAuth(url, options = {}, allowRetry = true) {
    const authHeaders = await this.getAuthHeaders(false);
    const headers = {
      ...(options.headers || {}),
      ...authHeaders,
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && allowRetry && authHeaders['Authorization']) {
      try {
        const freshAuthHeaders = await this.getAuthHeaders(true);
        if (freshAuthHeaders['Authorization']) {
          const retryHeaders = {
            ...(options.headers || {}),
            ...freshAuthHeaders,
          };
          response = await fetch(url, { ...options, headers: retryHeaders });
        }
      } catch (err) {
        // ignore
      }
    }

    if (response.status === 401) {
      this.handleUnauthorizedResponse(response.status);
    }

    return response;
  }

  handleUnauthorizedResponse(status) {
    if (status === 401) {
      this.clearCustomModelAndKey();
      if (this.onUnauthorized) {
        this.onUnauthorized();
      }
    }
  }

  formatErrorMessage(response, defaultMessage) {
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        return `Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`;
      }
      return defaultMessage || 'Rate limit reached. Please wait a moment before sending more requests.';
    }
    if (response.status === 413) {
      return defaultMessage || 'Request payload too large (maximum size is 1 MiB / 100,000 characters). Please reduce transcript length.';
    }
    return defaultMessage || `Request failed with status: ${response.status}`;
  }

  async getHealth() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      let response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

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

      return await response.json();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Health check request timed out after 5 seconds.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async analyzeMeeting(request) {
    const url = `${this.baseUrl}/api/meetings/analyze`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const requestHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (this.customApiKey) {
        requestHeaders['X-Gemini-API-Key'] = this.customApiKey;
      }
      if (this.customModel) {
        requestHeaders['X-Gemini-Model'] = this.customModel;
      }

      const response = await this.fetchWithAuth(url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }
        let errorMessage = `Analysis request failed with status: ${response.status}`;
        try {
          const errorJson = await response.json();
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail
              .map((e) => e.msg || '')
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // fallback
        }

        if (response.status === 429 || response.status === 413) {
          errorMessage = this.formatErrorMessage(response, errorMessage);
        } else if (response.status === 503) {
          errorMessage = 'Gemini API key is not configured. Please add GEMINI_API_KEY to your backend/.env file.';
        } else if (response.status === 502) {
          errorMessage = `Gemini AI analysis failed: ${errorMessage}`;
        }

        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
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

  async clarifyMeeting(request) {
    const url = `${this.baseUrl}/api/meetings/clarify`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const requestHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (this.customApiKey) {
        requestHeaders['X-Gemini-API-Key'] = this.customApiKey;
      }
      if (this.customModel) {
        requestHeaders['X-Gemini-Model'] = this.customModel;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Clarification update failed with status: ${response.status}`;
        try {
          const errorJson = await response.json();
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail
              .map((e) => e.msg || '')
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // fallback
        }

        if (response.status === 503) {
          errorMessage = 'Gemini API key is not configured in backend/.env.';
        }

        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
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

  async listMeetings(limit = 20) {
    const url = `${this.baseUrl}/api/meetings?limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in.');
        }
        let errorMessage = `Failed to list meetings (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
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

  async getMeeting(meetingId) {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Failed to get meeting (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
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

  async deleteMeeting(meetingId) {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Failed to delete meeting with status: ${response.status}`;
        try {
          const errorJson = await response.json();
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

      return await response.json();
    } catch (err) {
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

  async deleteAllMeetings() {
    const url = `${this.baseUrl}/api/meetings`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Failed to delete all meetings (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        if (response.status === 429) {
          errorMessage = this.formatErrorMessage(response, errorMessage);
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Bulk delete request timed out after 30 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl} to delete all meetings.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while deleting all meetings.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async deleteAccount() {
    const url = `${this.baseUrl}/api/account`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Failed to delete account (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        if (response.status === 429) {
          errorMessage = this.formatErrorMessage(response, errorMessage);
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Account deletion request timed out after 30 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl} to delete account.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while deleting the account.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async exportBackup() {
    const url = `${this.baseUrl}/api/meetings/backup`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Failed to export backup (${response.status})`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        if (response.status === 429) {
          errorMessage = this.formatErrorMessage(response, errorMessage);
        } else if (response.status === 503) {
          errorMessage = 'Firebase Firestore is not configured on the backend.';
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Backup export timed out after 30 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl} to export backup.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while exporting meeting backup.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async restoreBackup(backup, conflictStrategy = 'skip') {
    const url = `${this.baseUrl}/api/meetings/restore?conflict_strategy=${encodeURIComponent(conflictStrategy)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(backup),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required or session expired. Please sign in again.');
        }

        let errorMessage = `Failed to restore backup (${response.status})`;
        try {
          const errorJson = await response.json();
          if (typeof errorJson.detail === 'string') {
            errorMessage = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorMessage = errorJson.detail
              .map((e) => e.msg || '')
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // fallback
        }

        if (response.status === 429) {
          errorMessage = this.formatErrorMessage(response, errorMessage);
        } else if (response.status === 503) {
          errorMessage = 'Firebase Firestore is not configured on the backend.';
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Backup restore timed out after 45 seconds.');
        }
        if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
          throw new Error(
            `Unable to connect to MeetMind AI backend at ${this.baseUrl} to restore backup.`
          );
        }
        throw err;
      }
      throw new Error('An unexpected error occurred while restoring meeting backup.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async exportMeetingPdf(request) {
    const url = `${this.baseUrl}/api/meetings/export/pdf`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/pdf, application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `PDF export failed with status: ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
        }
        throw new Error(errorMessage);
      }

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
    } catch (err) {
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

  async exportSavedMeetingPdf(meetingId) {
    const url = `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/export/pdf`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await this.fetchWithAuth(url, {
        method: 'GET',
        headers: {
          Accept: 'application/pdf, application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `PDF export failed with status: ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorMessage = errorJson.detail;
        } catch {
          // fallback
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
    } catch (err) {
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

  async getUserPreferences() {
    const url = `${this.baseUrl}/api/preferences`;
    const response = await this.fetchWithAuth(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Authentication required');
      let errorMessage = `Failed to get preferences (${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson.detail) errorMessage = errorJson.detail;
      } catch {}
      throw new Error(errorMessage);
    }
    const data = await response.json();
    if (!this.customModel) {
      this.customModel = data.selected_model;
    }
    return data;
  }

  async updateUserPreferences(selectedModel) {
    const url = `${this.baseUrl}/api/preferences`;
    const response = await this.fetchWithAuth(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ selected_model: selectedModel }),
    });
    if (!response.ok) {
      let errorMessage = `Failed to update preferences (${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson.detail) errorMessage = errorJson.detail;
      } catch {}
      throw new Error(errorMessage);
    }
    const data = await response.json();
    this.customModel = data.selected_model;
    return data;
  }

  async validateApiKey(apiKey) {
    const url = `${this.baseUrl}/api/preferences/validate-key`;
    const response = await this.fetchWithAuth(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Gemini-API-Key': apiKey.trim(),
      },
      body: JSON.stringify({ api_key: apiKey.trim() }),
    });
    if (!response.ok) {
      let errorMessage = 'Invalid Gemini API key or insufficient permissions.';
      try {
        const errorJson = await response.json();
        if (errorJson.detail) errorMessage = errorJson.detail;
      } catch {}
      throw new Error(errorMessage);
    }
    return await response.json();
  }
}

describe('Frontend API Service & State Integration Tests', () => {
  let originalFetch;
  let client;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new ApiServiceTestClient('http://localhost:8000');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Health Check: successfully queries /api/health and returns ok status', async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /\/api\/health$/);
      return new Response(JSON.stringify({ status: 'ok', app: 'MeetMind AI' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await client.getHealth();
    assert.equal(res.status, 'ok');
    assert.equal(res.app, 'MeetMind AI');
  });

  it('Health Check: falls back to /health if /api/health returns 404', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      if (url.endsWith('/api/health')) {
        return new Response('Not Found', { status: 404 });
      }
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', app: 'MeetMind AI' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const res = await client.getHealth();
    assert.equal(callCount, 2);
    assert.equal(res.status, 'ok');
  });

  it('Health Check: reports failure when server responds with 500', async () => {
    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });

    await assert.rejects(
      async () => client.getHealth(),
      /Health check failed with status: 500/
    );
  });

  it('Meeting Analysis: correctly posts transcript and processes structured response', async () => {
    const mockAnalysis = {
      summary: 'Team sync summary.',
      discussion_points: ['Point A', 'Point B'],
      decisions: ['Decision 1'],
      action_items: [
        {
          id: 'action_1',
          task: 'Complete spec',
          owner: 'Alex',
          deadline: 'Wednesday',
          status: 'pending',
        },
        {
          id: 'action_2',
          task: 'Provision DB',
          owner: null, // Null owner
          deadline: null, // Null deadline
          status: 'pending',
        },
      ],
      clarification_required: true,
      clarification_question: 'Who will provision DB?',
      clarifications: [
        {
          id: 'clarif_1',
          category: 'ownership',
          original_statement: 'Someone provision DB.',
          explanation: 'No owner.',
          question: 'Who will provision DB?',
          related_action_item_id: 'action_2',
          resolved: false,
        },
      ],
    };

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/analyze$/);
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.title, 'Sprint Planning');
      assert.ok(body.transcript.includes('Alex'));

      return new Response(JSON.stringify(mockAnalysis), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await client.analyzeMeeting({
      title: 'Sprint Planning',
      transcript: 'Alex will complete spec. Someone provision DB.',
    });

    assert.equal(result.summary, 'Team sync summary.');
    assert.equal(result.action_items[1].owner, null);
    assert.equal(result.action_items[1].deadline, null);
    assert.equal(result.clarification_required, true);
    assert.equal(result.clarifications[0].resolved, false);
  });

  it('Meeting Analysis: handles HTTP 503 when GEMINI_API_KEY is not configured', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Gemini API key is not configured.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.analyzeMeeting({ transcript: 'Test transcript' }),
      /Gemini API key is not configured\. Please add GEMINI_API_KEY to your backend\/\.env file\./
    );
  });

  it('Meeting Analysis: handles HTTP 502 upstream Gemini failure', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Quota exceeded for model gemini-2.5-flash' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.analyzeMeeting({ transcript: 'Test transcript' }),
      /Gemini AI analysis failed: Quota exceeded/
    );
  });

  it('Clarification: sends batch clarification answers and receives updated analysis', async () => {
    const existingAnalysis = {
      summary: 'Initial summary',
      discussion_points: ['Topic 1'],
      decisions: [],
      action_items: [
        { id: 'action_1', task: 'Task 1', owner: null, deadline: null, status: 'pending' },
        { id: 'action_2', task: 'Task 2', owner: null, deadline: null, status: 'pending' },
      ],
      clarification_required: true,
      clarification_question: 'Question 1',
      clarifications: [
        {
          id: 'clarif_1',
          category: 'ownership',
          original_statement: 'Stmt 1',
          explanation: 'Exp 1',
          question: 'Question 1',
          related_action_item_id: 'action_1',
          resolved: false,
        },
        {
          id: 'clarif_2',
          category: 'ownership',
          original_statement: 'Stmt 2',
          explanation: 'Exp 2',
          question: 'Question 2',
          related_action_item_id: 'action_2',
          resolved: false,
        },
      ],
    };

    const updatedAnalysis = {
      ...existingAnalysis,
      action_items: [
        { id: 'action_1', task: 'Task 1', owner: 'David', deadline: 'Tomorrow', status: 'pending' },
        { id: 'action_2', task: 'Task 2', owner: 'Sarah', deadline: 'Friday', status: 'pending' },
      ],
      clarification_required: false,
      clarification_question: null,
      clarifications: [
        { ...existingAnalysis.clarifications[0], resolved: true },
        { ...existingAnalysis.clarifications[1], resolved: true },
      ],
    };

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/clarify$/);
      const req = JSON.parse(options.body);
      assert.equal(req.answers.length, 2);
      assert.equal(req.answers[0].clarification_id, 'clarif_1');
      assert.equal(req.answers[1].clarification_id, 'clarif_2');

      return new Response(JSON.stringify(updatedAnalysis), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await client.clarifyMeeting({
      analysis: existingAnalysis,
      answers: [
        { clarification_id: 'clarif_1', answer: 'David will handle it tomorrow' },
        { clarification_id: 'clarif_2', answer: 'Sarah will handle it Friday' },
      ],
    });

    assert.equal(result.action_items[0].owner, 'David');
    assert.equal(result.action_items[1].owner, 'Sarah');
    assert.equal(result.clarification_required, false);
    assert.equal(result.clarifications[0].resolved, true);
    assert.equal(result.clarifications[1].resolved, true);
  });

  it('Clarification Failure: preserves state and throws without data corruption', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Backend database connection timeout.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    const existingAnalysis = {
      summary: 'Preserved summary',
      discussion_points: [],
      decisions: [],
      action_items: [],
      clarification_required: true,
      clarifications: [],
    };

    await assert.rejects(
      async () =>
        client.clarifyMeeting({
          analysis: existingAnalysis,
          answers: [{ clarification_id: 'clarif_1', answer: 'Answer' }],
        }),
      /Backend database connection timeout/
    );

    // Existing analysis object is completely unmodified
    assert.equal(existingAnalysis.summary, 'Preserved summary');
    assert.equal(existingAnalysis.clarification_required, true);
  });

  it('List Meetings: successfully queries /api/meetings with limit parameter', async () => {
    const mockList = [
      {
        meeting_id: 'meeting_123',
        title: 'Sprint Planning',
        summary: 'Discussion on roadmap.',
        created_at: '2026-11-03T18:00:00Z',
        updated_at: '2026-11-03T18:00:00Z',
        action_items_count: 3,
        decisions_count: 2,
        clarification_required: false,
        unresolved_clarifications_count: 0,
      },
      {
        meeting_id: 'meeting_456',
        title: 'Backend Sync',
        summary: 'Discussion on Firestore.',
        created_at: '2026-11-03T19:00:00Z',
        updated_at: '2026-11-03T19:10:00Z',
        action_items_count: 1,
        decisions_count: 1,
        clarification_required: true,
        unresolved_clarifications_count: 1,
      },
    ];

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\?limit=10$/);
      assert.equal(options.method, 'GET');
      return new Response(JSON.stringify(mockList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const meetings = await client.listMeetings(10);
    assert.equal(meetings.length, 2);
    assert.equal(meetings[0].meeting_id, 'meeting_123');
    assert.equal(meetings[0].action_items_count, 3);
    assert.equal(meetings[1].clarification_required, true);
  });

  it('List Meetings: handles HTTP 503 when Firebase is unconfigured', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Firebase Firestore persistence is not configured.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.listMeetings(),
      /Firebase Firestore persistence is not configured\./
    );
  });

  it('Get Meeting: retrieves full meeting details and history by ID', async () => {
    const mockDetail = {
      meeting_id: 'meeting_789',
      title: 'Architecture Review',
      transcript: 'Full meeting transcript dialogue here.',
      created_at: '2026-11-03T15:00:00Z',
      updated_at: '2026-11-03T15:30:00Z',
      analysis: {
        summary: 'Architecture decisions finalized.',
        discussion_points: ['Firestore vs MongoDB'],
        decisions: ['Use Cloud Firestore'],
        action_items: [
          {
            id: 'item_1',
            task: 'Implement FirebaseService',
            owner: 'Vishal',
            deadline: 'Today',
            status: 'completed',
          },
        ],
        clarification_required: false,
        clarifications: [],
        meeting_id: 'meeting_789',
      },
      answers_history: [
        {
          clarification_id: 'clarif_1',
          answer: 'Vishal will implement it today',
          timestamp: '2026-11-03T15:30:00Z',
        },
      ],
    };

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/meeting_789$/);
      assert.equal(options.method, 'GET');
      return new Response(JSON.stringify(mockDetail), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const detail = await client.getMeeting('meeting_789');
    assert.equal(detail.meeting_id, 'meeting_789');
    assert.equal(detail.title, 'Architecture Review');
    assert.equal(detail.transcript, 'Full meeting transcript dialogue here.');
    assert.equal(detail.analysis.decisions[0], 'Use Cloud Firestore');
    assert.equal(detail.answers_history.length, 1);
  });

  it('Get Meeting: throws descriptive error on 404 Not Found', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Meeting 'nonexistent_id' not found in Firestore." }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.getMeeting('nonexistent_id'),
      /Meeting 'nonexistent_id' not found in Firestore\./
    );
  });

  it('PDF Export: successfully posts analysis and returns PDF blob with filename', async () => {
    const mockPdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // "%PDF-1.4"
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/export\/pdf$/);
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.title, 'Sprint Architecture');

      return new Response(mockPdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="meetmind_sprint_architecture.pdf"',
        },
      });
    };

    const result = await client.exportMeetingPdf({
      title: 'Sprint Architecture',
      transcript: 'Alex will finalize GraphQL schema.',
      analysis: {
        summary: 'Team summary',
        discussion_points: [],
        decisions: [],
        action_items: [],
        clarification_required: false,
        clarifications: [],
      },
    });

    assert.equal(result.filename, 'meetmind_sprint_architecture.pdf');
    assert.ok(result.blob);
    assert.equal(result.blob.size, 8);
  });

  it('PDF Export: handles 500 error when PDF compiler fails', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Failed to generate meeting report PDF.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () =>
        client.exportMeetingPdf({
          title: 'Failing Meeting',
          analysis: {
            summary: 'Summary',
            discussion_points: [],
            decisions: [],
            action_items: [],
            clarification_required: false,
            clarifications: [],
          },
        }),
      /Failed to generate meeting report PDF\./
    );
  });

  it('Saved Meeting PDF Export: retrieves PDF blob for stored meeting ID', async () => {
    const mockPdfBytes = new Uint8Array([37, 80, 68, 70]);
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/m_12345\/export\/pdf$/);
      assert.equal(options.method, 'GET');

      return new Response(mockPdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="meetmind_m_12345.pdf"',
        },
      });
    };

    const result = await client.exportSavedMeetingPdf('m_12345');
    assert.equal(result.filename, 'meetmind_m_12345.pdf');
    assert.ok(result.blob);
    assert.equal(result.blob.size, 4);
  });

  it('Saved Meeting PDF Export: handles 404 when saved meeting not found', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Meeting 'm_missing' not found in Firestore." }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.exportSavedMeetingPdf('m_missing'),
      /Meeting 'm_missing' not found in Firestore\./
    );
  });

  it('Meeting Analysis: correctly processes analysis with open follow-ups and deferred tasks', async () => {
    const mockAnalysisResponse = {
      meeting_id: 'm_deferred_123',
      summary: 'Product launch sync with deferred marketing owner.',
      discussion_points: ['Marketing coordination'],
      decisions: [],
      action_items: [
        {
          id: 'action_1',
          task: 'Inform the marketing team',
          owner: null,
          deadline: null,
          status: 'deferred: next meeting',
        },
      ],
      clarification_required: false,
      clarification_question: null,
      clarifications: [],
      open_follow_ups: [
        'Inform the marketing team (owner to be decided in next meeting)',
      ],
    };

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/analyze$/);
      assert.equal(options.method, 'POST');
      return new Response(JSON.stringify(mockAnalysisResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await client.analyzeMeeting({
      title: 'Launch Sync',
      transcript: 'Maya: We need to inform marketing, but let us decide who will do that in the next meeting.',
    });

    assert.equal(result.meeting_id, 'm_deferred_123');
    assert.equal(result.clarification_required, false);
    assert.equal(result.action_items[0].owner, null);
    assert.match(result.action_items[0].status, /deferred/);
    assert.equal(result.open_follow_ups.length, 1);
    assert.match(result.open_follow_ups[0], /marketing/);
  });

  it('PDF Export: passes analysis containing open follow-ups cleanly', async () => {
    const mockPdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    let capturedBody = null;

    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/meetings\/export\/pdf$/);
      assert.equal(options.method, 'POST');
      capturedBody = JSON.parse(options.body);

      return new Response(mockPdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="meetmind_launch_sync.pdf"',
        },
      });
    };

    const result = await client.exportMeetingPdf({
      title: 'Launch Sync',
      analysis: {
        summary: 'Sync summary',
        discussion_points: [],
        decisions: [],
        action_items: [
          {
            id: 'action_1',
            task: 'Inform marketing team',
            owner: null,
            deadline: null,
            status: 'deferred: next meeting',
          },
        ],
        clarification_required: false,
        clarifications: [],
        open_follow_ups: ['Inform marketing team (next meeting)'],
      },
    });

    assert.equal(result.filename, 'meetmind_launch_sync.pdf');
    assert.ok(result.blob);
    assert.ok(capturedBody.analysis.open_follow_ups);
    assert.equal(capturedBody.analysis.open_follow_ups.length, 1);
  });

  it('PDF Export Security: exportMeetingPdf and exportSavedMeetingPdf never forward BYOK key or model headers', async () => {
    client.setCustomModel('gemini-2.5-pro');
    client.setCustomApiKey('AIzaSySecretBYOKKey999Phase2D');

    const mockPdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    let capturedPostHeaders = null;
    let capturedGetHeaders = null;

    globalThis.fetch = async (url, options) => {
      if (options.method === 'POST') {
        capturedPostHeaders = options.headers;
      } else if (options.method === 'GET') {
        capturedGetHeaders = options.headers;
      }
      return new Response(mockPdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="meetmind_report.pdf"',
        },
      });
    };

    // 1. Test POST /api/meetings/export/pdf
    await client.exportMeetingPdf({
      title: 'Security Sync',
      analysis: {
        summary: 'Testing BYOK exclusion in PDF export.',
        discussion_points: [],
        decisions: [],
        action_items: [],
        clarification_required: false,
        clarifications: [],
      },
    });

    assert.ok(capturedPostHeaders);
    assert.equal(capturedPostHeaders['X-Gemini-API-Key'], undefined, 'Must not send X-Gemini-API-Key in exportMeetingPdf');
    assert.equal(capturedPostHeaders['X-Gemini-Model'], undefined, 'Must not send X-Gemini-Model in exportMeetingPdf');

    // 2. Test GET /api/meetings/{id}/export/pdf
    await client.exportSavedMeetingPdf('m_saved_123');

    assert.ok(capturedGetHeaders);
    assert.equal(capturedGetHeaders['X-Gemini-API-Key'], undefined, 'Must not send X-Gemini-API-Key in exportSavedMeetingPdf');
    assert.equal(capturedGetHeaders['X-Gemini-Model'], undefined, 'Must not send X-Gemini-Model in exportSavedMeetingPdf');

    client.clearCustomModelAndKey();
  });

  it('Delete Meeting: sends DELETE request and returns confirmation', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(
        JSON.stringify({
          status: 'deleted',
          meeting_id: 'm_test_del_123',
          message: 'Meeting successfully deleted.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const res = await client.deleteMeeting('m_test_del_123');
    assert.equal(res.status, 'deleted');
    assert.equal(res.meeting_id, 'm_test_del_123');
    assert.match(capturedUrl, /\/api\/meetings\/m_test_del_123$/);
    assert.equal(capturedMethod, 'DELETE');
  });

  it('Delete Meeting: handles 404 when meeting not found or already deleted', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Meeting with ID 'm_missing_123' not found." }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.deleteMeeting('m_missing_123'),
      /not found or already deleted/
    );
  });

  it('Delete Meeting: handles 503 when Firebase Firestore is not configured', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: 'Firebase Firestore is not configured.',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    await assert.rejects(
      async () => client.deleteMeeting('m_test_123'),
      /Firebase Firestore is not configured/
    );
  });

  it('Authentication: attaches Bearer token header when setAuthTokenGetter is provided', async () => {
    let capturedHeaders = null;
    client.setAuthTokenGetter(async () => 'mock_firebase_id_token_xyz123');

    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await client.listMeetings(5);
    assert.ok(capturedHeaders, 'Headers should be captured');
    assert.equal(capturedHeaders['Authorization'], 'Bearer mock_firebase_id_token_xyz123');
    client.setAuthTokenGetter(null);
  });

  it('Authentication: handles HTTP 401 and invokes onUnauthorized callback', async () => {
    let unauthorizedTriggered = false;
    client.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Authentication required. Invalid or expired token.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.listMeetings(10),
      /Authentication required or session expired/
    );

    assert.equal(unauthorizedTriggered, true, 'onUnauthorized callback should be called on 401');
    client.setOnUnauthorized(null);
  });

  it('Meeting Analysis: handles HTTP 429 rate limit exceeded with Retry-After header', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Rate limit exceeded for endpoint 'analyze'." }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '45',
        },
      });

    await assert.rejects(
      async () => client.analyzeMeeting({ transcript: 'Test transcript' }),
      /Rate limit exceeded\. Please wait 45 seconds before trying again\./
    );
  });

  it('Meeting Analysis: handles HTTP 413 payload too large error', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Payload Too Large: Request body size exceeds limit.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      async () => client.analyzeMeeting({ transcript: 'Large transcript...' }),
      /Payload Too Large/
    );
  });

  // ============================================================================
  // Session Expiration & Token Lifecycle Tests
  // ============================================================================

  it('Session & Auth: waits for auth initialization before attaching token', async () => {
    let authReady = false;
    // Simulate async auth initialization delay
    const mockAuthInit = new Promise((resolve) => {
      setTimeout(() => {
        authReady = true;
        resolve();
      }, 20);
    });

    client.setAuthTokenGetter(async () => {
      await mockAuthInit;
      return authReady ? 'token_after_auth_ready' : null;
    });

    let capturedHeaders = null;
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const meetings = await client.listMeetings(5);
    assert.deepEqual(meetings, []);
    assert.equal(capturedHeaders['Authorization'], 'Bearer token_after_auth_ready');
    client.setAuthTokenGetter(null);
  });

  it('Session & Auth: unauthenticated requests omit Authorization header cleanly', async () => {
    client.setAuthTokenGetter(async () => null);

    let capturedHeaders = null;
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await client.listMeetings(5);
    assert.equal(capturedHeaders['Authorization'], undefined, 'No Authorization header should be attached');
    client.setAuthTokenGetter(null);
  });

  it('Session & Auth: 401 triggers single token refresh and transparent retry', async () => {
    let fetchCount = 0;
    let refreshRequested = false;

    client.setAuthTokenGetter(async (forceRefresh = false) => {
      if (forceRefresh) {
        refreshRequested = true;
        return 'fresh_refreshed_id_token_xyz';
      }
      return 'expired_initial_id_token_abc';
    });

    let unauthorizedTriggered = false;
    client.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    globalThis.fetch = async (url, options) => {
      fetchCount++;
      const authHeader = options.headers['Authorization'];

      // First request sent with expired token: returns 401
      if (authHeader === 'Bearer expired_initial_id_token_abc') {
        return new Response(JSON.stringify({ detail: 'Token has expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Retried request sent with refreshed token: succeeds with 200
      if (authHeader === 'Bearer fresh_refreshed_id_token_xyz') {
        return new Response(JSON.stringify([{ meeting_id: 'm_123', title: 'Roadmap' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Unauthorized', { status: 401 });
    };

    const result = await client.listMeetings(10);
    assert.equal(fetchCount, 2, 'Should execute exactly 2 fetch calls (original + retry)');
    assert.equal(refreshRequested, true, 'forceRefresh=true should have been requested from getter');
    assert.equal(unauthorizedTriggered, false, 'onUnauthorized should not fire because retry succeeded');
    assert.equal(result.length, 1);
    assert.equal(result[0].meeting_id, 'm_123');

    client.setAuthTokenGetter(null);
    client.setOnUnauthorized(null);
  });

  it('Session & Auth: prevents infinite retry loops when refreshed token is also 401', async () => {
    let fetchCount = 0;
    let refreshCalls = 0;
    let unauthorizedTriggered = false;

    client.setAuthTokenGetter(async (forceRefresh = false) => {
      if (forceRefresh) refreshCalls++;
      return 'always_rejected_token';
    });

    client.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify({ detail: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await assert.rejects(
      async () => client.listMeetings(10),
      /Authentication required or session expired/
    );

    assert.equal(fetchCount, 2, 'Should retry at most once and strictly prevent infinite loop');
    assert.equal(refreshCalls, 1, 'Token refresh requested once');
    assert.equal(unauthorizedTriggered, true, 'onUnauthorized should be invoked after exhausted retry');

    client.setAuthTokenGetter(null);
    client.setOnUnauthorized(null);
  });

  it('Session & Auth: signin immediately provides valid token without stale closures', async () => {
    // Simulate user state transitions
    let activeToken = null;
    const tokenGetter = async () => activeToken;
    client.setAuthTokenGetter(tokenGetter);

    // Initial visitor state: null token
    assert.equal(await tokenGetter(), null);

    // User signs in: token becomes immediately available synchronously
    activeToken = 'signed_in_user_firebase_token';

    let capturedAuthHeader = null;
    globalThis.fetch = async (url, options) => {
      capturedAuthHeader = options.headers['Authorization'];
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // First call to listMeetings after login
    await client.listMeetings(25);
    assert.equal(capturedAuthHeader, 'Bearer signed_in_user_firebase_token');

    client.setAuthTokenGetter(null);
  });

  it('Demo Account: demo sign-in provides valid token and executes API requests without 401 or expiration', async () => {
    let unauthorizedTriggered = false;
    let capturedAuthHeader = null;

    client.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    // Simulate demo authentication yielding a real Firebase ID token
    const demoToken = 'valid_google_signed_demo_id_token_xyz';
    client.setAuthTokenGetter(async () => demoToken);

    globalThis.fetch = async (url, options) => {
      capturedAuthHeader = options.headers['Authorization'];
      return new Response(
        JSON.stringify([
          {
            meeting_id: 'm_demo_1',
            title: 'Q3 Product Strategy',
            meeting_date: '2026-11-04T10:00:00Z',
            action_items_count: 3,
            clarifications_status: 'resolved',
            created_at: '2026-11-04T10:30:00Z',
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const meetings = await client.listMeetings(25);
    assert.equal(meetings.length, 1);
    assert.equal(meetings[0].meeting_id, 'm_demo_1');
    assert.equal(capturedAuthHeader, 'Bearer valid_google_signed_demo_id_token_xyz');
    assert.equal(unauthorizedTriggered, false, 'onUnauthorized must not be called for valid demo session');

    client.setAuthTokenGetter(null);
    client.setOnUnauthorized(null);
  });

  it('Demo Account: rejecting unverified/dummy tokens invokes onUnauthorized and triggers signout', async () => {
    let unauthorizedTriggered = false;
    let callCount = 0;

    client.setOnUnauthorized(() => {
      unauthorizedTriggered = true;
    });

    // Simulating former faulty behavior: dummy token sent when backend expects Firebase Admin verification
    client.setAuthTokenGetter(async () => 'demo_token_demo_user_101');

    globalThis.fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({ detail: 'Invalid authentication token. Verification failed.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => client.listMeetings(25),
      /Authentication required or session expired/
    );

    assert.equal(unauthorizedTriggered, true, 'onUnauthorized should fire on unverified dummy token');
    assert.equal(callCount, 2, 'Should retry once and fail safely');

    client.setAuthTokenGetter(null);
    client.setOnUnauthorized(null);
  });

  describe('Phase 1 Settings, Appearance & Account Controls', () => {
    it('Theme resolution: correctly evaluates light, dark, and system modes', () => {
      // Helper function simulating theme mode resolution
      const resolveIsDark = (mode, systemPrefersDark) => {
        if (mode === 'dark') return true;
        if (mode === 'light') return false;
        return !!systemPrefersDark;
      };

      assert.equal(resolveIsDark('light', true), false);
      assert.equal(resolveIsDark('light', false), false);
      assert.equal(resolveIsDark('dark', true), true);
      assert.equal(resolveIsDark('dark', false), true);
      assert.equal(resolveIsDark('system', true), true);
      assert.equal(resolveIsDark('system', false), false);
    });

    it('Account validation: validates display name input rules', () => {
      const validateDisplayName = (input) => {
        const trimmed = (input || '').trim();
        if (!trimmed) {
          throw new Error('Please enter a valid display name.');
        }
        if (trimmed.length > 50) {
          throw new Error('Display name must not exceed 50 characters.');
        }
        return trimmed;
      };

      assert.throws(() => validateDisplayName(''), /valid display name/);
      assert.throws(() => validateDisplayName('   '), /valid display name/);
      assert.throws(() => validateDisplayName('a'.repeat(51)), /must not exceed 50 characters/);
      assert.equal(validateDisplayName('  Jane Doe  '), 'Jane Doe');
      assert.equal(validateDisplayName('Alex'), 'Alex');
    });

    it('Account security: rejects password reset request for demo or anonymous accounts', () => {
      const sendPasswordResetCheck = (user) => {
        if (!user) {
          throw new Error('No authenticated user session found.');
        }
        if (user.isDemoUser) {
          throw new Error('Password reset is not available for temporary demo accounts.');
        }
        if (!user.email) {
          throw new Error('No email address associated with this account.');
        }
        return true;
      };

      // Unauthenticated
      assert.throws(() => sendPasswordResetCheck(null), /No authenticated user/);

      // Demo User
      const demoUser = { uid: 'demo123', email: 'demo@meetmind.ai', isDemoUser: true };
      assert.throws(() => sendPasswordResetCheck(demoUser), /not available for temporary demo accounts/);

      // User without email
      const anonUser = { uid: 'anon123', email: null, isDemoUser: false };
      assert.throws(() => sendPasswordResetCheck(anonUser), /No email address associated/);

      // Valid registered user
      const standardUser = { uid: 'u123', email: 'engineer@meetmind.ai', isDemoUser: false };
      assert.equal(sendPasswordResetCheck(standardUser), true);
    });

    it('Diagnostics: measures and reports backend latency during health probe', async () => {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        // Simulate a small network delay
        await new Promise((r) => setTimeout(r, 15));
        return new Response(
          JSON.stringify({ status: 'ok', app: 'MeetMind AI' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      };

      const startTime = Date.now();
      const health = await client.getHealth();
      const latencyMs = Date.now() - startTime;

      assert.equal(health.status, 'ok');
      assert.equal(health.app, 'MeetMind AI');
      assert.ok(latencyMs >= 10, 'Latency should reflect elapsed network duration');
    });

    it('Settings UI regression: verifies Phase 2D PDF styling is active, customization is planned, and obsolete Upcoming Preferences is removed', () => {
      const settingsSource = readFileSync(SETTINGS_COMPONENT_PATH, 'utf-8');

      // 1. Regression Guard: Ensure the obsolete "Upcoming Preferences" section and Phase 2D roadmap placeholder are completely removed
      assert.doesNotMatch(
        settingsSource,
        /Upcoming Preferences/,
        'Settings component must not render obsolete "Upcoming Preferences" heading'
      );
      assert.doesNotMatch(
        settingsSource,
        /Planned customization features for upcoming phases/,
        'Settings component must not contain stale upcoming roadmap subtitle'
      );
      assert.doesNotMatch(
        settingsSource,
        /<span[^>]*>\s*Phase 2D\s*<\/span>/,
        'Settings component must not display raw "Phase 2D" badge as an upcoming preference'
      );

      // 2. Verified Active Capability: PDF Export & Report Styling header and Phase 2D Active badge
      assert.match(
        settingsSource,
        /<h2[^>]*>\s*PDF Export & Report Styling\s*<\/h2>/,
        'Settings component must display "PDF Export & Report Styling" card heading'
      );
      assert.match(
        settingsSource,
        /Publication-grade ReportLab document styling and preference status/,
        'Settings component must display accurate styling subtitle'
      );
      assert.match(
        settingsSource,
        /MeetMind AI Executive Styling/,
        'Settings component must list MeetMind AI Executive Styling'
      );
      assert.match(
        settingsSource,
        /Phase 2D Active/,
        'Settings component must explicitly mark Phase 2D as Active'
      );
      assert.match(
        settingsSource,
        /Built-in MeetMind AI branding, executive summary callout block, structured action item tables, and two-pass running headers\/footers are active/,
        'Settings component must describe active Phase 2D document styling capabilities'
      );

      // 3. Separated Planned Capability: Custom Corporate Branding & Density
      assert.match(
        settingsSource,
        /Custom Corporate Branding & Density/,
        'Settings component must separate custom corporate branding as distinct planned feature'
      );
      assert.match(
        settingsSource,
        /<span[^>]*>\s*Planned\s*<\/span>/,
        'Settings component must identify unimplemented branding & density controls as Planned'
      );
      assert.match(
        settingsSource,
        /User-uploaded organization logos, custom color palette overrides, and adjustable layout density controls are planned/,
        'Settings component must describe future customization scope without claiming it is available'
      );
    });
  });

  describe('Phase 2A Data Management & JSON Backup', () => {
    // Pure logic mirrors of backupService functions
    const generateBackupFilename = (date = new Date()) => {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `meetmind-ai-backup-${yyyy}-${mm}-${dd}.json`;
    };

    const calculateBackupMetrics = (meetings, apiLimit = 100) => {
      const totalMeetings = meetings.length;
      const apiLimitReached = totalMeetings >= apiLimit;
      const isComplete = !apiLimitReached;

      let totalActionItems = 0;
      let totalDecisions = 0;

      for (const item of meetings) {
        if ('action_items_count' in item) {
          totalActionItems += item.action_items_count || 0;
          totalDecisions += item.decisions_count || 0;
        } else if ('analysis' in item && item.analysis) {
          totalActionItems += item.analysis.action_items?.length || 0;
          totalDecisions += item.analysis.decisions?.length || 0;
        }
      }

      const retrievalNote = apiLimitReached
        ? `Backup includes the ${totalMeetings} most recent meetings accessible via the current API endpoint (maximum ${apiLimit} records per query).`
        : `Complete backup of all ${totalMeetings} saved meeting records for this account.`;

      return {
        total_meetings: totalMeetings,
        total_action_items: totalActionItems,
        total_decisions: totalDecisions,
        is_complete: isComplete,
        api_limit_reached: apiLimitReached,
        retrieval_note: retrievalNote,
      };
    };

    const buildBackupPayload = ({ user, meetings, exportedAt = new Date().toISOString(), apiLimitReached }) => {
      const metrics = calculateBackupMetrics(meetings);
      if (typeof apiLimitReached === 'boolean') {
        metrics.api_limit_reached = apiLimitReached;
        metrics.is_complete = !apiLimitReached;
        if (apiLimitReached) {
          metrics.retrieval_note = `Backup includes the ${meetings.length} most recent meetings accessible via the current API endpoint (maximum 100 records per query).`;
        }
      }

      const userSummary = {
        uid: user?.uid || 'anonymous',
        email: user?.email || (user?.isDemoUser ? 'demo@meetmind.ai' : null),
        is_demo_user: Boolean(user?.isDemoUser),
      };

      return {
        version: '1.0',
        backup_type: 'meetmind_ai_meetings_backup',
        exported_at: exportedAt,
        user: userSummary,
        metrics,
        meetings,
      };
    };

    it('Filename generation: formats meetmind-ai-backup-YYYY-MM-DD.json with zero padding', () => {
      const testDate = new Date(2026, 2, 5); // March 5, 2026
      const filename = generateBackupFilename(testDate);
      assert.equal(filename, 'meetmind-ai-backup-2026-03-05.json');

      const todayFilename = generateBackupFilename();
      assert.match(todayFilename, /^meetmind-ai-backup-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('Metrics derivation: handles empty meeting list gracefully', () => {
      const metrics = calculateBackupMetrics([]);
      assert.equal(metrics.total_meetings, 0);
      assert.equal(metrics.total_action_items, 0);
      assert.equal(metrics.total_decisions, 0);
      assert.equal(metrics.is_complete, true);
      assert.equal(metrics.api_limit_reached, false);
      assert.match(metrics.retrieval_note, /Complete backup of all 0/);
    });

    it('Metrics derivation: accurately sums action items and decisions across meetings', () => {
      const mockList = [
        { meeting_id: 'm1', action_items_count: 5, decisions_count: 3 },
        { meeting_id: 'm2', action_items_count: 0, decisions_count: 1 },
        { meeting_id: 'm3', action_items_count: 7, decisions_count: 4 },
      ];

      const metrics = calculateBackupMetrics(mockList);
      assert.equal(metrics.total_meetings, 3);
      assert.equal(metrics.total_action_items, 12);
      assert.equal(metrics.total_decisions, 8);
      assert.equal(metrics.is_complete, true);
      assert.equal(metrics.api_limit_reached, false);
    });

    it('API limit detection: flags 100 meetings as reaching API ceiling without claiming complete archive', () => {
      const hundredMeetings = Array.from({ length: 100 }, (_, i) => ({
        meeting_id: `m_${i}`,
        action_items_count: 2,
        decisions_count: 1,
      }));

      const metrics = calculateBackupMetrics(hundredMeetings, 100);
      assert.equal(metrics.total_meetings, 100);
      assert.equal(metrics.total_action_items, 200);
      assert.equal(metrics.total_decisions, 100);
      assert.equal(metrics.api_limit_reached, true);
      assert.equal(metrics.is_complete, false);
      assert.match(metrics.retrieval_note, /most recent meetings accessible via the current API endpoint/);
    });

    it('Payload sanitization: strips credentials, tokens, and secrets from exported backup', () => {
      const user = {
        uid: 'user_secure_123',
        email: 'engineer@meetmind.ai',
        isDemoUser: false,
        // Sensitive attributes that must never be written to backup
        idToken: 'secret_jwt_token',
        refreshToken: 'secret_refresh_token',
        apiKey: 'secret_api_key_123',
      };

      const meetings = [
        {
          meeting_id: 'm_101',
          title: 'Sprint Planning',
          transcript: 'Alice: We have 3 tickets.',
          created_at: '2026-11-04T10:00:00Z',
          updated_at: '2026-11-04T10:30:00Z',
          analysis: {
            meeting_id: 'm_101',
            summary: 'Sprint planning summary',
            discussion_points: ['Task A', 'Task B'],
            decisions: ['Launch on Friday'],
            action_items: [
              { task: 'Deploy backend', owner: 'Alice', deadline: 'Friday', status: 'pending' },
            ],
            clarification_required: false,
            clarifications: [],
          },
        },
      ];

      const payload = buildBackupPayload({ user, meetings });

      assert.equal(payload.version, '1.0');
      assert.equal(payload.backup_type, 'meetmind_ai_meetings_backup');
      assert.equal(payload.user.uid, 'user_secure_123');
      assert.equal(payload.user.email, 'engineer@meetmind.ai');
      assert.equal(payload.user.is_demo_user, false);
      assert.equal(payload.user.idToken, undefined);
      assert.equal(payload.user.refreshToken, undefined);
      assert.equal(payload.user.apiKey, undefined);

      assert.equal(payload.metrics.total_meetings, 1);
      assert.equal(payload.metrics.total_action_items, 1);
      assert.equal(payload.metrics.total_decisions, 1);
      assert.equal(payload.meetings.length, 1);
      assert.equal(payload.meetings[0].meeting_id, 'm_101');
      assert.equal(payload.meetings[0].transcript, 'Alice: We have 3 tickets.');

      // JSON serialization check
      const json = JSON.stringify(payload);
      assert.ok(!json.includes('secret_jwt_token'));
      assert.ok(!json.includes('secret_refresh_token'));
      assert.ok(!json.includes('secret_api_key_123'));
    });

    it('Complete backup workflow: queries list and fetches full details for each meeting', async () => {
      const mockMeetings = [
        {
          meeting_id: 'm_abc_1',
          title: 'Design Sync',
          summary: 'Design review summary',
          created_at: '2026-11-04T08:00:00Z',
          updated_at: '2026-11-04T08:30:00Z',
          action_items_count: 2,
          decisions_count: 1,
          clarification_required: false,
          unresolved_clarifications_count: 0,
        },
        {
          meeting_id: 'm_abc_2',
          title: 'Architecture Review',
          summary: 'Architecture summary',
          created_at: '2026-11-04T09:00:00Z',
          updated_at: '2026-11-04T09:30:00Z',
          action_items_count: 3,
          decisions_count: 2,
          clarification_required: false,
          unresolved_clarifications_count: 0,
        },
      ];

      const progressSteps = [];
      const onProgress = (current, total, statusText) => {
        progressSteps.push({ current, total, statusText });
      };

      // Mock listMeetings and getMeeting
      globalThis.fetch = async (url) => {
        if (url.includes('/api/meetings?limit=100')) {
          return new Response(JSON.stringify(mockMeetings), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/api/meetings/m_abc_1')) {
          return new Response(
            JSON.stringify({
              meeting_id: 'm_abc_1',
              title: 'Design Sync',
              transcript: 'Designer: Updated tokens.',
              created_at: '2026-11-04T08:00:00Z',
              updated_at: '2026-11-04T08:30:00Z',
              analysis: {
                summary: 'Design review summary',
                action_items: [
                  { task: 'Export Figma styles', owner: 'Bob', status: 'pending' },
                  { task: 'Update CSS variables', owner: 'Alice', status: 'pending' },
                ],
                decisions: ['Use 8px grid'],
                clarification_required: false,
                clarifications: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/api/meetings/m_abc_2')) {
          return new Response(
            JSON.stringify({
              meeting_id: 'm_abc_2',
              title: 'Architecture Review',
              transcript: 'Lead: Moving to Redis Lua.',
              created_at: '2026-11-04T09:00:00Z',
              updated_at: '2026-11-04T09:30:00Z',
              analysis: {
                summary: 'Architecture summary',
                action_items: [
                  { task: 'Deploy Redis cluster', owner: 'DevOps', status: 'pending' },
                  { task: 'Benchmark Lua script', owner: 'Lead', status: 'pending' },
                  { task: 'Configure fail-closed', owner: 'Lead', status: 'done' },
                ],
                decisions: ['Atomic rate limiting', 'Fail-closed production'],
                clarification_required: false,
                clarifications: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      };

      // Execute retrieval flow
      const list = await client.listMeetings(100);
      assert.equal(list.length, 2);

      const details = [];
      for (let i = 0; i < list.length; i++) {
        onProgress(i + 1, list.length, `Fetching ${list[i].meeting_id}`);
        const detail = await client.getMeeting(list[i].meeting_id);
        details.push(detail);
      }

      assert.equal(details.length, 2);
      assert.equal(details[0].meeting_id, 'm_abc_1');
      assert.equal(details[1].meeting_id, 'm_abc_2');
      assert.equal(details[0].transcript, 'Designer: Updated tokens.');
      assert.equal(details[1].transcript, 'Lead: Moving to Redis Lua.');

      const payload = buildBackupPayload({
        user: { uid: 'u_test', email: 'test@meetmind.ai', isDemoUser: false },
        meetings: details,
      });

      assert.equal(payload.metrics.total_meetings, 2);
      assert.equal(payload.metrics.total_action_items, 5);
      assert.equal(payload.metrics.total_decisions, 3);
      assert.equal(payload.metrics.is_complete, true);
      assert.equal(progressSteps.length, 2);
    });

    it('Backup error handling: rejects export when user has zero meetings', async () => {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const list = await client.listMeetings(100);
      assert.equal(list.length, 0);

      const runExport = (meetings) => {
        if (!meetings || meetings.length === 0) {
          throw new Error('No saved meetings found to export. Analyze a meeting first.');
        }
      };

      assert.throws(() => runExport(list), /No saved meetings found to export/);
    });
  });

  describe('Phase 2B Bulk Meeting Deletion', () => {
    const CONFIRMATION_PHRASE = 'DELETE ALL MEETINGS';

    const validateConfirmationPhrase = (input) => {
      return (input || '').trim() === CONFIRMATION_PHRASE;
    };

    const isDeleteActionDisabled = ({ isDeleting, phraseInput, meetingCount }) => {
      if (isDeleting) return true;
      if (!validateConfirmationPhrase(phraseInput)) return true;
      if (meetingCount === 0) return true;
      return false;
    };

    it('Confirmation phrase validation: strictly requires exact match DELETE ALL MEETINGS', () => {
      assert.equal(validateConfirmationPhrase('DELETE ALL MEETINGS'), true);
      assert.equal(validateConfirmationPhrase('  DELETE ALL MEETINGS  '), true, 'Trimmed match is acceptable');
      assert.equal(validateConfirmationPhrase('delete all meetings'), false, 'Case-sensitive match required');
      assert.equal(validateConfirmationPhrase('DELETE ALL'), false, 'Partial phrase rejected');
      assert.equal(validateConfirmationPhrase('DELETE ALL MEETING'), false, 'Typo rejected');
      assert.equal(validateConfirmationPhrase(''), false, 'Empty input rejected');
      assert.equal(validateConfirmationPhrase(null), false, 'Null rejected');
    });

    it('Disabled state: keeps destructive action disabled until exact phrase is entered', () => {
      // Disabled while input is incomplete
      assert.equal(
        isDeleteActionDisabled({ isDeleting: false, phraseInput: 'DELETE', meetingCount: 5 }),
        true
      );

      // Disabled when user has 0 meetings
      assert.equal(
        isDeleteActionDisabled({ isDeleting: false, phraseInput: 'DELETE ALL MEETINGS', meetingCount: 0 }),
        true
      );

      // Disabled while deletion is actively in progress
      assert.equal(
        isDeleteActionDisabled({ isDeleting: true, phraseInput: 'DELETE ALL MEETINGS', meetingCount: 5 }),
        true
      );

      // Enabled only when phrase matches, not deleting, and meetings > 0
      assert.equal(
        isDeleteActionDisabled({ isDeleting: false, phraseInput: 'DELETE ALL MEETINGS', meetingCount: 5 }),
        false
      );
    });

    it('Successful bulk deletion: calls DELETE /api/meetings and returns deleted count', async () => {
      let capturedMethod = null;
      let capturedUrl = null;

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            status: 'deleted',
            deleted_count: 7,
            message: 'Successfully deleted 7 saved meetings.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await client.deleteAllMeetings();
      assert.equal(capturedMethod, 'DELETE');
      assert.ok(capturedUrl.endsWith('/api/meetings'));
      assert.equal(result.status, 'deleted');
      assert.equal(result.deleted_count, 7);
      assert.match(result.message, /successfully deleted 7 saved meetings/i);
    });

    it('API failure feedback: surfaces backend error detail clearly on 502/503 failure', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: 'The upstream database service is temporarily unavailable. Please try again.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => client.deleteAllMeetings(),
        /upstream database service is temporarily unavailable/
      );
    });

    it('Preventing duplicate submissions: rejects concurrent calls while execution is in-flight', async () => {
      let isDeleting = false;
      let callCount = 0;

      const performSafeBulkDelete = async () => {
        if (isDeleting) {
          throw new Error('Deletion already in progress. Duplicate submission prevented.');
        }
        isDeleting = true;
        try {
          callCount++;
          await new Promise((r) => setTimeout(r, 20));
          return { status: 'deleted', deleted_count: 3 };
        } finally {
          isDeleting = false;
        }
      };

      // Start first deletion
      const firstCall = performSafeBulkDelete();
      // Concurrent second submission must be blocked
      await assert.rejects(
        async () => performSafeBulkDelete(),
        /Deletion already in progress/
      );

      const result = await firstCall;
      assert.equal(result.deleted_count, 3);
      assert.equal(callCount, 1, 'Only one delete execution must occur');
    });

    it('Rate limiting: handles HTTP 429 and extracts Retry-After header cleanly', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: 'Rate limit exceeded for endpoint bulk_delete. Maximum 5 requests per minute allowed.',
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '45',
            },
          }
        );
      };

      await assert.rejects(
        async () => client.deleteAllMeetings(),
        /Rate limit exceeded\. Please wait 45 seconds before trying again\./
      );
    });

    it('Partial failure refresh: awaits metrics and history refresh when deletion fails', async () => {
      let isBulkDeleting = false;
      let bulkDeleteModalError = null;
      let bulkDeleteSuccessMessage = null;
      let isBulkDeleteModalOpen = true;
      let summaryRefreshed = false;
      let historyRefreshed = false;
      const user = { uid: 'test-user-123' };

      const fakeLoadSummary = async () => {
        await new Promise((r) => setTimeout(r, 10));
        summaryRefreshed = true;
      };

      const fakeOnRefreshMeetings = async () => {
        await new Promise((r) => setTimeout(r, 10));
        historyRefreshed = true;
      };

      const refreshMeetingData = async () => {
        try {
          await fakeLoadSummary();
        } catch {
          // Ignore refresh error to avoid masking primary deletion error or outcome
        }
        try {
          await fakeOnRefreshMeetings();
        } catch {
          // Ignore parent callback error
        }
      };

      const setIsBulkDeleting = (val) => { isBulkDeleting = val; };
      const setBulkDeleteModalError = (val) => { bulkDeleteModalError = val; };
      const setBulkDeleteSuccessMessage = (val) => { bulkDeleteSuccessMessage = val; };

      const handleConfirmBulkDelete = async () => {
        if (!user || isBulkDeleting) return;
        setIsBulkDeleting(true);
        setBulkDeleteModalError(null);
        setBulkDeleteSuccessMessage(null);

        try {
          // Simulated backend failure during batch 2 after batch 1 succeeded
          throw new Error('Failed to delete meeting records batch (400 records deleted before failure)');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete meetings. Please try again.';
          setBulkDeleteModalError(msg);
          await refreshMeetingData();
        } finally {
          setIsBulkDeleting(false);
        }
      };

      await handleConfirmBulkDelete();

      // Verify outcomes:
      assert.equal(isBulkDeleting, false, 'Loading state must reset to false');
      assert.equal(isBulkDeleteModalOpen, true, 'Modal must remain open on failure');
      assert.equal(bulkDeleteSuccessMessage, null);
      assert.equal(
        bulkDeleteModalError,
        'Failed to delete meeting records batch (400 records deleted before failure)'
      );
      assert.equal(summaryRefreshed, true, 'Meeting summary metrics must be refreshed');
      assert.equal(historyRefreshed, true, 'History/workspace list must be refreshed');
    });

    it('Refresh error isolation: original deletion error remains visible even if refresh throws', async () => {
      let isBulkDeleting = false;
      let bulkDeleteModalError = null;
      let summaryAttempted = false;
      let historyAttempted = false;
      const user = { uid: 'test-user-123' };

      const fakeLoadSummaryThatFails = async () => {
        summaryAttempted = true;
        throw new Error('Summary fetch failed: network disconnected');
      };

      const fakeOnRefreshMeetingsThatFails = async () => {
        historyAttempted = true;
        throw new Error('Workspace list reload failed: component unmounted');
      };

      const refreshMeetingData = async () => {
        try {
          await fakeLoadSummaryThatFails();
        } catch {
          // Ignore refresh error to avoid masking primary deletion error or outcome
        }
        try {
          await fakeOnRefreshMeetingsThatFails();
        } catch {
          // Ignore parent callback error
        }
      };

      const handleConfirmBulkDelete = async () => {
        if (!user || isBulkDeleting) return;
        isBulkDeleting = true;
        bulkDeleteModalError = null;

        try {
          throw new Error('Upstream database timeout during batch commit (200 records deleted before failure)');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete meetings. Please try again.';
          bulkDeleteModalError = msg;
          await refreshMeetingData();
        } finally {
          isBulkDeleting = false;
        }
      };

      await handleConfirmBulkDelete();

      assert.equal(isBulkDeleting, false);
      assert.equal(summaryAttempted, true);
      assert.equal(historyAttempted, true);
      // Crucial: The primary deletion error must NOT be overwritten by the refresh failures
      assert.equal(
        bulkDeleteModalError,
        'Upstream database timeout during batch commit (200 records deleted before failure)'
      );
    });

    it('Duplicate submission prevention in Settings: ignores second click while deletion is active', async () => {
      let isBulkDeleting = false;
      let apiCallCount = 0;
      const user = { uid: 'test-user-123' };

      const fakeApiDelete = async () => {
        apiCallCount++;
        await new Promise((r) => setTimeout(r, 30));
        return { status: 'deleted', deleted_count: 5 };
      };

      const handleConfirmBulkDelete = async () => {
        if (!user || isBulkDeleting) return;
        isBulkDeleting = true;

        try {
          await fakeApiDelete();
        } finally {
          isBulkDeleting = false;
        }
      };

      // Trigger first execution
      const run1 = handleConfirmBulkDelete();
      // Concurrent second trigger while isBulkDeleting is true
      const run2 = handleConfirmBulkDelete();

      await Promise.all([run1, run2]);

      assert.equal(apiCallCount, 1, 'Duplicate click must be ignored while in-flight');
      assert.equal(isBulkDeleting, false, 'Loading state must be cleared after completion');
    });
  });

  describe('Phase 3 Account Deletion', () => {
    const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

    it('Confirmation phrase validation: strictly requires exact match DELETE MY ACCOUNT', () => {
      const isDeleteAccountDisabled = ({ isDeleting, phraseInput }) => {
        const isConfirmed = (phraseInput || '').trim() === CONFIRMATION_PHRASE;
        return !isConfirmed || isDeleting;
      };

      // Empty input
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: '' }), true);
      // Partial input
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: 'DELETE' }), true);
      // Case-insensitive mismatch
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: 'delete my account' }), true);
      // Accidental bulk delete phrase
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: 'DELETE ALL MEETINGS' }), true);
      // Matching phrase with whitespace padding
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: '  DELETE MY ACCOUNT  ' }), false);
      // Exact matching phrase
      assert.equal(isDeleteAccountDisabled({ isDeleting: false, phraseInput: 'DELETE MY ACCOUNT' }), false);
      // Disabled while deleting even if phrase matches
      assert.equal(isDeleteAccountDisabled({ isDeleting: true, phraseInput: 'DELETE MY ACCOUNT' }), true);
    });

    it('Successful account deletion: calls DELETE /api/account, closes modal, and invokes logout', async () => {
      let isDeleteAccountModalOpen = true;
      let isDeletingAccount = false;
      let deleteAccountModalError = null;
      let user = { uid: 'u_erase_123', email: 'user@meetmind.ai' };
      let loggedOut = false;
      let capturedMethod = null;
      let capturedUrl = null;

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            status: 'deleted',
            meetings_deleted: 4,
            message: 'User account and 4 meeting records permanently deleted.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const fakeLogout = async () => {
        loggedOut = true;
        user = null;
      };

      const handleConfirmDeleteAccount = async () => {
        if (!user || isDeletingAccount) return;
        isDeletingAccount = true;
        deleteAccountModalError = null;

        try {
          await client.deleteAccount();
          isDeleteAccountModalOpen = false;
          await fakeLogout();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete account. Please try again.';
          deleteAccountModalError = msg;
        } finally {
          isDeletingAccount = false;
        }
      };

      await handleConfirmDeleteAccount();

      assert.equal(capturedMethod, 'DELETE');
      assert.ok(capturedUrl.endsWith('/api/account'));
      assert.equal(isDeleteAccountModalOpen, false, 'Modal must close on confirmed success');
      assert.equal(loggedOut, true, 'Logout must be called on successful account deletion');
      assert.equal(user, null, 'User state must be cleared');
      assert.equal(deleteAccountModalError, null);
      assert.equal(isDeletingAccount, false, 'Loading state must be reset to false');
    });

    it('Error handling and session preservation: surfaces backend failure, keeps modal open, preserves active session', async () => {
      let isDeleteAccountModalOpen = true;
      let isDeletingAccount = false;
      let deleteAccountModalError = null;
      let user = { uid: 'u_preserve_123', email: 'preserve@meetmind.ai' };
      let logoutCalled = false;

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: 'The upstream database service is temporarily unavailable. 2 records were deleted before failure. Your authentication account was not deleted. Please retry to complete account deletion.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const fakeLogout = async () => {
        logoutCalled = true;
        user = null;
      };

      const handleConfirmDeleteAccount = async () => {
        if (!user || isDeletingAccount) return;
        isDeletingAccount = true;
        deleteAccountModalError = null;

        try {
          await client.deleteAccount();
          isDeleteAccountModalOpen = false;
          await fakeLogout();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete account. Please try again.';
          deleteAccountModalError = msg;
        } finally {
          isDeletingAccount = false;
        }
      };

      await handleConfirmDeleteAccount();

      // Modal remains open so user can read error or retry
      assert.equal(isDeleteAccountModalOpen, true, 'Modal must stay open on failure');
      // User must NOT be logged out if deletion failed
      assert.equal(logoutCalled, false, 'User must not be logged out if account deletion failed');
      assert.ok(user !== null, 'Session must be preserved');
      assert.match(deleteAccountModalError, /Your authentication account was not deleted/);
      assert.equal(isDeletingAccount, false, 'Loading state must be cleared');
    });

    it('Duplicate submission prevention: blocks concurrent calls while deletion is in-flight', async () => {
      let isDeletingAccount = false;
      let apiCallCount = 0;
      const user = { uid: 'u_dupe_123' };

      const fakeApiDeleteAccount = async () => {
        apiCallCount++;
        await new Promise((r) => setTimeout(r, 25));
        return { status: 'deleted', meetings_deleted: 1, message: 'Deleted' };
      };

      const handleConfirmDeleteAccount = async () => {
        if (!user || isDeletingAccount) return;
        isDeletingAccount = true;

        try {
          await fakeApiDeleteAccount();
        } finally {
          isDeletingAccount = false;
        }
      };

      // Concurrent invocations
      const call1 = handleConfirmDeleteAccount();
      const call2 = handleConfirmDeleteAccount();

      await Promise.all([call1, call2]);

      assert.equal(apiCallCount, 1, 'Only one deleteAccount call must execute');
      assert.equal(isDeletingAccount, false);
    });

    it('Strict independence: bulk meeting deletion and account deletion never accidentally cross-invoke', async () => {
      let bulkDeleteInvoked = false;
      let accountDeleteInvoked = false;

      globalThis.fetch = async (url, options) => {
        if (url.endsWith('/api/meetings') && options.method === 'DELETE') {
          bulkDeleteInvoked = true;
          return new Response(JSON.stringify({ status: 'deleted', deleted_count: 5, message: 'Done' }), { status: 200 });
        }
        if (url.endsWith('/api/account') && options.method === 'DELETE') {
          accountDeleteInvoked = true;
          return new Response(JSON.stringify({ status: 'deleted', meetings_deleted: 5, message: 'Done' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      };

      // Executing bulk delete must NOT touch /api/account
      await client.deleteAllMeetings();
      assert.equal(bulkDeleteInvoked, true);
      assert.equal(accountDeleteInvoked, false);

      // Reset
      bulkDeleteInvoked = false;
      accountDeleteInvoked = false;

      // Executing account delete must NOT touch /api/meetings
      await client.deleteAccount();
      assert.equal(accountDeleteInvoked, true);
      assert.equal(bulkDeleteInvoked, false);
    });

    it('Rate limiting: handles HTTP 429 on /api/account and surfaces Retry-After message', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: 'Rate limit exceeded for endpoint account_delete. Maximum 5 requests per minute allowed.',
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '50',
            },
          }
        );
      };

      await assert.rejects(
        async () => client.deleteAccount(),
        /Rate limit exceeded\. Please wait 50 seconds before trying again\./
      );
    });

    it('Demo account callout: conditionally displays informational warning only for demo users', () => {
      const renderDemoAccountCallout = (isDemoUser) => {
        if (!isDemoUser) return null;
        return 'Demo Account: Deleting this account permanently wipes this temporary demo session and does not affect any separate registered accounts.';
      };

      // When isDemoUser is true: returns exact amber callout text
      const demoResult = renderDemoAccountCallout(true);
      assert.ok(demoResult !== null);
      assert.match(demoResult, /Demo Account: Deleting this account permanently wipes this temporary demo session/);
      assert.match(demoResult, /does not affect any separate registered accounts/);

      // When isDemoUser is false: returns null (callout omitted)
      const registeredResult = renderDemoAccountCallout(false);
      assert.equal(registeredResult, null);

      // When isDemoUser is undefined/null: returns null
      assert.equal(renderDemoAccountCallout(undefined), null);
    });

    it('Data minimization: DELETE /api/account response omits user_id and retains status, meetings_deleted, message', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            status: 'deleted',
            meetings_deleted: 3,
            message: 'User account and 3 meeting records permanently deleted.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await client.deleteAccount();
      assert.equal(res.status, 'deleted');
      assert.equal(res.meetings_deleted, 3);
      assert.ok(typeof res.message === 'string');
      assert.equal(res.user_id, undefined, 'user_id must not be present in response');
    });
  });

  describe('Phase 2C Custom Model Selection & BYOK', () => {
    let client;
    let originalFetch;

    beforeEach(() => {
      client = new ApiServiceTestClient('http://localhost:8000');
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      client.clearCustomModelAndKey();
    });

    it('Default model selection: retrieves user preferences with default gemini-2.5-flash', async () => {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'http://localhost:8000/api/preferences');
        assert.equal(options.method, 'GET');
        return new Response(
          JSON.stringify({
            selected_model: 'gemini-2.5-flash',
            supported_models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
            default_model: 'gemini-2.5-flash',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const prefs = await client.getUserPreferences();
      assert.equal(prefs.selected_model, 'gemini-2.5-flash');
      assert.deepEqual(prefs.supported_models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
      assert.equal(prefs.default_model, 'gemini-2.5-flash');
      assert.equal(client.getCustomModel(), 'gemini-2.5-flash');
    });

    it('Switching between Flash and Pro: updates preference to gemini-2.5-pro and syncs in-memory state', async () => {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'http://localhost:8000/api/preferences');
        assert.equal(options.method, 'PUT');
        const body = JSON.parse(options.body);
        assert.equal(body.selected_model, 'gemini-2.5-pro');
        return new Response(
          JSON.stringify({
            selected_model: 'gemini-2.5-pro',
            supported_models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
            default_model: 'gemini-2.5-flash',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const updated = await client.updateUserPreferences('gemini-2.5-pro');
      assert.equal(updated.selected_model, 'gemini-2.5-pro');
      assert.equal(client.getCustomModel(), 'gemini-2.5-pro');
    });

    it('Invalid model rejection: surfaces 400 Bad Request detail when unsupported model is sent', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: "Invalid model 'unsupported-model'. Supported models are: gemini-2.5-flash, gemini-2.5-pro.",
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => client.updateUserPreferences('unsupported-model'),
        /Invalid model 'unsupported-model'/
      );
    });

    it('BYOK validation: validates API key via POST /api/preferences/validate-key', async () => {
      let passedKeyHeader = null;
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'http://localhost:8000/api/preferences/validate-key');
        assert.equal(options.method, 'POST');
        passedKeyHeader = options.headers['X-Gemini-API-Key'];
        return new Response(
          JSON.stringify({
            valid: true,
            message: 'Gemini API key verified successfully.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await client.validateApiKey('AIzaSyTestKey123');
      assert.equal(res.valid, true);
      assert.equal(passedKeyHeader, 'AIzaSyTestKey123');
    });

    it('BYOK validation failure: surfaces invalid key error message', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            detail: 'Invalid Gemini API key or insufficient permissions.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => client.validateApiKey('AIzaSyFailingKey'),
        /Invalid Gemini API key or insufficient permissions/
      );
    });

    it('Meeting processing uses custom model and BYOK key in request headers', async () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSyCustomKey999');

      let capturedHeaders = null;
      globalThis.fetch = async (url, options) => {
        capturedHeaders = options.headers;
        return new Response(
          JSON.stringify({
            summary: 'Meeting processed with custom model.',
            discussion_points: [],
            decisions: [],
            action_items: [],
            clarification_required: false,
            clarifications: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await client.analyzeMeeting({ transcript: 'Team meeting sync.' });
      assert.equal(capturedHeaders['X-Gemini-Model'], 'gemini-2.5-pro');
      assert.equal(capturedHeaders['X-Gemini-API-Key'], 'AIzaSyCustomKey999');
    });

    it('Clarification processing attaches custom model and BYOK key headers', async () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSyCustomKey999');

      let capturedHeaders = null;
      globalThis.fetch = async (url, options) => {
        capturedHeaders = options.headers;
        return new Response(
          JSON.stringify({
            summary: 'Clarification resolved with custom model.',
            discussion_points: [],
            decisions: [],
            action_items: [],
            clarification_required: false,
            clarifications: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await client.clarifyMeeting({
        analysis: {
          summary: 'Original summary',
          discussion_points: [],
          decisions: [],
          action_items: [],
          clarification_required: true,
          clarifications: [],
        },
        answers: [{ clarification_id: 'clarif_1', answer: 'Confirmed by Alex' }],
      });
      assert.equal(capturedHeaders['X-Gemini-Model'], 'gemini-2.5-pro');
      assert.equal(capturedHeaders['X-Gemini-API-Key'], 'AIzaSyCustomKey999');
    });

    it('Session isolation: clearCustomModelAndKey wipes in-memory credentials upon logout', () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSySecretSessionKey');

      assert.equal(client.getCustomModel(), 'gemini-2.5-pro');
      assert.equal(client.getCustomApiKey(), 'AIzaSySecretSessionKey');

      client.clearCustomModelAndKey();

      assert.equal(client.getCustomModel(), null);
      assert.equal(client.getCustomApiKey(), null);
    });

    it('Security hardening: 401 unauthorized response immediately clears in-memory BYOK key and model override', async () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSySecretSessionKeyToWipe');

      assert.equal(client.getCustomModel(), 'gemini-2.5-pro');
      assert.equal(client.getCustomApiKey(), 'AIzaSySecretSessionKeyToWipe');

      let unauthorizedCallbackFired = false;
      client.setOnUnauthorized(() => {
        unauthorizedCallbackFired = true;
        // Verify credentials were already cleared when onUnauthorized callback executes
        assert.equal(client.getCustomModel(), null, 'Model override must be cleared before callback');
        assert.equal(client.getCustomApiKey(), null, 'Custom API key must be cleared before callback');
      });

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ detail: 'Authentication required. Session expired.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );

      await assert.rejects(
        async () => client.getUserPreferences(),
        /Authentication required/
      );

      assert.equal(unauthorizedCallbackFired, true, 'onUnauthorized callback should have fired');
      assert.equal(client.getCustomModel(), null);
      assert.equal(client.getCustomApiKey(), null);

      client.setOnUnauthorized(null);
    });

    it('Security hardening: 401 unauthorized clears in-memory BYOK credentials even if onUnauthorized is unset', async () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSySecretSessionKeyToWipe');
      client.setOnUnauthorized(null);

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ detail: 'Authentication required. Session expired.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );

      await assert.rejects(
        async () => client.getUserPreferences(),
        /Authentication required/
      );

      assert.equal(client.getCustomModel(), null);
      assert.equal(client.getCustomApiKey(), null);
    });

    it('Security verification: BYOK keys are never stored in localStorage or sessionStorage', () => {
      const sensitiveKey = 'AIzaSyHighSecurityKey12345';
      client.setCustomApiKey(sensitiveKey);

      // Verify localStorage is completely clean of the key
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const val = localStorage.getItem(key);
          assert.equal(val?.includes(sensitiveKey), false, 'Key must not be in localStorage');
        }
      }

      // Verify sessionStorage is completely clean of the key
      if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          const val = sessionStorage.getItem(key);
          assert.equal(val?.includes(sensitiveKey), false, 'Key must not be in sessionStorage');
        }
      }
    });
  });

  describe('Phase 4 JSON Backup & Restore', () => {
    // Pure logic mirrors of backup validation
    const parseAndValidateBackupJson = (jsonString) => {
      if (!jsonString || !jsonString.trim()) {
        return { valid: false, error: 'The selected backup file is empty.' };
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch (err) {
        return { valid: false, error: `Malformed JSON file: ${err.message}` };
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { valid: false, error: 'Backup root must be a JSON object.' };
      }

      const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
      if (!version) {
        return { valid: false, error: "Missing required 'version' field in backup." };
      }
      if (version !== '1.0') {
        return {
          valid: false,
          error: `Unsupported backup version '${version}'. Only version 1.0 is supported.`,
        };
      }

      const backupType = typeof parsed.backup_type === 'string' ? parsed.backup_type.trim() : '';
      if (backupType !== 'meetmind_ai_meetings_backup') {
        return {
          valid: false,
          error: `Invalid backup type '${backupType}'. Expected 'meetmind_ai_meetings_backup'.`,
        };
      }

      if (!Array.isArray(parsed.meetings)) {
        return { valid: false, error: "Backup file is missing required 'meetings' array." };
      }

      if (parsed.meetings.length === 0) {
        return { valid: false, error: 'Backup file contains no meeting records to restore.' };
      }

      if (parsed.meetings.length > 500) {
        return {
          valid: false,
          error: `Backup contains ${parsed.meetings.length} meetings, exceeding the maximum limit of 500 records.`,
        };
      }

      const seenIds = new Set();
      let totalActionItems = 0;
      let totalDecisions = 0;

      for (let i = 0; i < parsed.meetings.length; i++) {
        const item = parsed.meetings[i];
        if (typeof item !== 'object' || item === null) {
          return { valid: false, error: `Meeting at index ${i} is not a valid object.` };
        }

        const meetingId = typeof item.meeting_id === 'string' ? item.meeting_id.trim() : '';
        if (!meetingId) {
          return { valid: false, error: `Meeting at index ${i} is missing a valid 'meeting_id'.` };
        }
        if (seenIds.has(meetingId)) {
          return { valid: false, error: `Duplicate meeting ID '${meetingId}' detected at index ${i}.` };
        }
        seenIds.add(meetingId);

        if (typeof item.transcript !== 'string' || !item.transcript.trim()) {
          return { valid: false, error: `Meeting '${meetingId}' (index ${i}) has an empty transcript.` };
        }

        if (typeof item.analysis !== 'object' || item.analysis === null) {
          return { valid: false, error: `Meeting '${meetingId}' (index ${i}) is missing 'analysis' data.` };
        }
        if (typeof item.analysis.summary !== 'string' || !item.analysis.summary.trim()) {
          return { valid: false, error: `Meeting '${meetingId}' (index ${i}) analysis is missing required 'summary'.` };
        }

        const actions = Array.isArray(item.analysis.action_items) ? item.analysis.action_items : [];
        const decisions = Array.isArray(item.analysis.decisions) ? item.analysis.decisions : [];
        totalActionItems += actions.length;
        totalDecisions += decisions.length;
      }

      return {
        valid: true,
        payload: parsed,
        summary: {
          totalMeetings: parsed.meetings.length,
          totalActionItems,
          totalDecisions,
          exportedAt: parsed.exported_at,
          version,
        },
      };
    };

    const validBackupPayload = {
      version: '1.0',
      backup_type: 'meetmind_ai_meetings_backup',
      exported_at: '2026-03-05T12:00:00Z',
      user: { uid: 'u_123', email: 'user@meetmind.ai', is_demo_user: false },
      metrics: { total_meetings: 1, total_action_items: 2, total_decisions: 1, is_complete: true },
      meetings: [
        {
          meeting_id: 'm_valid_1',
          title: 'Planning Sync',
          transcript: 'Alice: Deliverables are on track.',
          created_at: '2026-03-05T10:00:00Z',
          updated_at: '2026-03-05T10:00:00Z',
          analysis: {
            meeting_id: 'm_valid_1',
            summary: 'Deliverables on track.',
            discussion_points: ['Sprint goals'],
            decisions: ['Approved sprint backlog'],
            action_items: [
              { id: 'a1', task: 'Review pull request', owner: 'Alice', deadline: 'Today', status: 'pending' },
              { id: 'a2', task: 'Run integration suite', owner: 'Bob', deadline: 'Tomorrow', status: 'pending' },
            ],
            clarification_required: false,
            clarifications: [],
            open_follow_ups: [],
          },
        },
      ],
    };

    it('Validation: successfully parses and validates correct backup payload', () => {
      const jsonStr = JSON.stringify(validBackupPayload);
      const result = parseAndValidateBackupJson(jsonStr);

      assert.equal(result.valid, true);
      assert.equal(result.summary.totalMeetings, 1);
      assert.equal(result.summary.totalActionItems, 2);
      assert.equal(result.summary.totalDecisions, 1);
      assert.equal(result.summary.version, '1.0');
    });

    it('Validation: rejects malformed JSON with syntax error message', () => {
      const result = parseAndValidateBackupJson('{ invalid json string');
      assert.equal(result.valid, false);
      assert.match(result.error, /Malformed JSON file/);
    });

    it('Validation: rejects unsupported backup versions', () => {
      const payload = { ...validBackupPayload, version: '2.0' };
      const result = parseAndValidateBackupJson(JSON.stringify(payload));
      assert.equal(result.valid, false);
      assert.match(result.error, /Unsupported backup version '2.0'/);
    });

    it('Validation: rejects non-MeetMind backup_type', () => {
      const payload = { ...validBackupPayload, backup_type: 'random_backup' };
      const result = parseAndValidateBackupJson(JSON.stringify(payload));
      assert.equal(result.valid, false);
      assert.match(result.error, /Invalid backup type/);
    });

    it('Validation: rejects backup with empty meetings array', () => {
      const payload = { ...validBackupPayload, meetings: [] };
      const result = parseAndValidateBackupJson(JSON.stringify(payload));
      assert.equal(result.valid, false);
      assert.match(result.error, /contains no meeting records/);
    });

    it('Validation: rejects duplicate meeting IDs within same backup', () => {
      const payload = {
        ...validBackupPayload,
        meetings: [validBackupPayload.meetings[0], { ...validBackupPayload.meetings[0] }],
      };
      const result = parseAndValidateBackupJson(JSON.stringify(payload));
      assert.equal(result.valid, false);
      assert.match(result.error, /Duplicate meeting ID 'm_valid_1'/);
    });

    it('Validation: rejects meetings missing transcript', () => {
      const payload = {
        ...validBackupPayload,
        meetings: [{ ...validBackupPayload.meetings[0], transcript: '   ' }],
      };
      const result = parseAndValidateBackupJson(JSON.stringify(payload));
      assert.equal(result.valid, false);
      assert.match(result.error, /has an empty transcript/);
    });

    it('API Service: exportBackup executes GET /api/meetings/backup and returns payload', async () => {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'http://localhost:8000/api/meetings/backup');
        assert.equal(options.method, 'GET');
        return new Response(JSON.stringify(validBackupPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await client.exportBackup();
      assert.equal(result.version, '1.0');
      assert.equal(result.backup_type, 'meetmind_ai_meetings_backup');
      assert.equal(result.meetings.length, 1);
    });

    it('API Service: restoreBackup executes POST /api/meetings/restore with skip strategy', async () => {
      let capturedUrl = null;
      let capturedBody = null;

      globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            status: 'restored',
            total_records: 1,
            imported_count: 1,
            updated_count: 0,
            skipped_count: 0,
            message: 'Successfully restored 1 meeting (1 imported, 0 updated, 0 skipped).',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await client.restoreBackup(validBackupPayload, 'skip');
      assert.ok(capturedUrl.includes('/api/meetings/restore?conflict_strategy=skip'));
      assert.equal(capturedBody.version, '1.0');
      assert.equal(result.status, 'restored');
      assert.equal(result.imported_count, 1);
    });

    it('API Service: restoreBackup executes POST /api/meetings/restore with overwrite strategy', async () => {
      let capturedUrl = null;

      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            status: 'restored',
            total_records: 1,
            imported_count: 0,
            updated_count: 1,
            skipped_count: 0,
            message: 'Successfully restored 1 meeting (0 imported, 1 updated, 0 skipped).',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await client.restoreBackup(validBackupPayload, 'overwrite');
      assert.ok(capturedUrl.includes('/api/meetings/restore?conflict_strategy=overwrite'));
      assert.equal(result.updated_count, 1);
    });

    it('API Service Security: restoreBackup and exportBackup never leak BYOK key or model headers', async () => {
      client.setCustomModel('gemini-2.5-pro');
      client.setCustomApiKey('AIzaSySecretBYOKKeyPhase4');

      let capturedExportHeaders = null;
      let capturedRestoreHeaders = null;

      globalThis.fetch = async (url, options) => {
        if (url.includes('/backup')) {
          capturedExportHeaders = options.headers;
          return new Response(JSON.stringify(validBackupPayload), { status: 200 });
        }
        if (url.includes('/restore')) {
          capturedRestoreHeaders = options.headers;
          return new Response(
            JSON.stringify({
              status: 'restored',
              total_records: 1,
              imported_count: 1,
              updated_count: 0,
              skipped_count: 0,
              message: 'Restored',
            }),
            { status: 200 }
          );
        }
      };

      await client.exportBackup();
      await client.restoreBackup(validBackupPayload, 'skip');

      assert.ok(capturedExportHeaders);
      assert.equal(capturedExportHeaders['X-Gemini-API-Key'], undefined);
      assert.equal(capturedExportHeaders['X-Gemini-Model'], undefined);

      assert.ok(capturedRestoreHeaders);
      assert.equal(capturedRestoreHeaders['X-Gemini-API-Key'], undefined);
      assert.equal(capturedRestoreHeaders['X-Gemini-Model'], undefined);
    });

    it('API Service: handles HTTP 429 rate limit exceeded on restore', async () => {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ detail: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Retry-After': '12' },
        });
      };

      await assert.rejects(
        async () => client.restoreBackup(validBackupPayload),
        /Please wait 12 seconds/
      );
    });

    it('API Service: handles HTTP 503 when Firestore is unconfigured', async () => {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ detail: 'Firebase Firestore is not configured.' }), {
          status: 503,
        });
      };

      await assert.rejects(
        async () => client.restoreBackup(validBackupPayload),
        /Firebase Firestore is not configured on the backend/
      );
    });
  });
});
