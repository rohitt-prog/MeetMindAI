import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle, UserX, X, RefreshCw, Download, ShieldAlert, Sparkles } from 'lucide-react';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
  meetingCount?: number;
  userEmail?: string | null;
  isDemoUser?: boolean;
  error?: string | null;
  onExportBackup?: () => void;
}

export const DELETE_ACCOUNT_CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  meetingCount = 0,
  userEmail,
  isDemoUser = false,
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

  const isConfirmed = confirmInput.trim() === DELETE_ACCOUNT_CONFIRMATION_PHRASE;

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
          aria-labelledby="delete-account-title"
          aria-describedby="delete-account-desc"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            className="fixed inset-0 bg-slate-900/65 dark:bg-slate-950/85 backdrop-blur-xs"
            onClick={!isDeleting ? onClose : undefined}
          />

          {/* Modal Card */}
          <motion.div
            ref={modalRef}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', duration: 0.25, bounce: 0.1 }}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/50 p-6 z-10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Red top warning accent line */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rose-500 via-red-600 to-rose-700" />

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
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <UserX className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0 pr-6">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3
                    id="delete-account-title"
                    className="text-base font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Delete Account & All Data
                  </h3>
                  <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white">
                    Permanent Erasure
                  </span>
                </div>

                <div id="delete-account-desc" className="mt-2 text-xs text-slate-600 dark:text-slate-400 space-y-2.5">
                  <p className="leading-relaxed">
                    This will permanently delete your MeetMind AI account{' '}
                    {userEmail && (
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        ({userEmail})
                      </span>
                    )}{' '}
                    and completely erase all <strong className="text-slate-900 dark:text-slate-200 font-semibold">{meetingCount} saved meeting{meetingCount !== 1 ? 's' : ''}</strong>, transcripts, and intelligence insights.
                  </p>

                  {/* Amber Informational Callout for Demo Accounts */}
                  {isDemoUser && (
                    <div
                      data-testid="demo-account-callout"
                      className="p-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200"
                    >
                      <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed text-[11px]">
                        <strong className="font-semibold text-amber-950 dark:text-amber-100">Demo Account:</strong> Deleting this account permanently wipes this temporary demo session and does not affect any separate registered accounts.
                      </span>
                    </div>
                  )}

                  {/* Warning and Distinction Card */}
                  <div className="p-3.5 rounded-xl bg-rose-50/80 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 space-y-2.5">
                    <div className="flex items-start gap-2 text-[11px] text-rose-900 dark:text-rose-200">
                      <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">
                        <strong className="font-semibold text-rose-950 dark:text-rose-100">Permanent Loss of Access:</strong> Your login credentials, user profile, and authentication records will be destroyed immediately. You will not be able to log back in.
                      </span>
                    </div>

                    <div className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-300 border-t border-rose-200/60 dark:border-rose-900/40 pt-2">
                      <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">Distinct from "Delete All Meetings":</strong> The "Delete All Meetings" action preserves your account credentials and login access. In contrast, <em>Delete Account</em> destroys your account completely.
                      </span>
                    </div>

                    {onExportBackup && (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-rose-200/60 dark:border-rose-900/40 text-[11px]">
                        <span className="text-slate-600 dark:text-slate-400">
                          Recommended: download a JSON backup before proceeding.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onExportBackup();
                          }}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-medium shrink-0 cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>Export Backup</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    To confirm account termination, type{' '}
                    <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 font-mono font-bold text-[11px] select-all">
                      {DELETE_ACCOUNT_CONFIRMATION_PHRASE}
                    </code>{' '}
                    below:
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
                      placeholder={DELETE_ACCOUNT_CONFIRMATION_PHRASE}
                      disabled={isDeleting}
                      autoComplete="off"
                      spellCheck="false"
                      className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border border-rose-300 dark:border-rose-700/80 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 transition-all disabled:opacity-50"
                    />
                  </div>

                  {error && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
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
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isDeleting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Permanently deleting account...</span>
                        </>
                      ) : (
                        <>
                          <UserX className="w-3.5 h-3.5" />
                          <span>Delete My Account</span>
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

