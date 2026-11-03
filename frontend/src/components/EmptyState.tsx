import React from 'react';
import { Inbox, Sparkles, ShieldCheck } from 'lucide-react';

interface EmptyStateProps {
  onNewMeetingClick: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onNewMeetingClick }) => {
  return (
    <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 border-dashed rounded-xl p-8 sm:p-10 flex flex-col items-center text-center transition-colors">
      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-center text-slate-500 dark:text-slate-400 mb-3 shadow-2xs">
        <Inbox className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Ready for Meeting Transcript
      </h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
        Paste meeting notes or conversation logs above, or click one of the quick samples to test AI analysis and ambiguity detection.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onNewMeetingClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>Focus Transcript Input</span>
        </button>
      </div>

      <div className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Grounded Extraction: Missing owners and dates remain null unless clarified</span>
      </div>
    </div>
  );
};
