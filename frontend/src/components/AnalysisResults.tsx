import React, { useState } from 'react';
import { 
  Sparkles, 
  CheckSquare, 
  CheckCircle2, 
  MessageSquare, 
  User, 
  UserX, 
  Calendar, 
  CalendarX, 
  Copy, 
  Check, 
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { 
  MeetingAnalysisResponse, 
  ClarificationAnswer 
} from '../types';
import { ClarificationSection } from './ClarificationSection';

interface AnalysisResultsProps {
  analysis: MeetingAnalysisResponse;
  meetingTitle?: string | null;
  onClarify: (answers: ClarificationAnswer[]) => Promise<void>;
  isClarifying: boolean;
  clarificationError?: string | null;
  onClearClarificationError?: () => void;
  onResetMeeting: () => void;
}

export const AnalysisResults: React.FC<AnalysisResultsProps> = ({
  analysis,
  meetingTitle,
  onClarify,
  isClarifying,
  clarificationError,
  onClearClarificationError,
  onResetMeeting,
}) => {
  const [copiedSummary, setCopiedSummary] = useState(false);

  const handleCopySummary = () => {
    navigator.clipboard.writeText(analysis.summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const unresolvedClarifications = analysis.clarifications.filter((c) => !c.resolved);
  const totalActionItems = analysis.action_items.length;
  const unassignedOwners = analysis.action_items.filter((a) => !a.owner).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top action / summary bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
              Analysis Results
            </span>
            {unresolvedClarifications.length > 0 ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {unresolvedClarifications.length} Ambiguity Pending
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                All Clarified & Verified
              </span>
            )}
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
            {meetingTitle || 'Meeting Intelligence Overview'}
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onResetMeeting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors shadow-2xs"
            title="Start analyzing another meeting"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Transcript</span>
          </button>
        </div>
      </div>

      {/* Grid: Summary & Discussion Points */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Executive Summary (2 columns) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-4 h-4" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Executive Summary
                </h3>
              </div>
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                title="Copy summary to clipboard"
              >
                {copiedSummary ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSummary ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-normal">
              {analysis.summary}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-4 text-[11px] text-slate-400 dark:text-slate-500">
            <span>{totalActionItems} action item{totalActionItems === 1 ? '' : 's'}</span>
            <span>&bull;</span>
            <span>{analysis.decisions.length} confirmed decision{analysis.decisions.length === 1 ? '' : 's'}</span>
            <span>&bull;</span>
            <span>{unassignedOwners} unassigned</span>
          </div>
        </div>

        {/* Confirmed Decisions (1 column) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xs">
          <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800/80 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Confirmed Decisions
            </h3>
          </div>

          {analysis.decisions.length > 0 ? (
            <ul className="space-y-2.5">
              {analysis.decisions.map((decision, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{decision}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">
              No formal decisions confirmed in this meeting transcript.
            </p>
          )}
        </div>
      </div>

      {/* Action Items Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xs">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Assigned Action Items & Deliverables ({analysis.action_items.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Zero fabricated entries</span>
        </div>

        {analysis.action_items.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {analysis.action_items.map((item, index) => {
              const hasRelatedClarification = unresolvedClarifications.some(
                (c) => c.related_action_item_id === item.id
              );

              return (
                <div
                  key={item.id || index}
                  className="py-3 sm:py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-[10px] font-mono text-slate-400 mt-0.5 shrink-0">
                      #{index + 1}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-snug">
                        {item.task}
                      </p>
                      {hasRelatedClarification && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          Ambiguity detected for this task &mdash; see clarifications below
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Badges: Owner, Deadline, Status */}
                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center flex-wrap">
                    {/* Owner badge */}
                    {item.owner ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{item.owner}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                        <UserX className="w-3 h-3 text-amber-500" />
                        <span>Unassigned</span>
                      </span>
                    )}

                    {/* Deadline badge */}
                    {item.deadline ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <span>{item.deadline}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-800">
                        <CalendarX className="w-3 h-3" />
                        <span>No deadline</span>
                      </span>
                    )}

                    {/* Status badge */}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                      {item.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            No actionable tasks were identified in this transcript.
          </p>
        )}
      </div>

      {/* Discussion Points Section */}
      {analysis.discussion_points.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xs">
          <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800/80 text-slate-900 dark:text-slate-100">
            <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Key Discussion Points ({analysis.discussion_points.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.discussion_points.map((point, index) => (
              <div
                key={index}
                className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5"
              >
                <span className="w-4 h-4 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{point}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clarification Section */}
      <ClarificationSection
        clarifications={analysis.clarifications}
        onClarify={onClarify}
        isClarifying={isClarifying}
        clarificationError={clarificationError}
        onClearClarificationError={onClearClarificationError}
      />
    </div>
  );
};

