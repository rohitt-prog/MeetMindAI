import {
  MeetingListItem,
  MeetingDetailResponse,
  MeetingBackupPayload,
  BackupMetrics,
  BackupUserSummary,
} from '../types';
import { AuthUser } from '../context/AuthContext';
import { apiService } from './api';

export const BACKUP_FORMAT_VERSION = '1.0';
export const API_MAX_MEETING_LIMIT = 100;

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  payload?: MeetingBackupPayload;
  summary?: {
    totalMeetings: number;
    totalActionItems: number;
    totalDecisions: number;
    exportedAt?: string;
    version: string;
  };
}

/**
 * Parses and validates an uploaded backup JSON string before sending to backend or presenting confirmation.
 * Enforces schema version, backup_type, and required meeting fields.
 */
export function parseAndValidateBackupJson(jsonString: string): BackupValidationResult {
  if (!jsonString || !jsonString.trim()) {
    return { valid: false, error: 'The selected backup file is empty.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid JSON';
    return { valid: false, error: `Malformed JSON file: ${msg}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Backup root must be a JSON object.' };
  }

  const record = parsed as Record<string, unknown>;

  // Check version
  const version = typeof record.version === 'string' ? record.version.trim() : '';
  if (!version) {
    return { valid: false, error: "Missing required 'version' field in backup." };
  }
  if (version !== BACKUP_FORMAT_VERSION) {
    return {
      valid: false,
      error: `Unsupported backup version '${version}'. Only version ${BACKUP_FORMAT_VERSION} is supported.`,
    };
  }

  // Check backup_type
  const backupType = typeof record.backup_type === 'string' ? record.backup_type.trim() : '';
  if (backupType !== 'meetmind_ai_meetings_backup') {
    return {
      valid: false,
      error: `Invalid backup type '${backupType}'. Expected 'meetmind_ai_meetings_backup'.`,
    };
  }

  // Check meetings array
  if (!Array.isArray(record.meetings)) {
    return { valid: false, error: "Backup file is missing required 'meetings' array." };
  }

  if (record.meetings.length === 0) {
    return { valid: false, error: 'Backup file contains no meeting records to restore.' };
  }

  if (record.meetings.length > 500) {
    return {
      valid: false,
      error: `Backup contains ${record.meetings.length} meetings, exceeding the maximum limit of 500 records.`,
    };
  }

  const seenIds = new Set<string>();
  let totalActionItems = 0;
  let totalDecisions = 0;

  for (let i = 0; i < record.meetings.length; i++) {
    const item = record.meetings[i];
    if (typeof item !== 'object' || item === null) {
      return { valid: false, error: `Meeting at index ${i} is not a valid object.` };
    }
    const m = item as Record<string, unknown>;

    // meeting_id
    const meetingId = typeof m.meeting_id === 'string' ? m.meeting_id.trim() : '';
    if (!meetingId) {
      return { valid: false, error: `Meeting at index ${i} is missing a valid 'meeting_id'.` };
    }
    if (seenIds.has(meetingId)) {
      return { valid: false, error: `Duplicate meeting ID '${meetingId}' detected at index ${i}.` };
    }
    seenIds.add(meetingId);

    // transcript
    if (typeof m.transcript !== 'string' || !m.transcript.trim()) {
      return { valid: false, error: `Meeting '${meetingId}' (index ${i}) has an empty transcript.` };
    }

    // analysis
    if (typeof m.analysis !== 'object' || m.analysis === null) {
      return { valid: false, error: `Meeting '${meetingId}' (index ${i}) is missing 'analysis' data.` };
    }
    const analysis = m.analysis as Record<string, unknown>;
    if (typeof analysis.summary !== 'string' || !analysis.summary.trim()) {
      return { valid: false, error: `Meeting '${meetingId}' (index ${i}) analysis is missing required 'summary'.` };
    }

    // Accumulate metrics
    const actions = Array.isArray(analysis.action_items) ? analysis.action_items : [];
    const decisions = Array.isArray(analysis.decisions) ? analysis.decisions : [];
    totalActionItems += actions.length;
    totalDecisions += decisions.length;
  }

  const payload = record as unknown as MeetingBackupPayload;

  return {
    valid: true,
    payload,
    summary: {
      totalMeetings: record.meetings.length,
      totalActionItems,
      totalDecisions,
      exportedAt: typeof record.exported_at === 'string' ? record.exported_at : undefined,
      version,
    },
  };
}

/**
 * Generates a clean, timestamped filename for the JSON backup.
 * Format: meetmind-ai-backup-YYYY-MM-DD.json
 */
export function generateBackupFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `meetmind-ai-backup-${yyyy}-${mm}-${dd}.json`;
}

/**
 * Derives aggregate metrics from a list of meeting summary items.
 */
export function calculateBackupMetrics(
  meetings: (MeetingListItem | MeetingDetailResponse)[],
  apiLimit: number = API_MAX_MEETING_LIMIT
): BackupMetrics {
  const totalMeetings = meetings.length;
  const apiLimitReached = totalMeetings >= apiLimit;
  const isComplete = !apiLimitReached;

  let totalActionItems = 0;
  let totalDecisions = 0;

  for (const item of meetings) {
    if ('action_items_count' in item) {
      // MeetingListItem
      totalActionItems += item.action_items_count || 0;
      totalDecisions += item.decisions_count || 0;
    } else if ('analysis' in item && item.analysis) {
      // MeetingDetailResponse
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
}

/**
 * Builds a sanitized, metadata-rich backup payload ready for serialization.
 * Strips out any credential, token, or secret leaks.
 */
export function buildBackupPayload(params: {
  user: AuthUser | null;
  meetings: MeetingDetailResponse[];
  exportedAt?: string;
  apiLimitReached?: boolean;
}): MeetingBackupPayload {
  const { user, meetings, exportedAt = new Date().toISOString(), apiLimitReached } = params;

  const metrics = calculateBackupMetrics(meetings);
  if (typeof apiLimitReached === 'boolean') {
    metrics.api_limit_reached = apiLimitReached;
    metrics.is_complete = !apiLimitReached;
    if (apiLimitReached) {
      metrics.retrieval_note = `Backup includes the ${meetings.length} most recent meetings accessible via the current API endpoint (maximum ${API_MAX_MEETING_LIMIT} records per query).`;
    }
  }

  const userSummary: BackupUserSummary = {
    uid: user?.uid || 'anonymous',
    email: user?.email || (user?.isDemoUser ? 'demo@meetmind.ai' : null),
    is_demo_user: Boolean(user?.isDemoUser),
  };

  return {
    version: BACKUP_FORMAT_VERSION,
    backup_type: 'meetmind_ai_meetings_backup',
    exported_at: exportedAt,
    user: userSummary,
    metrics,
    meetings,
  };
}

/**
 * Triggers a browser download of the given object as a JSON file,
 * and promptly revokes the object URL.
 */
export function downloadJsonFile(data: unknown, filename: string): void {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Release object URL
  URL.revokeObjectURL(objectUrl);
}

/**
 * High-level backup executor: fetches the list of meetings,
 * fetches complete details for every meeting with progress reporting,
 * constructs the sanitized backup payload, and triggers the download.
 */
export async function exportMeetingsBackup(params: {
  user: AuthUser | null;
  onProgress?: (current: number, total: number, statusText: string) => void;
}): Promise<{
  filename: string;
  totalMeetings: number;
  totalActionItems: number;
  isComplete: boolean;
}> {
  const { user, onProgress } = params;

  // Attempt fast server-side backup export first
  try {
    onProgress?.(0, 0, 'Retrieving complete meeting backup from backend...');
    const backendPayload = await apiService.exportBackup();
    if (backendPayload && Array.isArray(backendPayload.meetings) && backendPayload.meetings.length > 0) {
      const filename = generateBackupFilename();
      downloadJsonFile(backendPayload, filename);
      return {
        filename,
        totalMeetings: backendPayload.metrics.total_meetings,
        totalActionItems: backendPayload.metrics.total_action_items,
        isComplete: backendPayload.metrics.is_complete,
      };
    }
  } catch {
    // Fallback to client-side list + get iteration
  }

  onProgress?.(0, 0, 'Fetching meeting list from Firestore...');
  const meetingList = await apiService.listMeetings(API_MAX_MEETING_LIMIT);

  if (meetingList.length === 0) {
    throw new Error('No saved meetings found to export. Analyze a meeting first.');
  }

  const total = meetingList.length;
  const detailedMeetings: MeetingDetailResponse[] = [];
  const errors: string[] = [];

  // Fetch full details with bounded concurrency (3 concurrent requests)
  const CONCURRENCY = 3;
  for (let i = 0; i < total; i += CONCURRENCY) {
    const chunk = meetingList.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map(async (item, chunkIndex) => {
      const currentIndex = i + chunkIndex + 1;
      onProgress?.(
        currentIndex,
        total,
        `Retrieving details for meeting ${currentIndex} of ${total}: "${item.title || item.meeting_id}"...`
      );

      try {
        const detail = await apiService.getMeeting(item.meeting_id);
        return detail;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Meeting ${item.meeting_id}: ${msg}`);
        // Fallback to synthesizing a detail record from the summary item so partial data is not lost
        const fallbackDetail: MeetingDetailResponse = {
          meeting_id: item.meeting_id,
          title: item.title,
          transcript: '(Transcript could not be retrieved from backend during export)',
          created_at: item.created_at,
          updated_at: item.updated_at,
          analysis: {
            meeting_id: item.meeting_id,
            summary: item.summary,
            discussion_points: [],
            decisions: [],
            action_items: [],
            clarification_required: item.clarification_required,
            clarifications: [],
          },
        };
        return fallbackDetail;
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    detailedMeetings.push(...chunkResults);
  }

  onProgress?.(total, total, 'Compiling backup JSON payload...');
  const apiLimitReached = meetingList.length >= API_MAX_MEETING_LIMIT;
  const payload = buildBackupPayload({
    user,
    meetings: detailedMeetings,
    apiLimitReached,
  });

  const filename = generateBackupFilename();
  downloadJsonFile(payload, filename);

  return {
    filename,
    totalMeetings: payload.metrics.total_meetings,
    totalActionItems: payload.metrics.total_action_items,
    isComplete: payload.metrics.is_complete,
  };
}

