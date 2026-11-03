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

export interface MeetingDraft {
  title: string;
  transcript: string;
}

export interface MeetingStats {
  totalMeetings: number;
  actionItems: number;
  pendingClarifications: number;
}
