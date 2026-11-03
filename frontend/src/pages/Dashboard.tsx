import React, { useRef } from 'react';
import { 
  Users, 
  CheckSquare, 
  HelpCircle, 
  Terminal,
  Activity,
  Layers
} from 'lucide-react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { NewMeetingSection } from '../components/NewMeetingSection';
import { EmptyState } from '../components/EmptyState';
import { BackendConnectionState } from '../types';

interface DashboardProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  connectionState,
  onRefreshHealth,
}) => {
  const newMeetingInputRef = useRef<HTMLInputElement>(null);

  const handleFocusNewMeeting = () => {
    newMeetingInputRef.current?.focus();
    newMeetingInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-y-auto bg-slate-950">
      {/* Header */}
      <Header 
        onNewMeetingClick={handleFocusNewMeeting} 
        connectionState={connectionState}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-8 max-w-7xl w-full mx-auto space-y-8">
        {/* Welcome Section */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 p-8 shadow-sm">
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-3">
              <Layers className="w-3.5 h-3.5" />
              <span>Phase 1: Project Foundation & Handshake Active</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
              Welcome to MeetMind AI
            </h1>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              AI-Powered Meeting-to-Action Assistant designed to transform messy meeting transcripts into structured summaries, key discussion points, explicit action items, deadlines, and proactive clarification questions.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-slate-400" />
                <span>Backend: FastAPI + Uvicorn</span>
              </div>
              <span>&bull;</span>
              <div className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-slate-400" />
                <span>Client: React + Vite + TypeScript</span>
              </div>
            </div>
          </div>
        </div>

        {/* Backend Connection Diagnostics Bar if disconnected */}
        {!connectionState.isConnected && !connectionState.isLoading && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <p className="font-semibold text-rose-300">
                Backend Service Unreachable
              </p>
              <p className="text-rose-400/90">
                Ensure the FastAPI backend is running on <code className="bg-rose-950/80 px-1 py-0.5 rounded text-[11px]">http://localhost:8000</code>.
              </p>
            </div>
            <button
              onClick={onRefreshHealth}
              className="self-start sm:self-auto px-3.5 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-900 text-rose-200 font-medium transition-colors border border-rose-700/60"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Meeting Statistics Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              System Overview & Metrics
            </h2>
            <span className="text-[11px] text-slate-400">Initialized State</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <StatsCard
              title="Total Meetings"
              value={0}
              label="recorded"
              icon={Users}
              badge="Phase 1 Ready"
              iconColor="text-indigo-400"
            />
            <StatsCard
              title="Action Items"
              value={0}
              label="assigned"
              icon={CheckSquare}
              badge="Phase 1 Ready"
              iconColor="text-emerald-400"
            />
            <StatsCard
              title="Pending Clarifications"
              value={0}
              label="questions"
              icon={HelpCircle}
              badge="Phase 1 Ready"
              iconColor="text-amber-400"
            />
          </div>
        </div>

        {/* New Meeting Input Section */}
        <NewMeetingSection inputRef={newMeetingInputRef} />

        {/* Recent Meeting History / Empty State */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Meeting Archive
            </h2>
            <span className="text-[11px] text-slate-400">0 Items in Database</span>
          </div>

          <EmptyState onNewMeetingClick={handleFocusNewMeeting} />
        </div>
      </main>
    </div>
  );
};
