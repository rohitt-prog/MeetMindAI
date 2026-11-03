import React from 'react';
import { Plus, Server, CheckCircle2, AlertTriangle, LogOut } from 'lucide-react';
import { BackendConnectionState } from '../types';
import { useAuth } from '../context/AuthContext';

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
  const { user, logout } = useAuth();

  const userInitial = user?.email
    ? user.email.charAt(0).toUpperCase()
    : user?.displayName
    ? user.displayName.charAt(0).toUpperCase()
    : 'U';

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

        {/* Authenticated User Account Card & Logout */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80"
              title={`Signed in as: ${user.email || user.displayName || user.uid}`}
            >
              <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">
                {userInitial}
              </div>
              <span className="hidden md:inline text-xs font-medium text-slate-700 dark:text-slate-200 max-w-[140px] truncate">
                {user.email || user.displayName || 'Authenticated'}
              </span>
            </div>

            <button
              onClick={() => logout()}
              title="Sign Out of MeetMind AI"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              aria-label="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
