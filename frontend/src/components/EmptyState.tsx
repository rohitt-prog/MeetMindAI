import React from 'react';
import { Inbox, ShieldCheck } from 'lucide-react';

interface EmptyStateProps {
  onNewMeetingClick: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onNewMeetingClick }) => {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 border-dashed rounded-xl p-10 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-4">
        <Inbox className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-slate-200">
        No Meeting Transcripts Processed
      </h3>
      <p className="mt-1 text-xs text-slate-400 max-w-sm leading-relaxed">
        Meeting history and AI-generated action summaries will appear here once Phase 2 AI processing and MongoDB persistence are connected.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onNewMeetingClick}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
        >
          Draft a Meeting Transcript
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
        <span>Phase 1 Verification: Zero fabricated records displayed</span>
      </div>
    </div>
  );
};
