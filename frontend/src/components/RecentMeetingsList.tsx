import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { 
  Calendar, 
  Clock, 
  CheckSquare, 
  HelpCircle, 
  AlertCircle, 
  RefreshCw, 
  ChevronRight, 
  Plus, 
  CheckCircle2,
  FolderOpen,
  Download,
  Trash2
} from 'lucide-react';
import { MeetingListItem } from '../types';
import { apiService } from '../services/api';
import { DeleteMeetingModal } from './DeleteMeetingModal';

interface RecentMeetingsListProps {
  meetings: MeetingListItem[];
  isLoading: boolean;
  error?: string | null;
  activeMeetingId?: string | null;
  onSelectMeeting: (meetingId: string) => void;
  onRefresh: () => void;
  onNewMeetingClick: () => void;
  onDeleteMeeting?: (meetingId: string) => Promise<void>;
  compact?: boolean;
}

export const RecentMeetingsList: React.FC<RecentMeetingsListProps> = ({
  meetings,
  isLoading,
  error,
  activeMeetingId,
  onSelectMeeting,
  onRefresh,
  onNewMeetingClick,
  onDeleteMeeting,
  compact = false,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [targetMeeting, setTargetMeeting] = useState<{ id: string; title?: string | null } | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleOpenDelete = (e: React.MouseEvent, m: MeetingListItem) => {
    e.stopPropagation();
    setDeleteError(null);
    setTargetMeeting({ id: m.meeting_id, title: m.title });
  };

  const handleCloseDelete = () => {
    if (!isDeleting) {
      setTargetMeeting(null);
      setDeleteError(null);
    }
  };

  const handleConfirmDelete = async (meetingId: string) => {
    if (!onDeleteMeeting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteMeeting(meetingId);
      setTargetMeeting(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete meeting.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleQuickExport = async (e: React.MouseEvent, meetingId: string) => {
    e.stopPropagation();
    setExportingId(meetingId);
    try {
      const { blob, filename } = await apiService.exportSavedMeetingPdf(meetingId);
      apiService.downloadBlob(blob, filename);
    } catch (err: unknown) {
      console.error('Failed to export PDF:', err);
    } finally {
      setExportingId(null);
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Compact Sidebar Variant
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          <span>Recent Meetings</span>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5 rounded cursor-pointer"
            title="Refresh saved meetings"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error ? (
          <div className="px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800/50">
            Persistence unavailable
          </div>
        ) : isLoading && meetings.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin mx-auto mb-1 text-slate-400" />
            <span>Loading...</span>
          </div>
        ) : meetings.length === 0 ? (
          <div className="px-3 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
            No saved meetings yet
          </div>
        ) : (
          <div className="space-y-1">
            {meetings.slice(0, 5).map((m) => {
              const isActive = activeMeetingId === m.meeting_id;
              return (
                <div
                  key={m.meeting_id}
                  onClick={() => onSelectMeeting(m.meeting_id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-indigo-600 dark:text-white font-medium shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="truncate pr-2 flex-1">
                    <p className="truncate font-medium text-[11px]">
                      {m.title || 'Untitled Meeting'}
                    </p>
                    <span className={`text-[10px] ${isActive ? 'text-slate-300 dark:text-indigo-200' : 'text-slate-400'}`}>
                      {formatTime(m.updated_at || m.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.clarification_required && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Ambiguities pending" />
                    )}
                    {onDeleteMeeting && (
                      <button
                        type="button"
                        onClick={(e) => handleOpenDelete(e, m)}
                        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer ${
                          isActive ? 'text-slate-300 hover:text-white' : 'text-slate-400 hover:text-rose-600 dark:hover:text-rose-400'
                        }`}
                        title="Delete meeting"
                        aria-label="Delete meeting"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DeleteMeetingModal
          isOpen={!!targetMeeting}
          meetingId={targetMeeting?.id || null}
          meetingTitle={targetMeeting?.title}
          onClose={handleCloseDelete}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          error={deleteError}
        />
      </div>
    );
  }

  // Full Dashboard Panel Variant
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-4 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
            <FolderOpen className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Saved Meetings
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reopen previously analyzed transcripts, view deliverables, and track clarifications.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors shadow-2xs disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={onNewMeetingClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Meeting</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={onRefresh}
            className="px-2.5 py-1 rounded bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-800 dark:text-amber-200 font-medium shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : isLoading && meetings.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500 space-y-2">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-500" />
          <p>Loading recent meetings from Firestore...</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
          <Calendar className="w-7 h-7 mx-auto text-slate-400 dark:text-slate-600" />
          <h4 className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
            No saved meetings found
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Analyze a meeting transcript in the workspace above. Analyzed meetings are automatically saved to Firebase Cloud Firestore.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {meetings.map((m) => {
            const isActive = activeMeetingId === m.meeting_id;
            return (
              <motion.div
                key={m.meeting_id}
                whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                transition={{ duration: 0.15, ease: 'easeOut' as const }}
                onClick={() => onSelectMeeting(m.meeting_id)}
                className={`group p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isActive
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/20 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-2xs'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {m.title || 'Untitled Meeting'}
                    </h4>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed mb-3">
                    {m.summary}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center gap-1">
                      <CheckSquare className="w-3 h-3 text-slate-400" />
                      {m.action_items_count}
                    </span>
                    <span>&bull;</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatTime(m.updated_at || m.created_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {m.clarification_required ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                        <HelpCircle className="w-2.5 h-2.5" />
                        {m.unresolved_clarifications_count} open
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Clear
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => handleQuickExport(e, m.meeting_id)}
                      disabled={exportingId === m.meeting_id}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                      title="Download PDF report for this meeting"
                      aria-label="Download PDF report"
                    >
                      {exportingId === m.meeting_id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {onDeleteMeeting && (
                      <button
                        type="button"
                        onClick={(e) => handleOpenDelete(e, m)}
                        className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                        title="Delete meeting"
                        aria-label="Delete meeting"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <DeleteMeetingModal
        isOpen={!!targetMeeting}
        meetingId={targetMeeting?.id || null}
        meetingTitle={targetMeeting?.title}
        onClose={handleCloseDelete}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
};
