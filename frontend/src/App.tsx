import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { 
  BackendConnectionState, 
  AnalysisState, 
  MeetingListItem, 
  MeetingAnalysisRequest, 
  ClarificationAnswer 
} from './types';
import { apiService } from './services/api';

export function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    // Default to light mode for a clean, modern SaaS appearance
    const saved = localStorage.getItem('meetmind_theme');
    if (saved) return saved === 'dark';
    return false;
  });

  const [connectionState, setConnectionState] = useState<BackendConnectionState>({
    isConnected: false,
    isLoading: true,
  });

  // Recent meetings from Firestore
  const [recentMeetings, setRecentMeetings] = useState<MeetingListItem[]>([]);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState<boolean>(false);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

  // Active meeting and analysis state
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    isLoading: false,
    isClarifying: false,
    data: null,
    currentMeetingId: null,
    currentTranscript: '',
    currentTitle: null,
    error: null,
    clarificationError: null,
    lastAnalyzedAt: null,
  });

  const fetchRecentMeetings = useCallback(async () => {
    setIsLoadingMeetings(true);
    setMeetingsError(null);
    try {
      const meetings = await apiService.listMeetings(25);
      setRecentMeetings(meetings);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load recent meetings';
      setMeetingsError(message);
    } finally {
      setIsLoadingMeetings(false);
    }
  }, []);

  const checkBackendHealth = useCallback(async () => {
    setConnectionState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      const data = await apiService.getHealth();
      setConnectionState({
        isConnected: data.status === 'ok',
        isLoading: false,
        appName: data.app,
        lastChecked: new Date(),
      });
      // Fetch meetings when backend is confirmed healthy
      fetchRecentMeetings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      setConnectionState({
        isConnected: false,
        isLoading: false,
        error: message,
        lastChecked: new Date(),
      });
    }
  }, [fetchRecentMeetings]);

  useEffect(() => {
    // Sync theme class on <html>
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('meetmind_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('meetmind_theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    // Initial health check on mount
    checkBackendHealth();

    // Periodic heartbeat check every 30 seconds
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  const toggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  // Analyze new transcript
  const handleAnalyze = async (request: MeetingAnalysisRequest) => {
    setAnalysisState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      clarificationError: null,
    }));
    setCurrentTitle(request.title || null);
    setCurrentTranscript(request.transcript);

    try {
      const result = await apiService.analyzeMeeting(request);
      setCurrentMeetingId(result.meeting_id || null);
      setAnalysisState({
        isLoading: false,
        isClarifying: false,
        data: result,
        currentMeetingId: result.meeting_id || null,
        currentTranscript: request.transcript,
        currentTitle: request.title || null,
        error: null,
        clarificationError: null,
        lastAnalyzedAt: new Date(),
      });
      // Refresh meetings list after saving new analysis
      fetchRecentMeetings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to analyze meeting transcript.';
      setAnalysisState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  };

  // Submit clarifications
  const handleClarify = async (answers: ClarificationAnswer[]) => {
    if (!analysisState.data) return;

    setAnalysisState((prev) => ({
      ...prev,
      isClarifying: true,
      clarificationError: null,
    }));

    try {
      const updated = await apiService.clarifyMeeting({
        meeting_id: currentMeetingId || analysisState.data.meeting_id,
        analysis: analysisState.data,
        answers,
      });

      setAnalysisState((prev) => ({
        ...prev,
        isClarifying: false,
        data: updated,
        currentMeetingId: updated.meeting_id || currentMeetingId,
        clarificationError: null,
      }));
      // Refresh meetings list after updating meeting with answers
      fetchRecentMeetings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resolve clarification answers.';
      setAnalysisState((prev) => ({
        ...prev,
        isClarifying: false,
        clarificationError: message,
      }));
    }
  };

  // Select a saved meeting from history
  const handleSelectMeeting = async (meetingId: string) => {
    setAnalysisState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      clarificationError: null,
    }));

    try {
      const detail = await apiService.getMeeting(meetingId);
      setCurrentMeetingId(detail.meeting_id);
      setCurrentTitle(detail.title || null);
      setCurrentTranscript(detail.transcript);

      setAnalysisState({
        isLoading: false,
        isClarifying: false,
        data: detail.analysis,
        currentMeetingId: detail.meeting_id,
        currentTranscript: detail.transcript,
        currentTitle: detail.title || null,
        error: null,
        clarificationError: null,
        lastAnalyzedAt: new Date(detail.updated_at),
      });

      // Navigate to workspace view to inspect the retrieved meeting
      setActiveTab('dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to load meeting ${meetingId}`;
      setAnalysisState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  };

  // Reset to blank new meeting workspace
  const handleResetMeeting = () => {
    setCurrentMeetingId(null);
    setCurrentTitle(null);
    setCurrentTranscript('');
    setAnalysisState({
      isLoading: false,
      isClarifying: false,
      data: null,
      currentMeetingId: null,
      currentTranscript: '',
      currentTitle: null,
      error: null,
      clarificationError: null,
      lastAnalyzedAt: null,
    });
    setActiveTab('dashboard');
  };

  const handleClearClarificationError = () => {
    setAnalysisState((prev) => ({ ...prev, clarificationError: null }));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased transition-colors">
      <Sidebar
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        recentMeetings={recentMeetings}
        isLoadingMeetings={isLoadingMeetings}
        meetingsError={meetingsError}
        activeMeetingId={currentMeetingId}
        onSelectMeeting={handleSelectMeeting}
        onRefreshMeetings={fetchRecentMeetings}
      />
      <Dashboard
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        recentMeetings={recentMeetings}
        isLoadingMeetings={isLoadingMeetings}
        meetingsError={meetingsError}
        activeMeetingId={currentMeetingId}
        onSelectMeeting={handleSelectMeeting}
        onRefreshMeetings={fetchRecentMeetings}
        currentTranscript={currentTranscript}
        currentTitle={currentTitle}
        currentMeetingId={currentMeetingId}
        analysisState={analysisState}
        onAnalyze={handleAnalyze}
        onClarify={handleClarify}
        onResetMeeting={handleResetMeeting}
        onClearClarificationError={handleClearClarificationError}
      />
    </div>
  );
}

export default App;
