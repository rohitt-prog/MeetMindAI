import React, { useState } from 'react';
import { 
  Sparkles, 
  Trash2, 
  FileText, 
  AlertCircle,
  RefreshCw,
  HelpCircle,
  Lightbulb
} from 'lucide-react';
import { MeetingAnalysisRequest } from '../types';

interface TranscriptWorkspaceProps {
  inputRef?: React.RefObject<HTMLInputElement>;
  onAnalyze: (request: MeetingAnalysisRequest) => void;
  isLoading: boolean;
  error?: string | null;
  onClearError?: () => void;
}

export const TranscriptWorkspace: React.FC<TranscriptWorkspaceProps> = ({
  inputRef,
  onAnalyze,
  isLoading,
  error,
  onClearError,
}) => {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const sampleTranscripts = [
    {
      label: 'Sprint Sync (Ambiguous Ownership)',
      title: 'Sprint Architecture & Milestone Planning',
      text: `Sarah: Let's review the blockers for the milestone release.
David: The Figma design system tokens are complete. I need Alex to confirm the GraphQL schema changes for user preferences by Wednesday 4 PM.
Alex: I will finalize the endpoint by Wednesday 4 PM once security signs off.
Priya: We need test credentials for the staging sandbox. Who is provisioning them?
Sarah: Someone should provision staging access by tomorrow morning. Alex, please document the authentication fallback plan.`,
    },
    {
      label: 'Product Roadmap (Ambiguous Decision)',
      title: 'Q4 Product Strategy & Launch Discussion',
      text: `Marcus: Our mobile retention metrics look promising after the v2 beta.
Elena: We should consider launching the enterprise tier next month if beta feedback remains above 90%.
Marcus: Let's also make sure the privacy policy is updated. Someone needs to review GDPR compliance before launch.
Elena: I'll coordinate with legal. Let's finish the compliance checklist by Friday.`,
    },
    {
      label: 'Product Launch (Deferred & Follow-ups)',
      title: 'Product Launch Planning Sync',
      text: `Arjun: I will finalize the Stripe payment-flow integration by Tuesday 5 PM.
Neha: I'll prepare the customer FAQ documentation and review the launch checklist by Thursday.
David: I'll prepare the regression test report by Friday.
Maya: We proposed launching on November 20th, but the launch date is unconfirmed pending final QA review.
Maya: We also need to inform the marketing team, but let's decide who will do that in the next meeting.`,
    },
  ];

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const charCount = transcript.length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (onClearError) onClearError();

    if (!transcript.trim()) {
      setValidationError('Please paste or type a meeting transcript before submitting for analysis.');
      return;
    }

    onAnalyze({
      title: title.trim() || undefined,
      transcript: transcript.trim(),
    });
  };

  const handleLoadSample = (index: number) => {
    const sample = sampleTranscripts[index];
    setTitle(sample.title);
    setTranscript(sample.text);
    setValidationError(null);
    if (onClearError) onClearError();
  };

  const handleClear = () => {
    setTitle('');
    setTranscript('');
    setValidationError(null);
    if (onClearError) onClearError();
  };

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs transition-colors">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Meeting Transcript Input
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Paste meeting dialogue or audio transcript text to extract structured summaries and action items.
            </p>
          </div>
        </div>

        {/* Quick sample actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Lightbulb className="w-3 h-3 text-amber-500" />
              Samples:
            </span>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleLoadSample(0)}
              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              title="Load Sprint Sync Sample"
            >
              Sprint Sync
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleLoadSample(1)}
              className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              title="Load Roadmap Strategy Sample"
            >
              Strategy
            </button>
          </div>

          {(title || transcript) && (
            <button
              type="button"
              disabled={isLoading}
              onClick={handleClear}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-medium transition-colors disabled:opacity-50"
              title="Clear all fields"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {/* Optional Meeting Title */}
        <div>
          <label htmlFor="meeting-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Meeting Title <span className="text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            id="meeting-title"
            ref={inputRef}
            type="text"
            disabled={isLoading}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Weekly Engineering Sync / Architecture Review"
            className="w-full bg-white dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-900/50"
          />
        </div>

        {/* Meeting Transcript Input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="meeting-transcript" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Meeting Transcript <span className="text-rose-500">*</span>
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {wordCount} words &middot; {charCount} chars
            </span>
          </div>
          <textarea
            id="meeting-transcript"
            rows={7}
            disabled={isLoading}
            value={transcript}
            onChange={(e) => {
              setTranscript(e.target.value);
              if (validationError) setValidationError(null);
            }}
            placeholder="Paste raw conversation or transcript here. Example:&#10;Sarah: Let's review the blockers for the milestone release...&#10;Alex: I will finalize the endpoint by Wednesday 4 PM...&#10;David: Someone should provision staging access by tomorrow morning..."
            className={`w-full bg-white dark:bg-slate-950/90 border ${
              validationError ? 'border-rose-400 ring-1 ring-rose-400/30' : 'border-slate-300 dark:border-slate-800'
            } rounded-lg p-3 text-xs leading-relaxed font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-900/50`}
          />
        </div>

        {/* Validation Error Message */}
        {validationError && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* API Error Message */}
        {error && (
          <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-start sm:items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              className="self-start sm:self-auto px-2.5 py-1 rounded bg-rose-100 dark:bg-rose-900/60 hover:bg-rose-200 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-200 font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Action Button & Note */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Gemini evaluates transcript clarity, assigns owners/deadlines, and flags ambiguities.</span>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing Meeting...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Analyze Meeting</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
};
