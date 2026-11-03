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
  summary: string;
  discussion_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  clarification_required: boolean;
  clarification_question?: string | null;
  clarifications: ClarificationItem[];
}

export interface ClarificationAnswer {
  clarification_id: string;
  answer: string;
}

export interface MeetingClarificationRequest {
  analysis: MeetingAnalysisResponse;
  answers: ClarificationAnswer[];
}

export interface AnalysisState {
  isLoading: boolean;
  isClarifying: boolean;
  data: MeetingAnalysisResponse | null;
  error: string | null;
  clarificationError: string | null;
  lastAnalyzedAt: Date | null;
}
