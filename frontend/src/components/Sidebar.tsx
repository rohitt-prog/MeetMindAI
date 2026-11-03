import React from 'react';
import { 
  LayoutDashboard, 
  Calendar, 
  Settings, 
  Sparkles, 
  Activity, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { BackendConnectionState, MeetingListItem } from '../types';
import { RecentMeetingsList } from './RecentMeetingsList';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  recentMeetings?: MeetingListItem[];
  isLoadingMeetings?: boolean;
  meetingsError?: string | null;
  activeMeetingId?: string | null;
  onSelectMeeting?: (meetingId: string) => void;
  onRefreshMeetings?: () => void;
  onDeleteMeeting?: (meetingId: string) => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  connectionState,
  onRefreshHealth,
  activeTab,
  setActiveTab,
  isDarkMode,
  onToggleTheme,
  recentMeetings = [],
  isLoadingMeetings = false,
  meetingsError = null,
  activeMeetingId = null,
  onSelectMeeting,
  onRefreshMeetings,
  onDeleteMeeting,
}) => {
  const { user, logout } = useAuth();
  const navItems = [
    { id: 'dashboard', label: 'Workspace', icon: LayoutDashboard, enabled: true },
    { id: 'meetings', label: 'History', icon: Calendar, enabled: true },
    { id: 'settings', label: 'Settings', icon: Settings, enabled: false, badge: 'Future' },
  ];

  return (
    <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-screen select-none shrink-0 transition-colors duration-150">
      {/* Brand Logo & Name */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-900 dark:text-slate-100 text-sm tracking-tight leading-tight">
              MeetMind AI
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Meeting-to-Action</p>
          </div>
        </div>
        <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-md flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5" />
          <span>v1.0 Ready</span>
        </span>
      </div>

      {/* Navigation Links */}
      <div className="p-4 flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-1">
          <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Navigation
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => item.enabled && setActiveTab(item.id)}
                disabled={!item.enabled}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-indigo-600 dark:text-white shadow-sm'
                    : item.enabled
                    ? 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    : 'text-slate-400 dark:text-slate-500 cursor-not-allowed hover:bg-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Compact Recent Meetings in Sidebar */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <RecentMeetingsList
            compact
            meetings={recentMeetings}
            isLoading={isLoadingMeetings}
            error={meetingsError}
            activeMeetingId={activeMeetingId}
            onSelectMeeting={(id) => onSelectMeeting && onSelectMeeting(id)}
            onRefresh={() => onRefreshMeetings && onRefreshMeetings()}
            onNewMeetingClick={() => setActiveTab('dashboard')}
            onDeleteMeeting={onDeleteMeeting}
          />
        </div>
      </div>

      {/* Theme Switcher & Backend Status Footer */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 space-y-3">
        {/* User Account Card */}
        {user && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {user.displayName || (user.email ? user.email.split('@')[0] : 'User')}
                </p>
                <p className="text-[9px] text-slate-400 truncate">{user.email || user.uid}</p>
              </div>
            </div>
            <button
              onClick={() => logout()}
              title="Sign Out"
              className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Theme Toggle Button */}
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium transition-colors shadow-2xs"
          title="Toggle Light / Dark mode"
        >
          <div className="flex items-center gap-2">
            {isDarkMode ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
            <span>{isDarkMode ? 'Dark Theme' : 'Light Theme'}</span>
          </div>
          <span className="text-[10px] uppercase font-mono text-slate-400 dark:text-slate-500">Switch</span>
        </button>

        {/* Backend Connection Card */}
        <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 p-3 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">FastAPI API</span>
            </div>
            <button
              onClick={onRefreshHealth}
              disabled={connectionState.isLoading}
              title="Ping backend health endpoint"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${connectionState.isLoading ? 'animate-spin text-indigo-600 dark:text-indigo-400' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {connectionState.isLoading ? (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                <span className="text-xs text-amber-600 dark:text-amber-300 font-medium">Connecting...</span>
              </>
            ) : connectionState.isConnected ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Online (200 OK)</span>
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-rose-500" />
                <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">Offline</span>
              </>
            )}
          </div>

          <div className="mt-1 text-[11px] text-slate-400 font-mono truncate" title={connectionState.appName || 'No server connection'}>
            {connectionState.appName ? `app: ${connectionState.appName}` : 'FastAPI not responding'}
          </div>
        </div>
      </div>
    </aside>
  );
};
