import React, { useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  Users, 
  CheckSquare, 
  HelpCircle, 
  Terminal, 
  Activity, 
  Sparkles,
  Database
} from 'lucide-react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { TranscriptWorkspace } from '../components/TranscriptWorkspace';
import { AnalysisLoadingState } from '../components/AnalysisLoadingState';
import { AnalysisResults } from '../components/AnalysisResults';
import { RecentMeetingsList } from '../components/RecentMeetingsList';
import { Settings } from '../components/Settings';
import { 
  BackendConnectionState, 
  AnalysisState, 
  MeetingAnalysisRequest, 
  ClarificationAnswer,
  MeetingListItem,
  ThemeMode,
} from '../types';

interface DashboardProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  recentMeetings?: MeetingListItem[];
  isLoadingMeetings?: boolean;
  meetingsError?: string | null;
  activeMeetingId?: string | null;
  onSelectMeeting?: (meetingId: string) => void;
  onRefreshMeetings?: () => void;
  currentTranscript?: string;
  currentTitle?: string | null;
  currentMeetingId?: string | null;
  analysisState?: AnalysisState;
  onAnalyze?: (request: MeetingAnalysisRequest) => Promise<void>;
  onClarify?: (answers: ClarificationAnswer[]) => Promise<void>;
  onResetMeeting?: () => void;
  onClearClarificationError?: () => void;
  onDeleteMeeting?: (meetingId: string) => Promise<void>;
  themeMode?: ThemeMode;
  onSelectThemeMode?: (mode: ThemeMode) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  connectionState,
  onRefreshHealth,
  activeTab = 'dashboard',
  setActiveTab,
  recentMeetings = [],
  isLoadingMeetings = false,
  meetingsError = null,
  activeMeetingId = null,
  onSelectMeeting,
  onRefreshMeetings,
  onDeleteMeeting,
  currentTranscript = '',
  currentTitle = null,
  currentMeetingId = null,
  analysisState = {
    isLoading: false,
    isClarifying: false,
    data: null,
    currentMeetingId: null,
    currentTranscript: '',
    currentTitle: null,
    error: null,
    clarificationError: null,
    lastAnalyzedAt: null,
  },
  onAnalyze,
  onClarify,
  onResetMeeting,
  onClearClarificationError,
  themeMode = 'system',
  onSelectThemeMode,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const newMeetingInputRef = useRef<HTMLInputElement>(null);

  const handleFocusNewMeeting = () => {
    if (onResetMeeting) {
      onResetMeeting();
    }
    if (setActiveTab) {
      setActiveTab('dashboard');
    }
    setTimeout(() => {
      newMeetingInputRef.current?.focus();
      newMeetingInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  // Metrics computation
  const analysisData = analysisState.data;
  const unresolvedCount = analysisData
    ? analysisData.clarifications.filter((c) => !c.resolved).length
    : 0;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-y-auto bg-slate-50 dark:bg-slate-950 transition-colors">
      {/* Header */}
      <Header 
        onNewMeetingClick={handleFocusNewMeeting} 
        connectionState={connectionState}
        hasActiveAnalysis={!!analysisData}
        activeTab={activeTab}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-5 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
        <AnimatePresence mode="wait">
          {/* If Active Tab is 'meetings' (History View), show full recent meetings view */}
          {activeTab === 'meetings' ? (
            <motion.div
              key="history"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' as const }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Database className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <span>Meeting History & Persistence</span>
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                    All meeting transcripts and analyses are synchronized with Firebase Cloud Firestore.
                  </p>
                </div>
              </div>

              <RecentMeetingsList
                meetings={recentMeetings}
                isLoading={isLoadingMeetings}
                error={meetingsError}
                activeMeetingId={currentMeetingId || activeMeetingId}
                onSelectMeeting={(id) => onSelectMeeting && onSelectMeeting(id)}
                onRefresh={() => onRefreshMeetings && onRefreshMeetings()}
                onNewMeetingClick={handleFocusNewMeeting}
                onDeleteMeeting={onDeleteMeeting}
              />
            </motion.div>
          ) : activeTab === 'settings' ? (
            /* Settings View */
            <motion.div
              key="settings"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' as const }}
              className="space-y-6"
            >
              <Settings
                connectionState={connectionState}
                onRefreshHealth={onRefreshHealth}
                themeMode={themeMode}
                onSelectThemeMode={onSelectThemeMode || (() => {})}
                onRefreshMeetings={onRefreshMeetings}
              />
            </motion.div>
          ) : (
            /* Workspace View */
            <motion.div
              key="workspace"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' as const }}
              className="space-y-6"
            >
              {/* Welcome Section (Shown before analysis) */}
              {!analysisData && !analysisState.isLoading && (
                <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-2xs transition-colors">
                  <div className="relative z-10 max-w-3xl">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-semibold mb-3">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>AI Meeting Intelligence with Firestore</span>
                    </div>

                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      Transform Meeting Transcripts into Structured Action
                    </h1>
                    <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      MeetMind AI analyzes meeting dialogues to extract executive summaries, verified decisions, explicit deliverables, and proactively identifies ambiguities in ownership or deadlines—now persisted in Cloud Firestore.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-3 sm:gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-slate-400" />
                        <span>FastAPI + Uvicorn</span>
                      </div>
                      <span>&bull;</span>
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-slate-400" />
                        <span>Gemini 2.5 Flash</span>
                      </div>
                      <span>&bull;</span>
                      <div className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-slate-400" />
                        <span>Firebase Firestore</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Backend Connection Diagnostics Bar if disconnected */}
              {!connectionState.isConnected && !connectionState.isLoading && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-rose-800 dark:text-rose-300">
                      Backend Service Unreachable
                    </p>
                    <p className="text-rose-600 dark:text-rose-400">
                      Ensure the FastAPI backend is running on <code className="bg-rose-100 dark:bg-rose-950/80 px-1 py-0.5 rounded text-[11px] font-mono">http://localhost:8000</code>.
                    </p>
                  </div>
                  <button
                    onClick={onRefreshHealth}
                    className="self-start sm:self-auto px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium transition-colors"
                  >
                    Retry Connection
                  </button>
                </div>
              )}

              {/* Metrics Grid */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {analysisData ? 'Active Meeting Intelligence Metrics' : 'System Overview & Metrics'}
                  </h2>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {currentMeetingId ? `ID: ${currentMeetingId}` : analysisData ? 'Live Analysis' : 'Session Ready'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatsCard
                    title={analysisData ? 'Extracted Action Items' : 'Saved Meetings'}
                    value={analysisData ? analysisData.action_items.length : recentMeetings.length}
                    label={analysisData ? 'tasks mapped' : 'in Firestore'}
                    icon={CheckSquare}
                    badge={analysisData ? 'Verified Tasks' : 'Firestore'}
                    iconColor="text-indigo-600 dark:text-indigo-400"
                    delay={0}
                  />
                  <StatsCard
                    title={analysisData ? 'Confirmed Decisions' : 'Action Items'}
                    value={analysisData ? analysisData.decisions.length : 0}
                    label={analysisData ? 'agreed points' : 'ready to map'}
                    icon={Users}
                    badge={analysisData ? 'Explicit Decisions' : 'Ready'}
                    iconColor="text-emerald-600 dark:text-emerald-400"
                    delay={0.06}
                  />
                  <StatsCard
                    title={analysisData ? 'Ambiguities Detected' : 'Pending Clarifications'}
                    value={analysisData ? unresolvedCount : 0}
                    label={analysisData ? 'items pending' : 'zero ambiguities'}
                    icon={HelpCircle}
                    badge={unresolvedCount > 0 ? 'Action Needed' : 'Clear'}
                    iconColor={unresolvedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
                    badgeColor={unresolvedCount > 0 ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' : undefined}
                    delay={0.12}
                  />
                </div>
              </div>

              {/* Dynamic Workspace State */}
              {analysisState.isLoading ? (
                <AnalysisLoadingState
                  statusMessage="Gemini AI is parsing the transcript and saving to Firestore..."
                  isClarifying={false}
                />
              ) : analysisData ? (
                <AnalysisResults
                  analysis={analysisData}
                  meetingTitle={currentTitle}
                  meetingId={currentMeetingId}
                  transcript={currentTranscript}
                  onClarify={async (answers) => {
                    if (onClarify) await onClarify(answers);
                  }}
                  isClarifying={analysisState.isClarifying}
                  clarificationError={analysisState.clarificationError}
                  onClearClarificationError={() => {
                    if (onClearClarificationError) onClearClarificationError();
                  }}
                  onResetMeeting={() => {
                    if (onResetMeeting) onResetMeeting();
                  }}
                />
              ) : (
                <div className="space-y-6">
                  <TranscriptWorkspace
                    inputRef={newMeetingInputRef}
                    onAnalyze={async (req) => {
                      if (onAnalyze) await onAnalyze(req);
                    }}
                    isLoading={analysisState.isLoading}
                    error={analysisState.error}
                    onClearError={() => {
                      if (onResetMeeting) onResetMeeting();
                    }}
                  />

                  {/* Recent Meetings Panel right on Dashboard when no active analysis */}
                  <RecentMeetingsList
                    meetings={recentMeetings}
                    isLoading={isLoadingMeetings}
                    error={meetingsError}
                    activeMeetingId={currentMeetingId}
                    onSelectMeeting={(id) => onSelectMeeting && onSelectMeeting(id)}
                    onRefresh={() => onRefreshMeetings && onRefreshMeetings()}
                    onNewMeetingClick={handleFocusNewMeeting}
                    onDeleteMeeting={onDeleteMeeting}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
