import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { BackendConnectionState } from './types';
import { apiService } from './services/api';

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
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
    // Initial health check on mount
    checkBackendHealth();

    // Re-check every 30 seconds
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 antialiased">
      <Sidebar
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
      <Dashboard
        connectionState={connectionState}
        onRefreshHealth={checkBackendHealth}
      />
    </div>
  );
}

export default App;
