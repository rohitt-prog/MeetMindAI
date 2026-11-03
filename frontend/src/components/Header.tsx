import React from 'react';
import { Plus, Server, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BackendConnectionState } from '../types';

interface HeaderProps {
  onNewMeetingClick: () => void;
  connectionState: BackendConnectionState;
}

export const Header: React.FC<HeaderProps> = ({
  onNewMeetingClick,
  connectionState,
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/40 backdrop-blur px-8 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-slate-400">Workspace</span>
        <span className="text-slate-600">/</span>
        <span className="text-sm font-semibold text-slate-200">Overview Dashboard</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Backend status pill */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border font-medium transition-colors ${
            connectionState.isConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>{connectionState.isConnected ? 'Backend Connected' : 'Backend Disconnected'}</span>
          {connectionState.isConnected ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3 h-3 text-rose-400" />
          )}
        </div>

        {/* Primary Action Button */}
        <button
          onClick={onNewMeetingClick}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-indigo-600/30 transition-all duration-150"
        >
          <Plus className="w-4 h-4" />
          <span>New Meeting</span>
        </button>
      </div>
    </header>
  );
};
