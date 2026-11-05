import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Upload,
  X,
  RefreshCw,
  FileCheck,
  AlertCircle,
  Database,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { ConflictStrategy } from '../types';

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (conflictStrategy: ConflictStrategy) => Promise<void>;
  isRestoring: boolean;
  filename: string;
  fileSize: number;
  summary: {
    totalMeetings: number;
    totalActionItems: number;
    totalDecisions: number;
    exportedAt?: string;
    version: string;
  };
  error?: string | null;
}

export const RestoreBackupModal: React.FC<RestoreBackupModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isRestoring,
  filename,
  fileSize,
  summary,
  error,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip');
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus confirm button when opened
  useEffect(() => {
    if (isOpen) {
      setConflictStrategy('skip');
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || isRestoring) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRestoring, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestoring) return;
    await onConfirm(conflictStrategy);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formattedExportDate = summary.exportedAt
    ? new Date(summary.exportedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown date';

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-backup-title"
          aria-describedby="restore-backup-desc"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs"
            onClick={!isRestoring ? onClose : undefined}
          />

          {/* Modal Card */}
          <motion.div
            ref={modalRef}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', duration: 0.25, bounce: 0.1 }}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 z-10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              disabled={isRestoring}
              aria-label="Close dialog"
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header Icon + Titles */}
            <div className="flex items-start gap-3.5 mb-5">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                <FileCheck className="w-5 h-5" />
              </div>
              <div className="pr-6">
                <h3
                  id="restore-backup-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug"
                >
                  Restore Meetings from Backup
                </h3>
                <p id="restore-backup-desc" className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Import meeting records, action items, decisions, and history from your JSON backup file.
                </p>
              </div>
            </div>

            {/* File & Backup Metadata Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 space-y-3 mb-4">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300 truncate max-w-[70%]">
                  <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="truncate">{filename}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                  {formatBytes(fileSize)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                <div className="text-center p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-mono uppercase">Meetings</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                    {summary.totalMeetings}
                  </p>
                </div>
                <div className="text-center p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-mono uppercase">Action Items</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                    {summary.totalActionItems}
                  </p>
                </div>
                <div className="text-center p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-mono uppercase">Decisions</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                    {summary.totalDecisions}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <span>Exported: {formattedExportDate}</span>
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  v{summary.version}
                </span>
              </div>
            </div>

            {/* Conflict Strategy Selector */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Conflict Resolution Strategy
                </label>

                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      conflictStrategy === 'skip'
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/80 ring-1 ring-indigo-400/30'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value="skip"
                      checked={conflictStrategy === 'skip'}
                      onChange={() => setConflictStrategy('skip')}
                      disabled={isRestoring}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="text-xs">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        Skip existing meetings <span className="text-indigo-600 dark:text-indigo-400 font-normal">(Recommended)</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        If a meeting already exists in your account with the same ID, keep your current version untouched.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      conflictStrategy === 'overwrite'
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/80 ring-1 ring-indigo-400/30'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value="overwrite"
                      checked={conflictStrategy === 'overwrite'}
                      onChange={() => setConflictStrategy('overwrite')}
                      disabled={isRestoring}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="text-xs">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        Overwrite existing meetings
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Replace any existing meetings in your account with the updated records from this backup file.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Security & Data note */}
              <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Restored meetings are securely associated with your authenticated account. External credentials or tokens are never restored.
                </span>
              </div>

              {/* Error Callout if error exists */}
              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-300"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{error}</p>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isRestoring}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  ref={confirmButtonRef}
                  type="submit"
                  disabled={isRestoring}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isRestoring ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Restoring Meetings...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>Restore {summary.totalMeetings} Meeting{summary.totalMeetings === 1 ? '' : 's'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
