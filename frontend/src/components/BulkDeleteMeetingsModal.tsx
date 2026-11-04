import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Trash2, X, RefreshCw, Download, ShieldAlert } from 'lucide-react';

interface BulkDeleteMeetingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
  meetingCount: number;
  error?: string | null;
  onExportBackup?: () => void;
}

export const CONFIRMATION_PHRASE = 'DELETE ALL MEETINGS';

export const BulkDeleteMeetingsModal: React.FC<BulkDeleteMeetingsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  meetingCount,
  error,
  onExportBackup,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [confirmInput, setConfirmInput] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset confirmation input on modal open/close
  useEffect(() => {
    if (isOpen) {
      setConfirmInput('');
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || isDeleting) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  const isConfirmed = confirmInput.trim() === CONFIRMATION_PHRASE;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed || isDeleting) return;
    await onConfirm();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          aria-describedby="bulk-delete-desc"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs"
            onClick={!isDeleting ? onClose : undefined}
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
            {/* Close button in top-right */}
            <button
              onClick={onClose}
              disabled={isDeleting}
              aria-label="Close dialog"
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0 pr-6">
                <div className="flex items-center gap-2">
                  <h3
                    id="bulk-delete-title"
                    className="text-base font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Delete All Saved Meetings
                  </h3>
                  <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                    Irreversible
                  </span>
                </div>

                <div id="bulk-delete-desc" className="mt-2 text-xs text-slate-600 dark:text-slate-400 space-y-2.5">
                  <p className="leading-relaxed">
                    This action will permanently delete <strong className="text-slate-900 dark:text-slate-200 font-semibold">{meetingCount} saved meeting{meetingCount !== 1 ? 's' : ''}</strong> from Cloud Firestore, including all transcripts, action items, decisions, and clarification audit logs.
                  </p>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 space-y-2">
                    <div className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                      <ShieldAlert className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                      <span>
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">Account Safety:</strong> Your Firebase account, login credentials, and user profile are <strong className="font-semibold">not</strong> affected or deleted.
                      </span>
                    </div>

                    {onExportBackup && (
                      <div className="flex items-start justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">
                          Recommended: download a JSON backup before proceeding.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onExportBackup();
                          }}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-medium shrink-0"
                        >
                          <Download className="w-3 h-3" />
                          <span>Export Backup</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    To confirm this permanent deletion, please type <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 font-mono font-bold text-[11px] select-all">{CONFIRMATION_PHRASE}</code> below:
                  </p>
                </div>

                {/* Confirmation Input Form */}
                <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                  <div>
                    <input
                      ref={inputRef}
                      type="text"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder={CONFIRMATION_PHRASE}
                      disabled={isDeleting}
                      autoComplete="off"
                      spellCheck="false"
                      className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all disabled:opacity-50"
                    />
                  </div>

                  {error && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isDeleting}
                      className="px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!isConfirmed || isDeleting}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isDeleting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Deleting all meetings...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Permanently Delete All</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

