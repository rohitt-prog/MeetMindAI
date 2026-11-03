import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { BackendConnectionState } from './types';
import { apiService } from './services/api';

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    // Default to light mode for a clean, modern SaaS appearance
    const saved = localStorage.getItem('meetmind_theme');
    if (saved) return saved === 'dark';
    return false;
  });

  const [connectionState, setConnectionState] = useState<BackendConnectionState>({
    isConnected: false,
    isLoading: true,
  });

  const checkBackendHealth = useCallback(async () => {
    setConnectionState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      const data = await apiService.getHealth();
      setConnectionState({
        isConnected: data.status === 'ok',
        isLoading: false,
        appName: data.app,
        lastChecked: new Date(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      setConnectionState({
        isConnected: false,
        isLoading: false,
        error: message,
        lastChecked: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    // Sync theme class on <html>
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('meetmind_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('meetmind_theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    // Initial health check on mount
    checkBackendHealth();

    // Periodic heartbeat check every 30 seconds
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  const toggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased transition-colors">
      <Sidebar
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />
      <Dashboard
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
      />
    </div>
  );
}

export default App;
