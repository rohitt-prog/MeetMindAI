import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: number | string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  iconColor?: string;
  badgeColor?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  label,
  icon: Icon,
  badge = 'Active',
  iconColor = 'text-indigo-600 dark:text-indigo-400',
  badgeColor = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
}) => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700/80 transition-all">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {value}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
          </div>
        </div>
        <div className={`p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50 ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <span>Grounded data</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${badgeColor}`}>
          {badge}
        </span>
      </div>
    </div>
  );
};
