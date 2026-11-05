import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  Shield,
  Key,
  Sun,
  Moon,
  Monitor,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Copy,
  Check,
  Sparkles,
  Mail,
  ShieldCheck,
  Sliders,
  Database,
  Download,
  Trash2,
  UserX,
  Cpu,
  Zap,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BackendConnectionState, ThemeMode, MeetingListItem } from '../types';
import { API_BASE_URL, apiService } from '../services/api';
import {
  exportMeetingsBackup,
  calculateBackupMetrics,
  API_MAX_MEETING_LIMIT,
} from '../services/backupService';
import { BulkDeleteMeetingsModal } from './BulkDeleteMeetingsModal';
import { DeleteAccountModal } from './DeleteAccountModal';

interface SettingsProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
  themeMode: ThemeMode;
  onSelectThemeMode: (mode: ThemeMode) => void;
  onRefreshMeetings?: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  connectionState,
  onRefreshHealth,
  themeMode,
  onSelectThemeMode,
  onRefreshMeetings,
}) => {
  const { user, logout, updateDisplayName, sendPasswordReset } = useAuth();

  // Display Name editing state
  const [displayNameInput, setDisplayNameInput] = useState<string>(user?.displayName || '');
  const [isUpdatingName, setIsUpdatingName] = useState<boolean>(false);
  const [nameMessage, setNameMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Password Reset state
  const [isSendingReset, setIsSendingReset] = useState<boolean>(false);
  const [resetMessage, setResetMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // UID Copy state
  const [copiedUid, setCopiedUid] = useState<boolean>(false);

  const handleCopyUid = async () => {
    if (!user?.uid) return;
    try {
      await navigator.clipboard.writeText(user.uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameMessage(null);
    const trimmed = displayNameInput.trim();
    if (!trimmed) {
      setNameMessage({ text: 'Please enter a valid display name.', isError: true });
      return;
    }
    if (trimmed === user?.displayName) {
      setNameMessage({ text: 'Display name is already set to this value.', isError: false });
      return;
    }

    setIsUpdatingName(true);
    try {
      await updateDisplayName(trimmed);
      setNameMessage({ text: 'Display name updated successfully.', isError: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update display name.';
      setNameMessage({ text: message, isError: true });
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleSendReset = async () => {
    setResetMessage(null);
    setIsSendingReset(true);
    try {
      await sendPasswordReset();
      setResetMessage({
        text: `Password reset email sent to ${user?.email}. Please check your inbox.`,
        isError: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send password reset email.';
      setResetMessage({ text: message, isError: true });
    } finally {
      setIsSendingReset(false);
    }
  };

  // Data Management & Summary state
  const [meetingsSummary, setMeetingsSummary] = useState<MeetingListItem[] | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Backup Export state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    statusText: string;
  } | null>(null);
  const [exportSuccess, setExportSuccess] = useState<{
    filename: string;
    totalMeetings: number;
    totalActionItems: number;
    message: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!user) {
      setMeetingsSummary([]);
      setIsLoadingSummary(false);
      return;
    }
    setIsLoadingSummary(true);
    setSummaryError(null);
    try {
      const data = await apiService.listMeetings(API_MAX_MEETING_LIMIT);
      setMeetingsSummary(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve meeting summary from backend.';
      setSummaryError(msg);
    } finally {
      setIsLoadingSummary(false);
    }
  }, [user]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleExportBackup = async () => {
    if (!user) return;
    setIsExporting(true);
    setExportSuccess(null);
    setExportError(null);
    setExportProgress({ current: 0, total: 0, statusText: 'Initializing backup...' });

    try {
      const result = await exportMeetingsBackup({
        user,
        onProgress: (current, total, statusText) => {
          setExportProgress({ current, total, statusText });
        },
      });

      setExportSuccess({
        filename: result.filename,
        totalMeetings: result.totalMeetings,
        totalActionItems: result.totalActionItems,
        message: `Successfully generated and downloaded backup (${result.totalMeetings} meeting${result.totalMeetings === 1 ? '' : 's'}).`,
      });
      // Also refresh summary to keep totals aligned
      loadSummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred while generating backup.';
      setExportError(msg);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  // Bulk Delete state
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteModalError, setBulkDeleteModalError] = useState<string | null>(null);
  const [bulkDeleteSuccessMessage, setBulkDeleteSuccessMessage] = useState<string | null>(null);

  const refreshMeetingData = async () => {
    try {
      await loadSummary();
    } catch {
      // Ignore refresh error to avoid masking primary deletion error or outcome
    }
    try {
      await onRefreshMeetings?.();
    } catch {
      // Ignore parent callback error
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || isBulkDeleting) return;
    setIsBulkDeleting(true);
    setBulkDeleteModalError(null);
    setBulkDeleteSuccessMessage(null);

    try {
      const response = await apiService.deleteAllMeetings();
      setBulkDeleteSuccessMessage(
        `Successfully deleted ${response.deleted_count} saved meeting${response.deleted_count === 1 ? '' : 's'}.`
      );
      setIsBulkDeleteModalOpen(false);
      await refreshMeetingData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete meetings. Please try again.';
      setBulkDeleteModalError(msg);
      await refreshMeetingData();
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Account Delete state
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);
  const [deleteAccountModalError, setDeleteAccountModalError] = useState<string | null>(null);

  // Model Selection State (Phase 2C)
  const [savedModel, setSavedModel] = useState<string>('gemini-2.5-flash');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [isLoadingPreferences, setIsLoadingPreferences] = useState<boolean>(false);
  const [isSavingModel, setIsSavingModel] = useState<boolean>(false);
  const [modelMessage, setModelMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Bring Your Own API Key (BYOK) State
  const [byokKeyInput, setByokKeyInput] = useState<string>('');
  const [showKeyText, setShowKeyText] = useState<boolean>(false);
  const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);
  const [isKeyActive, setIsKeyActive] = useState<boolean>(Boolean(apiService.getCustomApiKey()));
  const [byokMessage, setByokMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [showByokSection, setShowByokSection] = useState<boolean>(Boolean(apiService.getCustomApiKey()));

  const fetchPreferences = useCallback(async () => {
    setIsLoadingPreferences(true);
    try {
      const prefs = await apiService.getUserPreferences();
      setSavedModel(prefs.selected_model);
      setSelectedModel(prefs.selected_model);
    } catch {
      // In offline or fallback demo mode, maintain current selection
    } finally {
      setIsLoadingPreferences(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleSaveModel = async () => {
    setIsSavingModel(true);
    setModelMessage(null);
    try {
      const res = await apiService.updateUserPreferences(selectedModel);
      setSavedModel(res.selected_model);
      setModelMessage({
        text: `Model preference updated to ${res.selected_model === 'gemini-2.5-pro' ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash'}.`,
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update model preference.';
      setModelMessage({ text: msg, isError: true });
    } finally {
      setIsSavingModel(false);
    }
  };

  const handleCancelModel = () => {
    setSelectedModel(savedModel);
    setModelMessage(null);
  };

  const handleApplyByokKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setByokMessage(null);
    const trimmed = byokKeyInput.trim();
    if (!trimmed) {
      setByokMessage({ text: 'Please enter a valid Gemini API key.', isError: true });
      return;
    }

    setIsValidatingKey(true);
    try {
      await apiService.validateApiKey(trimmed);
      apiService.setCustomApiKey(trimmed);
      setIsKeyActive(true);
      setByokKeyInput('');
      setByokMessage({
        text: 'Custom Gemini API key verified and active for this browser session.',
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to validate Gemini API key.';
      setByokMessage({ text: msg, isError: true });
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleClearByokKey = () => {
    apiService.setCustomApiKey(null);
    setIsKeyActive(false);
    setByokKeyInput('');
    setByokMessage({
      text: 'Custom API key removed. Meeting analysis will use default server credentials.',
      isError: false,
    });
  };

  const handleConfirmDeleteAccount = async () => {
    if (!user || isDeletingAccount) return;
    setIsDeletingAccount(true);
    setDeleteAccountModalError(null);

    try {
      await apiService.deleteAccount();
      setIsDeleteAccountModalOpen(false);
      // Immediately clear local authenticated state and redirect to signed-out screen
      await logout();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account. Please try again.';
      setDeleteAccountModalError(msg);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const metrics = calculateBackupMetrics(meetingsSummary || []);

  // Format creation and login date strings
  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Session active';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Active session';
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Session active';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span>Settings & Preferences</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage your account security, interface theme, and view system diagnostics.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols on lg): Account & Appearance */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card 1: Account & Security */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Account & Security
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Authenticated Firebase identity and account controls
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {/* Account Overview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Email Item */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <span>Email Address</span>
                  </span>
                  <p className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {user?.email || (user?.isDemoUser ? 'demo@meetmind.ai (Demo)' : 'Unregistered')}
                  </p>
                </div>

                {/* Account Type Item */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <ShieldCheck className="w-3 h-3 text-slate-400" />
                    <span>Account Type</span>
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    {user?.isDemoUser ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800/60">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>Demo Account (Instant Access)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/60">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span>Registered Account</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Firebase UID Item */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                      <Key className="w-3 h-3 text-slate-400" />
                      <span>Firebase User ID (UID)</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyUid}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {copiedUid ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy UID</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all">
                    {user?.uid || 'Not available'}
                  </p>
                </div>

                {/* Created Date */}
                <div className="p-3 rounded-lg bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60 text-[11px]">
                  <span className="text-slate-400 dark:text-slate-500">Member Since:</span>{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {formatDate(user?.createdAt)}
                  </span>
                </div>

                {/* Last Sign In */}
                <div className="p-3 rounded-lg bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60 text-[11px]">
                  <span className="text-slate-400 dark:text-slate-500">Last Active Session:</span>{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {formatDate(user?.lastLoginAt)}
                  </span>
                </div>
              </div>

              {/* Edit Display Name Form */}
              <form onSubmit={handleUpdateName} className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Display Name
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      placeholder="Enter your name"
                      maxLength={50}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isUpdatingName || displayNameInput.trim() === user?.displayName}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                  >
                    {isUpdatingName ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Updating...</span>
                      </span>
                    ) : (
                      <span>Save Name</span>
                    )}
                  </button>
                </div>

                {nameMessage && (
                  <p
                    className={`text-[11px] font-medium flex items-center gap-1.5 ${
                      nameMessage.isError ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {nameMessage.isError ? (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{nameMessage.text}</span>
                  </p>
                )}
              </form>

              {/* Password Reset Section (Email accounts only) */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Password Reset
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {user?.isDemoUser
                      ? 'Password management is disabled for temporary demo sessions.'
                      : 'Request a password reset link to be sent to your registered email.'}
                  </p>
                </div>

                {!user?.isDemoUser && user?.email && (
                  <button
                    type="button"
                    onClick={handleSendReset}
                    disabled={isSendingReset}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {isSendingReset ? (
                      <>
                        <span className="w-3 h-3 border-2 border-slate-400/30 border-t-slate-500 rounded-full animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Key className="w-3.5 h-3.5 text-slate-400" />
                        <span>Send Reset Link</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {resetMessage && (
                <p
                  className={`text-[11px] font-medium flex items-center gap-1.5 ${
                    resetMessage.isError ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {resetMessage.isError ? (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{resetMessage.text}</span>
                </p>
              )}

              {/* Sign Out Action */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Workspace Session
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Terminate active session and return to the login screen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>

              {/* Danger Zone: Delete Account & Data */}
              <div className="pt-4 border-t border-rose-100 dark:border-rose-950/60">
                <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <UserX className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      <h3 className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                        Delete Account & Erase All Data
                      </h3>
                      <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50 border border-rose-200 dark:border-rose-800/80 px-1.5 py-0.5 rounded uppercase">
                        Permanent
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
                      Permanently terminates your Firebase login credentials, user profile, and permanently erases all saved meetings. Irreversible.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDeleteAccountModalError(null);
                      setIsDeleteAccountModalOpen(true);
                    }}
                    disabled={isDeletingAccount}
                    className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shrink-0 shadow-xs cursor-pointer"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Delete Account...</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Appearance & Theme */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Sun className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Appearance & Theme
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Customize the interface appearance across Light, Dark, or System mode
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Light Option */}
                <button
                  type="button"
                  onClick={() => onSelectThemeMode('light')}
                  className={`p-4 rounded-xl border text-left transition-all relative ${
                    themeMode === 'light'
                      ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-600/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-600 flex items-center justify-center">
                      <Sun className="w-4 h-4" />
                    </div>
                    {themeMode === 'light' && (
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Light Mode</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Crisp daytime palette with high contrast
                  </p>
                </button>

                {/* Dark Option */}
                <button
                  type="button"
                  onClick={() => onSelectThemeMode('dark')}
                  className={`p-4 rounded-xl border text-left transition-all relative ${
                    themeMode === 'dark'
                      ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-600/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-900 text-indigo-400 flex items-center justify-center">
                      <Moon className="w-4 h-4" />
                    </div>
                    {themeMode === 'dark' && (
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Dark Mode</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Deep slate tones optimized for low-light
                  </p>
                </button>

                {/* System Option */}
                <button
                  type="button"
                  onClick={() => onSelectThemeMode('system')}
                  className={`p-4 rounded-xl border text-left transition-all relative ${
                    themeMode === 'system'
                      ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-600/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                      <Monitor className="w-4 h-4" />
                    </div>
                    {themeMode === 'system' && (
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white">System Auto</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Automatically syncs with your device OS
                  </p>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>
                  {themeMode === 'system'
                    ? 'Theme automatically responds to your operating system appearance preferences.'
                    : `Active preference: ${themeMode === 'dark' ? 'Dark' : 'Light'} theme saved locally.`}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: AI Model & Customization (Phase 2C) */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>AI Model & Customization</span>
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.5 rounded">
                      Phase 2C
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Target Gemini model selection and Bring Your Own API Key (BYOK)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={fetchPreferences}
                disabled={isLoadingPreferences}
                title="Refresh saved preferences"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingPreferences ? 'animate-spin text-indigo-500' : ''}`}
                />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {/* Model Selection Options */}
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2.5">
                  Select Target Model
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Option A: Gemini 2.5 Flash */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedModel('gemini-2.5-flash');
                      setModelMessage(null);
                    }}
                    className={`p-4 rounded-xl border text-left transition-all relative ${
                      selectedModel === 'gemini-2.5-flash'
                        ? 'border-indigo-600 bg-indigo-50/40 dark:border-indigo-500 dark:bg-indigo-950/30 ring-1 ring-indigo-500/50'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-indigo-500" />
                        Gemini 2.5 Flash
                      </span>
                      {selectedModel === 'gemini-2.5-flash' && (
                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Default / Recommended
                    </span>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Sub-second latency, 1M token context, optimized for standard meetings and rapid turnaround.
                    </p>
                    {savedModel === 'gemini-2.5-flash' && (
                      <span className="mt-3 block text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        • Saved Account Default
                      </span>
                    )}
                  </button>

                  {/* Option B: Gemini 2.5 Pro */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedModel('gemini-2.5-pro');
                      setModelMessage(null);
                    }}
                    className={`p-4 rounded-xl border text-left transition-all relative ${
                      selectedModel === 'gemini-2.5-pro'
                        ? 'border-indigo-600 bg-indigo-50/40 dark:border-indigo-500 dark:bg-indigo-950/30 ring-1 ring-indigo-500/50'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                        Gemini 2.5 Pro
                      </span>
                      {selectedModel === 'gemini-2.5-pro' && (
                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                      Higher Reasoning
                    </span>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Deeper analysis for dense, multi-topic, highly technical, or structurally complex meetings.
                    </p>
                    {savedModel === 'gemini-2.5-pro' && (
                      <span className="mt-3 block text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        • Saved Account Default
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Model Save / Cancel Actions */}
              {selectedModel !== savedModel && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                  <span className="text-xs text-slate-600 dark:text-slate-300 flex-1">
                    Unsaved model selection: <strong>{selectedModel === 'gemini-2.5-pro' ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash'}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelModel}
                    disabled={isSavingModel}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveModel}
                    disabled={isSavingModel}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
                  >
                    {isSavingModel ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Save Preference</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {modelMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    modelMessage.isError
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300'
                      : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                  }`}
                >
                  {modelMessage.isError ? (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                  )}
                  <span>{modelMessage.text}</span>
                </div>
              )}

              {/* BYOK Section */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Bring Your Own API Key (BYOK)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Use your personal Google Gemini API key for meeting analysis
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowByokSection(!showByokSection)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                  >
                    {showByokSection ? 'Hide Configuration' : isKeyActive ? 'Manage Key' : 'Configure Key'}
                  </button>
                </div>

                {/* BYOK Status Banner */}
                {isKeyActive && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        Custom BYOK key is <strong>Active</strong> in session memory ({apiService.getCustomApiKey() ? `••••${apiService.getCustomApiKey()!.slice(-4)}` : 'Active'}).
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearByokKey}
                      className="px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium transition-colors"
                    >
                      Remove Key
                    </button>
                  </div>
                )}

                {showByokSection && (
                  <div className="space-y-3 pt-1">
                    {/* Ephemeral Notice */}
                    <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                      <Key className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-amber-950 dark:text-amber-100">
                          Ephemeral Session Memory Handling
                        </p>
                        <p className="leading-relaxed text-[11px] text-amber-900/90 dark:text-amber-200/90">
                          For your security, custom API keys are held exclusively in active browser memory during this session and sent directly over TLS to execute your requests.
                          Your key is <strong>never stored</strong> in localStorage, sessionStorage, cookies, or cloud databases, and must be re-entered if you reload or close the tab.
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleApplyByokKey} className="space-y-2.5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                        Enter Gemini API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showKeyText ? 'text' : 'password'}
                          value={byokKeyInput}
                          onChange={(e) => setByokKeyInput(e.target.value)}
                          placeholder="AIzaSy..."
                          autoComplete="off"
                          spellCheck="false"
                          disabled={isValidatingKey}
                          className="w-full px-3.5 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeyText(!showKeyText)}
                          tabIndex={-1}
                          className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          {showKeyText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <p className="text-[10px] text-slate-400">
                          Backend validates key via lightweight verification probe before activation.
                        </p>
                        <div className="flex items-center gap-2">
                          {isKeyActive && (
                            <button
                              type="button"
                              onClick={handleClearByokKey}
                              disabled={isValidatingKey}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                              Clear Key
                            </button>
                          )}
                          <button
                            type="submit"
                            disabled={isValidatingKey || !byokKeyInput.trim()}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
                          >
                            {isValidatingKey ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Verifying...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Validate & Apply Key</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </form>

                    {byokMessage && (
                      <div
                        className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                          byokMessage.isError
                            ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                        }`}
                      >
                        {byokMessage.isError ? (
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                        )}
                        <span>{byokMessage.text}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 4: Data Management & JSON Backup */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Data Management & Backup
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Meeting intelligence metrics and full JSON export
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadSummary}
                disabled={isLoadingSummary || isExporting}
                title="Refresh meeting metrics"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingSummary ? 'animate-spin text-indigo-500' : ''}`}
                />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {/* Summary Metrics Section */}
              {isLoadingSummary ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 animate-pulse space-y-2"
                    >
                      <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
                      <div className="h-6 w-12 bg-slate-300 dark:bg-slate-700 rounded" />
                      <div className="h-2 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                    </div>
                  ))}
                </div>
              ) : summaryError ? (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-rose-800 dark:text-rose-300">
                        Failed to Load Meeting Summary
                      </p>
                      <p className="text-rose-700 dark:text-rose-400 text-[11px] mt-0.5">
                        {summaryError}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={loadSummary}
                    className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] shrink-0 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Saved Meetings */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500">
                          Saved Meetings
                        </span>
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                            metrics.api_limit_reached
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
                              : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                          }`}
                        >
                          {metrics.api_limit_reached ? 'API Cap' : 'Complete'}
                        </span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white font-mono">
                        {metrics.api_limit_reached ? `${metrics.total_meetings}+` : metrics.total_meetings}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        persisted in Firestore
                      </p>
                    </div>

                    {/* Total Action Items */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500">
                          Action Items
                        </span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                          Extracted
                        </span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white font-mono">
                        {metrics.total_action_items}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        tasks & deliverables
                      </p>
                    </div>

                    {/* Confirmed Decisions */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500">
                          Decisions
                        </span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300/60 dark:border-slate-700">
                          Agreed
                        </span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white font-mono">
                        {metrics.total_decisions}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        explicit agreements
                      </p>
                    </div>
                  </div>

                  {/* Empty State Banner */}
                  {metrics.total_meetings === 0 && (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60 text-center py-6">
                      <Database className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        No Saved Meetings Found
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-sm mx-auto">
                        Transcripts analyzed in the Workspace will automatically be saved and summarized here.
                      </p>
                    </div>
                  )}

                  {/* API Limit Disclosure */}
                  {metrics.api_limit_reached && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-relaxed">
                        <strong className="font-semibold">API Maximum Reached:</strong> The current backend endpoint returns up to {API_MAX_MEETING_LIMIT} meetings per query without pagination. The metrics and export reflect your {metrics.total_meetings} most recent meetings.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* JSON Export Action Section */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Export All Meetings as JSON</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Download complete meeting transcripts, action items, decisions, and clarification audit logs.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportBackup}
                    disabled={isExporting || isLoadingSummary || (meetingsSummary !== null && meetingsSummary.length === 0)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 shrink-0 shadow-sm"
                  >
                    {isExporting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Exporting...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Backup</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Progress bar while exporting */}
                {isExporting && exportProgress && (
                  <div className="space-y-1.5 p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60">
                    <div className="flex items-center justify-between text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                      <span className="truncate max-w-[80%]">{exportProgress.statusText}</span>
                      {exportProgress.total > 0 && (
                        <span className="font-mono text-[10px]">
                          {Math.round((exportProgress.current / exportProgress.total) * 100)}%
                        </span>
                      )}
                    </div>
                    {exportProgress.total > 0 && (
                      <div className="w-full bg-indigo-100 dark:bg-indigo-900/50 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-150"
                          style={{ width: `${Math.min(100, (exportProgress.current / exportProgress.total) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Export Success Message */}
                {exportSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">{exportSuccess.message}</p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 font-mono">
                        Saved: {exportSuccess.filename} • {exportSuccess.totalMeetings} meeting{exportSuccess.totalMeetings === 1 ? '' : 's'} • {exportSuccess.totalActionItems} action item{exportSuccess.totalActionItems === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Export Error Message */}
                {exportError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-300">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Export Failed</p>
                      <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-0.5">{exportError}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Destructive Action: Delete All Meetings */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete All Saved Meetings</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Permanently delete all meeting transcripts and analysis records. Your account login is preserved.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setBulkDeleteModalError(null);
                      setIsBulkDeleteModalOpen(true);
                    }}
                    disabled={isBulkDeleting || isExporting || isLoadingSummary || (meetingsSummary !== null && meetingsSummary.length === 0)}
                    className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-400 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete All Meetings...</span>
                  </button>
                </div>

                {/* Bulk Delete Success Notification */}
                {bulkDeleteSuccessMessage && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">{bulkDeleteSuccessMessage}</p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                        Your meeting repository has been reset. All intelligence metrics now show zero.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 5: Upcoming Capabilities (Roadmap) */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Upcoming Preferences
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Planned customization features for upcoming phases
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">PDF Export Formatting & Branding</span>
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.5 rounded">Phase 2D</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Custom corporate branding, layout density, and executive summary styles.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col on lg): System & API Diagnostics */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xs transition-colors">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    API Diagnostics
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Live FastAPI connection metrics
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRefreshHealth}
                disabled={connectionState.isLoading}
                title="Ping backend health probe"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${connectionState.isLoading ? 'animate-spin text-indigo-500' : ''}`}
                />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {/* Connection Status Pill */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500">
                  Service Availability
                </span>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        connectionState.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {connectionState.isConnected ? 'Online (200 OK)' : 'Offline / Unreachable'}
                    </span>
                  </div>
                  {connectionState.latencyMs !== undefined && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {connectionState.latencyMs} ms
                    </span>
                  )}
                </div>
              </div>

              {/* Server Information */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Application</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {connectionState.appName || 'MeetMind AI'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Version</span>
                  <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                    v1.0.0
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Backend API URL</span>
                  <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {API_BASE_URL}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400">Target Model</span>
                  <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1.5">
                    {savedModel === 'gemini-2.5-pro' ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash'}
                    {isKeyActive && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-[9px] font-sans font-medium">
                        BYOK
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-slate-500 dark:text-slate-400">Payload Ceiling</span>
                  <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    1 MiB / 100k chars
                  </span>
                </div>
              </div>

              {/* Documented Rate Limits Information */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 dark:text-slate-500 block">
                  Documented Rate-Limit Tiers
                </span>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Meeting Analysis</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                      10 / min
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Clarification Resolution</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                      10 / min
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">PDF Report Export</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                      20 / min
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Bulk Meeting Deletion</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                      5 / min
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Account Deletion</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                      5 / min
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  Enforced per authenticated user on the FastAPI backend using sliding-window rate limiters.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Delete Confirmation Modal */}
      <BulkDeleteMeetingsModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => {
          if (!isBulkDeleting) {
            setIsBulkDeleteModalOpen(false);
            setBulkDeleteModalError(null);
          }
        }}
        onConfirm={handleConfirmBulkDelete}
        isDeleting={isBulkDeleting}
        meetingCount={metrics.total_meetings}
        error={bulkDeleteModalError}
        onExportBackup={handleExportBackup}
      />

      {/* Account Deletion Confirmation Modal */}
      <DeleteAccountModal
        isOpen={isDeleteAccountModalOpen}
        onClose={() => {
          if (!isDeletingAccount) {
            setIsDeleteAccountModalOpen(false);
            setDeleteAccountModalError(null);
          }
        }}
        onConfirm={handleConfirmDeleteAccount}
        isDeleting={isDeletingAccount}
        meetingCount={metrics.total_meetings}
        userEmail={user?.email}
        isDemoUser={user?.isDemoUser}
        error={deleteAccountModalError}
        onExportBackup={handleExportBackup}
      />
    </div>
  );
};
