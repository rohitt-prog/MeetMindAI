import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock ApiService implementation for node test suite to mirror frontend/src/services/api.ts
class ApiServiceTestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
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

        if (response.status === 503) {
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
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
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
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
      const response = await fetch(url, {
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

  async exportMeetingPdf(request) {
    const url = `${this.baseUrl}/api/meetings/export/pdf`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
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
      const response = await fetch(url, {
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
});
