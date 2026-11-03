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
  Clock
} from 'lucide-react';
import { BackendConnectionState } from '../types';

interface SidebarProps {
  connectionState: BackendConnectionState;
  onRefreshHealth: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  connectionState,
  onRefreshHealth,
  activeTab,
  setActiveTab,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, enabled: true },
    { id: 'meetings', label: 'Meetings', icon: Calendar, enabled: false, badge: 'Phase 2' },
    { id: 'settings', label: 'Settings', icon: Settings, enabled: false, badge: 'Phase 2' },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen select-none shrink-0">
      {/* Brand Logo & Name */}
      <div className="p-5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-100 text-base tracking-tight leading-tight">
              MeetMind AI
            </h1>
            <p className="text-xs text-slate-400">Meeting-to-Action</p>
          </div>
        </div>
        <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md">
          Phase 1
        </span>
      </div>

      {/* Navigation Links */}
      <div className="p-4 flex-1 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
          Workspace
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => item.enabled && setActiveTab(item.id)}
              disabled={!item.enabled}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                  : item.enabled
                  ? 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  : 'text-slate-400 cursor-not-allowed hover:bg-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.enabled ? 'text-slate-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-slate-400">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Backend Connection Status Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/60">
        <div className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-300">Backend API</span>
            </div>
            <button
              onClick={onRefreshHealth}
              disabled={connectionState.isLoading}
              title="Ping backend health endpoint"
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${connectionState.isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-1">
            {connectionState.isLoading ? (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-xs text-amber-300">Connecting...</span>
              </>
            ) : connectionState.isConnected ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">Online (200 OK)</span>
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-xs text-rose-400 font-medium">Offline</span>
              </>
            )}
          </div>

          <div className="mt-2 text-[11px] text-slate-400 font-mono truncate" title={connectionState.appName || 'No server connection'}>
            {connectionState.appName ? `app: ${connectionState.appName}` : 'FastAPI not responding'}
          </div>
        </div>
      </div>
    </aside>
  );
};
