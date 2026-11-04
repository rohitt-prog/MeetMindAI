import React, { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BackendConnectionState, ThemeMode } from '../types';
import { API_BASE_URL } from '../services/api';

interface SettingsProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
  themeMode: ThemeMode;
  onSelectThemeMode: (mode: ThemeMode) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  connectionState,
  onRefreshHealth,
  themeMode,
  onSelectThemeMode,
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
                  className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
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

          {/* Card 3: Upcoming Capabilities (Roadmap) */}
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
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Custom Model Selection</span>
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.5 rounded">Phase 2</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Switch between Gemini 2.5 Flash, Gemini 2.5 Pro, or bring your own API key.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">PDF Export Formatting & Branding</span>
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 px-1.5 py-0.5 rounded">Phase 2</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Custom corporate branding, layout density, and executive summary styles.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Data Management & Account Erasure</span>
                    <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/60 px-1.5 py-0.5 rounded">Phase 3</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bulk export meeting history as JSON/CSV and complete account data erasure.
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
                  <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">
                    Gemini 2.5 Flash
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
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  Enforced per authenticated user on the FastAPI backend using sliding-window rate limiters.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
