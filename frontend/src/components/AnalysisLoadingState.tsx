import React from 'react';
import { Sparkles, BrainCircuit, ShieldCheck, ListOrdered } from 'lucide-react';

interface AnalysisLoadingStateProps {
  statusMessage?: string;
  isClarifying?: boolean;
}

export const AnalysisLoadingState: React.FC<AnalysisLoadingStateProps> = ({
  statusMessage = 'Analyzing meeting transcript with Gemini AI...',
  isClarifying = false,
}) => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 sm:p-12 shadow-sm text-center max-w-2xl mx-auto my-6 animate-in fade-in duration-300">
      <div className="relative w-16 h-16 mx-auto mb-6 flex items-center justify-center">
        <div className="absolute inset-0 rounded-2xl bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 animate-pulse" />
        <div className="relative z-10 text-indigo-600 dark:text-indigo-400 animate-bounce">
          {isClarifying ? (
            <BrainCircuit className="w-8 h-8" />
          ) : (
            <Sparkles className="w-8 h-8" />
          )}
        </div>
      </div>

      <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
        {isClarifying ? 'Re-evaluating Meeting Insights...' : 'Processing Meeting Transcript'}
      </h3>

      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
        {statusMessage}
      </p>

      {/* Progress steps */}
      <div className="max-w-md mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-2 mb-1 text-indigo-600 dark:text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">Summary</span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {isClarifying ? 'Updating context' : 'Synthesizing core topics'}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-2 mb-1 text-emerald-600 dark:text-emerald-400">
            <ListOrdered className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">Action Items</span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {isClarifying ? 'Assigning owners/dates' : 'Mapping deliverables'}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-2 mb-1 text-amber-600 dark:text-amber-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">Ambiguities</span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {isClarifying ? 'Checking remaining items' : 'Flagging unclear terms'}
          </p>
        </div>
      </div>
    </div>
  );
};

