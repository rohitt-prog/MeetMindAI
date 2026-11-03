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
});
