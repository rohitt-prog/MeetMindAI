import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: number | string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  iconColor?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  label,
  icon: Icon,
  badge = 'Phase 1 State',
  iconColor = 'text-indigo-400',
}) => {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 hover:border-slate-700/80 transition-all duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">{title}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-100">{value}</span>
            <span className="text-xs text-slate-400">{label}</span>
          </div>
        </div>
        <div className={`p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/50 ${iconColor}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <span>No fabricated records</span>
        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
          {badge}
        </span>
      </div>
    </div>
  );
};
