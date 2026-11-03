import React from 'react';
import { Plus, Server, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BackendConnectionState } from '../types';

interface HeaderProps {
  onNewMeetingClick: () => void;
  connectionState: BackendConnectionState;
  hasActiveAnalysis?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onNewMeetingClick,
  connectionState,
  hasActiveAnalysis = false,
}) => {
  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/40 backdrop-blur px-6 sm:px-8 flex items-center justify-between shrink-0 transition-colors">
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Workspace</span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="text-xs font-semibold text-slate-900 dark:text-slate-200">
          {hasActiveAnalysis ? 'Meeting Analysis & Clarifications' : 'Transcript Ingestion'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Backend status pill */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border font-medium transition-colors ${
            connectionState.isConnected
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
              : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400'
          }`}
        >
          <Server className="w-3 h-3" />
          <span>{connectionState.isConnected ? 'Backend Ready' : 'Backend Offline'}</span>
          {connectionState.isConnected ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
          )}
        </div>

        {/* Primary Action Button */}
        <button
          onClick={onNewMeetingClick}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Meeting</span>
        </button>
      </div>
    </header>
  );
};
