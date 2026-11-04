export type ThemeMode = 'light' | 'dark' | 'system';

export interface HealthCheckResponse {
  status: string;
  app: string;
}

export interface BackendConnectionState {
  isConnected: boolean;
  isLoading: boolean;
  appName?: string;
  error?: string;
  lastChecked?: Date;
  latencyMs?: number;
}

export interface ActionItem {
  id?: string | null;
  task: string;
  owner?: string | null;
  deadline?: string | null;
  status: string;
}

export interface ClarificationItem {
  id: string;
  category: string;
  original_statement: string;
  explanation: string;
  question: string;
  related_action_item_id?: string | null;
  resolved: boolean;
}

export interface MeetingAnalysisRequest {
  title?: string | null;
  transcript: string;
}

export interface MeetingAnalysisResponse {
  meeting_id?: string | null;
  summary: string;
  discussion_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  clarification_required: boolean;
  clarification_question?: string | null;
  clarifications: ClarificationItem[];
  open_follow_ups?: string[];
}

export interface ClarificationAnswer {
  clarification_id: string;
  answer: string;
}

export interface MeetingClarificationRequest {
  meeting_id?: string | null;
  analysis: MeetingAnalysisResponse;
  answers: ClarificationAnswer[];
}

export interface MeetingListItem {
  meeting_id: string;
  title?: string | null;
  summary: string;
  created_at: string;
  updated_at: string;
  action_items_count: number;
  decisions_count: number;
  clarification_required: boolean;
  unresolved_clarifications_count: number;
  open_follow_ups_count?: number;
}

export interface MeetingDetailResponse {
  meeting_id: string;
  title?: string | null;
  transcript: string;
  created_at: string;
  updated_at: string;
  analysis: MeetingAnalysisResponse;
  answers_history?: Array<{
    clarification_id: string;
    answer: string;
    timestamp: string;
  }>;
}

export interface MeetingPdfExportRequest {
  title?: string | null;
  transcript?: string | null;
  analysis: MeetingAnalysisResponse;
  answers_history?: Array<{
    clarification_id: string;
    answer: string;
    timestamp: string;
  }>;
}

export interface MeetingDeleteResponse {
  status: string;
  meeting_id: string;
  message?: string;
}

export interface BackupUserSummary {
  uid: string;
  email: string | null;
  is_demo_user: boolean;
}

export interface BackupMetrics {
  total_meetings: number;
  total_action_items: number;
  total_decisions: number;
  is_complete: boolean;
  api_limit_reached: boolean;
  retrieval_note: string;
}

export interface MeetingBackupPayload {
  version: string;
  backup_type: string;
  exported_at: string;
  user: BackupUserSummary;
  metrics: BackupMetrics;
  meetings: MeetingDetailResponse[];
}

export interface AnalysisState {
  isLoading: boolean;
  isClarifying: boolean;
  data: MeetingAnalysisResponse | null;
  currentMeetingId: string | null;
  currentTranscript: string;
  currentTitle: string | null;
  error: string | null;
  clarificationError: string | null;
  lastAnalyzedAt: Date | null;
}
