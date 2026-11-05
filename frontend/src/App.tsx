import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { AuthModal } from './components/AuthModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { 
  BackendConnectionState, 
  AnalysisState, 
  MeetingListItem, 
  MeetingAnalysisRequest, 
  ClarificationAnswer,
  ThemeMode,
} from './types';
import { apiService } from './services/api';

function AppContent() {
  const { user, loading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('meetmind_theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
    return 'system';
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('meetmind_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
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

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fetch recent meetings for the authenticated user
  const fetchRecentMeetings = useCallback(async () => {
    if (!user) {
      setRecentMeetings([]);
      return;
    }
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
  }, [user]);

  const checkBackendHealth = useCallback(async () => {
    setConnectionState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const data = await apiService.getHealth();
      const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime);
      setConnectionState({
        isConnected: data.status === 'ok',
        isLoading: false,
        appName: data.app,
        latencyMs,
        lastChecked: new Date(),
      });
    } catch (err: unknown) {
      const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime);
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      setConnectionState({
        isConnected: false,
        isLoading: false,
        error: message,
        latencyMs,
        lastChecked: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    // Sync theme class on <html> and react to system changes
    const root = document.documentElement;
    localStorage.setItem('meetmind_theme', themeMode);

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = (matches: boolean) => {
        setIsDarkMode(matches);
        if (matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      };

      applySystemTheme(mediaQuery.matches);

      const listener = (e: MediaQueryListEvent) => applySystemTheme(e.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    } else {
      const dark = themeMode === 'dark';
      setIsDarkMode(dark);
      if (dark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [themeMode]);

  useEffect(() => {
    // Health check on mount and interval
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  // When user signs in or changes, refresh meetings, workspace, and model preferences
  useEffect(() => {
    if (user) {
      fetchRecentMeetings();
      apiService.getUserPreferences().catch(() => {});
    } else {
      setRecentMeetings([]);
      handleResetMeeting();
      apiService.clearCustomModelAndKey();
    }
  }, [user, fetchRecentMeetings]);

  const toggleTheme = () => {
    setThemeMode(isDarkMode ? 'light' : 'dark');
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

  // Permanently delete a meeting from Firestore
  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      await apiService.deleteMeeting(meetingId);
      setRecentMeetings((prev) => prev.filter((m) => m.meeting_id !== meetingId));
      if (currentMeetingId === meetingId) {
        handleResetMeeting();
      }
      setToast({ message: 'Meeting deleted successfully.', type: 'success' });
      setTimeout(() => setToast(null), 3500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete meeting.';
      setToast({ message, type: 'error' });
      setTimeout(() => setToast(null), 4000);
      throw err;
    }
  };

  if (isAuthLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg animate-pulse">
            <Sparkles className="w-5 h-5" />
          </div>
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Initializing MeetMind AI...
          </p>
        </div>
      </div>
    );
  }

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
        onDeleteMeeting={handleDeleteMeeting}
      />
      <Dashboard
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        themeMode={themeMode}
        onSelectThemeMode={setThemeMode}
        recentMeetings={recentMeetings}
        isLoadingMeetings={isLoadingMeetings}
        meetingsError={meetingsError}
        activeMeetingId={currentMeetingId}
        onSelectMeeting={handleSelectMeeting}
        onRefreshMeetings={fetchRecentMeetings}
        onDeleteMeeting={handleDeleteMeeting}
        currentTranscript={currentTranscript}
        currentTitle={currentTitle}
        currentMeetingId={currentMeetingId}
        analysisState={analysisState}
        onAnalyze={handleAnalyze}
        onClarify={handleClarify}
        onResetMeeting={handleResetMeeting}
        onClearClarificationError={handleClearClarificationError}
      />

      {/* Authentication Gateway for Unauthenticated Visitors */}
      <AuthModal isOpen={!user} />

      {/* Floating Status Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl border backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700/80'
                : 'bg-rose-900/95 text-white border-rose-700'
            }`}
            role="status"
            aria-live="polite"
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
