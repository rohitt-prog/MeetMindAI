import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  HelpCircle, 
  CheckCircle2, 
  Send, 
  AlertCircle, 
  Clock, 
  UserX, 
  CalendarClock, 
  FileQuestion, 
  Lightbulb,
  RefreshCw
} from 'lucide-react';
import { ClarificationItem, ClarificationAnswer } from '../types';

interface ClarificationSectionProps {
  clarifications: ClarificationItem[];
  openFollowUps?: string[];
  onClarify: (answers: ClarificationAnswer[]) => Promise<void>;
  isClarifying: boolean;
  clarificationError?: string | null;
  onClearClarificationError?: () => void;
}

export const ClarificationSection: React.FC<ClarificationSectionProps> = ({
  clarifications,
  openFollowUps = [],
  onClarify,
  isClarifying,
  clarificationError,
  onClearClarificationError,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const unresolvedItems = clarifications.filter((c) => !c.resolved);
  const resolvedItems = clarifications.filter((c) => c.resolved);
  const answeredUnresolved = unresolvedItems.filter(
    (item) => (answers[item.id] || '').trim().length > 0
  );

  const handleInputChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (onClearClarificationError) {
      onClearClarificationError();
    }
  };

  const handleSubmitSingle = async (clarificationId: string) => {
    const text = (answers[clarificationId] || '').trim();
    if (!text) return;

    setSubmittingId(clarificationId);
    try {
      await onClarify([{ clarification_id: clarificationId, answer: text }]);
      // Clear input on success
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[clarificationId];
        return next;
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const handleSubmitBatch = async () => {
    const batch = answeredUnresolved.map((item) => ({
      clarification_id: item.id,
      answer: answers[item.id].trim(),
    }));
    if (batch.length === 0) return;

    setSubmittingId('__all__');
    try {
      await onClarify(batch);
      // Clear submitted inputs on success
      setAnswers((prev) => {
        const next = { ...prev };
        for (const item of batch) {
          delete next[item.clarification_id];
        }
        return next;
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category.toLowerCase()) {
      case 'ownership':
        return {
          label: 'Ambiguous Ownership',
          icon: UserX,
          classes: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
        };
      case 'deadline':
        return {
          label: 'Ambiguous Deadline',
          icon: CalendarClock,
          classes: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60',
        };
      case 'decision_vs_suggestion':
        return {
          label: 'Suggestion vs. Decision',
          icon: Lightbulb,
          classes: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/60',
        };
      case 'task_scope':
        return {
          label: 'Ambiguous Task Scope',
          icon: Clock,
          classes: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/60',
        };
      default:
        return {
          label: category.replace(/_/g, ' '),
          icon: FileQuestion,
          classes: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        };
    }
  };

  if (clarifications.length === 0) {
    if (openFollowUps && openFollowUps.length > 0) {
      return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                0 Clarifications Required &bull; {openFollowUps.length} Open Follow-up{openFollowUps.length === 1 ? '' : 's'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All active deliverables have clear assignments. The following item(s) are recorded as open follow-ups explicitly deferred to a future meeting:
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            {openFollowUps.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300"
              >
                <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <span className="font-semibold text-indigo-900 dark:text-indigo-300 mr-1.5">[Open Follow-up]</span>
                  <span>{item}</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Clarification required now: No (explicitly deferred in transcript).
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto mb-3">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          No Outstanding Issues Detected
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          All action items, task ownerships, and deadlines in this transcript were clear and explicit. No follow-up questions needed.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Ambiguity Clarifications
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ({unresolvedItems.length} open, {resolvedItems.length} resolved)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {answeredUnresolved.length > 1 && (
            <button
              type="button"
              disabled={isClarifying}
              onClick={handleSubmitBatch}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-40"
            >
              {submittingId === '__all__' ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Submitting All...</span>
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  <span>Submit All Answers ({answeredUnresolved.length})</span>
                </>
              )}
            </button>
          )}
          {unresolvedItems.length > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
              Action Required
            </span>
          )}
        </div>
      </div>

      {/* Global Clarification Error if any */}
      {clarificationError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between text-xs text-rose-800 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{clarificationError}</span>
          </div>
          {onClearClarificationError && (
            <button
              onClick={onClearClarificationError}
              className="text-[11px] underline hover:no-underline text-rose-700 dark:text-rose-300 font-medium ml-2 shrink-0"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Unresolved Clarifications List */}
      <div className="space-y-3.5">
        <AnimatePresence mode="popLayout">
          {unresolvedItems.map((item) => {
            const badge = getCategoryBadge(item.category);
            const Icon = badge.icon;
            const currentAnswer = answers[item.id] || '';
            const isItemSubmitting = isClarifying && submittingId === item.id;

            return (
              <motion.div
                key={item.id}
                layout={!shouldReduceMotion}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={{ duration: 0.2, ease: 'easeOut' as const }}
                className="bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-800/50 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3 transition-colors"
              >
              {/* Category & ID badge */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${badge.classes}`}>
                    <Icon className="w-3 h-3" />
                    <span>{badge.label}</span>
                  </span>
                  {item.related_action_item_id && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      ref: {item.related_action_item_id}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                  Needs Resolution
                </span>
              </div>

              {/* Transcript quote */}
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 text-xs">
                <span className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500 block mb-0.5">
                  Transcript Statement
                </span>
                <p className="text-slate-700 dark:text-slate-300 italic font-mono text-[11px] leading-relaxed">
                  "{item.original_statement}"
                </p>
              </div>

              {/* Explanation & Question */}
              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <strong className="text-slate-800 dark:text-slate-200">Why it's unclear:</strong> {item.explanation}
                </p>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-start gap-1.5 pt-1">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                  <span>{item.question}</span>
                </p>
              </div>

              {/* Answer input form */}
              <div className="pt-2">
                <label htmlFor={`answer-${item.id}`} className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Your Answer or Clarification
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id={`answer-${item.id}`}
                    type="text"
                    disabled={isClarifying}
                    value={currentAnswer}
                    onChange={(e) => handleInputChange(item.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && currentAnswer.trim() && !isClarifying) {
                        e.preventDefault();
                        handleSubmitSingle(item.id);
                      }
                    }}
                    placeholder="e.g., David from Infrastructure will provision credentials by tomorrow 10 AM..."
                    className="flex-1 bg-white dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={isClarifying || !currentAnswer.trim()}
                    onClick={() => handleSubmitSingle(item.id)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {isItemSubmitting ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Updating...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3 h-3" />
                        <span>Submit Answer</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
        </AnimatePresence>

        {/* Open Follow-ups & Deferred Items (Non-interactive) */}
        {openFollowUps && openFollowUps.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-300 uppercase tracking-wider">
                Open Follow-ups &amp; Deferred Items ({openFollowUps.length})
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
              The following item(s) are recorded as open follow-ups deferred to future discussion. No immediate clarification input is required:
            </p>
            {openFollowUps.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300"
              >
                <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-indigo-900 dark:text-indigo-300 mr-1.5">[Deferred]</span>
                  <span>{item}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resolved Clarifications List */}
        {resolvedItems.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-2">
              Resolved Clarifications ({resolvedItems.length})
            </span>
            {resolvedItems.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300 text-[11px]">
                      {item.category.replace(/_/g, ' ')} Resolved
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      "{item.original_statement}"
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Question: {item.question}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

