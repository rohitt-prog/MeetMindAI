import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Trash2, X, RefreshCw } from 'lucide-react';

interface DeleteMeetingModalProps {
  isOpen: boolean;
  meetingId: string | null;
  meetingTitle?: string | null;
  onClose: () => void;
  onConfirm: (meetingId: string) => Promise<void>;
  isDeleting: boolean;
  error?: string | null;
}

export const DeleteMeetingModal: React.FC<DeleteMeetingModalProps> = ({
  isOpen,
  meetingId,
  meetingTitle,
  onClose,
  onConfirm,
  isDeleting,
  error,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus delete button on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        deleteButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key
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

  const handleConfirm = async () => {
    if (!meetingId || isDeleting) return;
    await onConfirm(meetingId);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-meeting-title"
          aria-describedby="delete-meeting-desc"
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
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 z-10 overflow-hidden"
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

              <div className="flex-1 pr-4">
                <h3
                  id="delete-meeting-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  Delete this meeting?
                </h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {meetingTitle || 'Untitled Meeting'}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p
                id="delete-meeting-desc"
                className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
              >
                This will permanently delete the saved transcript, analysis, action items, clarifications, and follow-ups associated with this meeting. This action cannot be undone.
              </p>

              {error && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
                  <p className="font-medium">Failed to delete meeting</p>
                  <p className="mt-0.5 text-[11px] opacity-90">{error}</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                ref={deleteButtonRef}
                type="button"
                onClick={handleConfirm}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete meeting</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
