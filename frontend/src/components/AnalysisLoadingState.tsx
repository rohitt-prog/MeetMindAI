import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, BrainCircuit, ShieldCheck, ListOrdered, FileCheck } from 'lucide-react';

interface AnalysisLoadingStateProps {
  statusMessage?: string;
  isClarifying?: boolean;
}

export const AnalysisLoadingState: React.FC<AnalysisLoadingStateProps> = ({
  statusMessage = 'Analyzing meeting transcript with Gemini AI...',
  isClarifying = false,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState<number>(0);

  const steps = isClarifying
    ? [
        { label: 'Clarifications', desc: 'Ingesting user responses', icon: BrainCircuit, color: 'text-indigo-500' },
        { label: 'Re-evaluating', desc: 'Resolving owners & dates', icon: ListOrdered, color: 'text-emerald-500' },
        { label: 'Audit Check', desc: 'Verifying remaining ambiguities', icon: ShieldCheck, color: 'text-amber-500' },
        { label: 'Synchronizing', desc: 'Persisting to Firestore', icon: FileCheck, color: 'text-blue-500' },
      ]
    : [
        { label: 'Dialogue Parsing', desc: 'Segmenting dialogue & context', icon: Sparkles, color: 'text-indigo-500' },
        { label: 'Action Extraction', desc: 'Mapping deliverables & owners', icon: ListOrdered, color: 'text-emerald-500' },
        { label: 'Ambiguity Audit', desc: 'Auditing vague commitments', icon: ShieldCheck, color: 'text-amber-500' },
        { label: 'Persistence', desc: 'Saving meeting intelligence', icon: FileCheck, color: 'text-blue-500' },
      ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 shadow-sm text-center max-w-2xl mx-auto my-6 transition-colors">
      {/* Icon Badge */}
      <div className="relative w-16 h-16 mx-auto mb-6 flex items-center justify-center">
        <motion.div
          animate={shouldReduceMotion ? undefined : { scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' as const }}
          className="absolute inset-0 rounded-2xl bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800"
        />
        <div className="relative z-10 text-indigo-600 dark:text-indigo-400">
          {isClarifying ? (
            <BrainCircuit className="w-8 h-8 animate-pulse" />
          ) : (
            <Sparkles className="w-8 h-8 animate-pulse" />
          )}
        </div>
      </div>

      <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
        {isClarifying ? 'Re-evaluating Meeting Insights...' : 'Processing Meeting Transcript'}
      </h3>

      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
        {statusMessage}
      </p>

      {/* Indeterminate smooth pulse bar */}
      <div className="w-full max-w-xs mx-auto h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-8">
        <motion.div
          animate={shouldReduceMotion ? undefined : { x: ['-100%', '200%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const }}
          className="w-1/2 h-full bg-indigo-600 dark:bg-indigo-500 rounded-full"
        />
      </div>

      {/* Multi-stage AI processing steps */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-left max-w-xl mx-auto">
        {steps.map((s, index) => {
          const Icon = s.icon;
          const isCurrent = activeStep === index;
          return (
            <motion.div
              key={s.label}
              animate={{
                scale: isCurrent ? 1.02 : 1,
                borderColor: isCurrent ? 'rgba(99, 102, 241, 0.6)' : 'rgba(226, 232, 240, 0.8)',
              }}
              transition={{ duration: 0.25 }}
              className={`p-3 rounded-xl border text-left transition-colors ${
                isCurrent
                  ? 'bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-500/60 ring-1 ring-indigo-500/30 shadow-2xs'
                  : 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800/80 opacity-75'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-200 truncate">
                  {s.label}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">
                {s.desc}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
