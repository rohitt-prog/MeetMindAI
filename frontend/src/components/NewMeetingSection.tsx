import React, { useState } from 'react';
import { 
  Sparkles, 
  Trash2, 
  Info, 
  AlertCircle, 
  FileText, 
  HelpCircle,
  CopyCheck
} from 'lucide-react';

interface NewMeetingSectionProps {
  inputRef?: React.RefObject<HTMLInputElement>;
}

export const NewMeetingSection: React.FC<NewMeetingSectionProps> = ({ inputRef }) => {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const sampleTranscript = `Project Sync - Mobile App Redesign
Date: October 24, 2026
Attendees: Sarah (Lead), David (Design), Alex (Backend), Priya (QA)

Sarah: Let's review the blockers for the milestone release.
David: The Figma design system tokens are complete. I need Alex to confirm the GraphQL schema changes for user preferences by Thursday.
Alex: I'm waiting on the security review for session expiration. If approved today, I will finalize the endpoint by Wednesday 4 PM.
Priya: We need test credentials for the staging sandbox. Who is provisioning them?
Sarah: I will assign staging access to Priya by tomorrow morning. Alex, please document the authentication fallback plan.`;

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const charCount = transcript.length;

  const handleAnalyzeClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !transcript.trim()) {
      setNoticeMessage('Please enter a meeting title and paste a transcript before requesting analysis.');
      return;
    }
    // As per specification: Display clearly labeled message without simulating AI
    setNoticeMessage(
      'AI analysis will be available in the next development phase. (Phase 2 will integrate the Google Gemini API using google-genai to extract summaries, action items, deadlines, and clarification questions).'
    );
  };

  const handleLoadSample = () => {
    setTitle('Sprint Architecture Review & Milestone Sync');
    setTranscript(sampleTranscript);
    setNoticeMessage(null);
  };

  const handleClear = () => {
    setTitle('');
    setTranscript('');
    setNoticeMessage(null);
  };

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Submit Meeting Transcript
            </h2>
            <p className="text-xs text-slate-400">
              Paste meeting minutes, audio transcription text, or conversation logs.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleLoadSample}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-800/70 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
            title="Load sample transcript for evaluation testing"
          >
            <CopyCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>Load Sample</span>
          </button>

          {(title || transcript) && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-900/40 hover:border-rose-800/70 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 text-xs font-medium transition-colors"
              title="Clear form inputs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleAnalyzeClick} className="mt-5 space-y-4">
        {/* Meeting Title Input */}
        <div>
          <label htmlFor="meeting-title" className="block text-xs font-medium text-slate-300 mb-1.5">
            Meeting Title <span className="text-rose-400">*</span>
          </label>
          <input
            id="meeting-title"
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Weekly Engineering Sync / Architecture Review"
            className="w-full bg-slate-950/90 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
          />
        </div>

        {/* Meeting Transcript Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="meeting-transcript" className="block text-xs font-medium text-slate-300">
              Meeting Transcript / Notes <span className="text-rose-400">*</span>
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {wordCount} words &middot; {charCount} chars
            </span>
          </div>
          <textarea
            id="meeting-transcript"
            rows={8}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste raw transcript here. For example:&#10;Alice: Let's discuss the API spec...&#10;Bob: I'll complete the database migration script by Friday..."
            className="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 text-sm text-slate-100 placeholder:text-slate-400 font-mono text-xs leading-relaxed focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
          />
        </div>

        {/* Action Button & Phase 1 Note */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Phase 1 validates layout, client-server handshake, and input capture.</span>
          </div>

          <button
            type="submit"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-indigo-600/30 transition-all duration-150"
          >
            <Sparkles className="w-4 h-4" />
            <span>Analyze Meeting</span>
          </button>
        </div>
      </form>

      {/* Clearly Labeled Phase 1 Message */}
      {noticeMessage && (
        <div className="mt-4 p-4 rounded-lg bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-3 text-xs animate-in fade-in duration-200">
          <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-indigo-200">Development Phase Notice</p>
            <p className="text-indigo-300/90 leading-relaxed">{noticeMessage}</p>
          </div>
        </div>
      )}

      {/* Info card regarding future phases */}
      <div className="mt-4 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800/70 flex items-start gap-2.5 text-xs text-slate-400">
        <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <p className="leading-relaxed">
          <strong className="text-slate-300">Architecture Scope:</strong> The frontend and backend foundations are linked via REST. AI extraction (Gemini 2.5 Flash via <code className="text-indigo-300 text-[11px]">google-genai</code>) and persistent storage (MongoDB) are reserved for Phase 2.
        </p>
      </div>
    </section>
  );
};
