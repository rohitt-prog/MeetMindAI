import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth, isFirebaseClientConfigured } from '../config/firebase';
import { apiService } from '../services/api';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  isDemoUser?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  authError: string | null;
  isConfigured: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  loginDemo: (email?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Human-friendly translations for Firebase Auth error codes
const formatAuthError = (code: string, fallbackMessage: string): string => {
  switch (code) {
    case 'auth/user-not-found':
      return 'No account found with this email address. Please register first.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please verify your credentials.';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Please sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Access is temporarily restricted. Please try again later.';
    default:
      return fallbackMessage || 'Authentication operation failed.';
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const isConfigured = isFirebaseClientConfigured();

  // Helper to extract token from real Firebase user or demo session
  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (user.isDemoUser) {
      // In demo mode without Firebase client API key, return a mock demo token
      return `demo_token_${user.uid}`;
    }
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        return await currentUser.getIdToken();
      } catch (err) {
        console.error('Failed to retrieve Firebase ID token:', err);
        return null;
      }
    }
    return null;
  }, [user]);

  // Sync token getter with apiService
  useEffect(() => {
    apiService.setAuthTokenGetter(getIdToken);
  }, [getIdToken]);

  // Hook into 401 unauthorized handling from apiService
  useEffect(() => {
    apiService.setOnUnauthorized(() => {
      setAuthError('Your session has expired. Please sign in again.');
      setUser(null);
    });
  }, []);

  // Listen to Firebase auth state changes
  useEffect(() => {
    if (!isConfigured) {
      // Check for saved demo session in sessionStorage
      const savedDemo = sessionStorage.getItem('meetmind_demo_user');
      if (savedDemo) {
        try {
          setUser(JSON.parse(savedDemo));
        } catch {
          sessionStorage.removeItem('meetmind_demo_user');
        }
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser: User | null) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'User'),
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isConfigured]);

  const login = async (email: string, pass: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    try {
      if (!isConfigured) {
        // Fallback to local demo session if client Firebase config is pending
        await loginDemo(email);
        return;
      }
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      setUser({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : 'User'),
      });
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      const formatted = formatAuthError(fbErr.code || '', fbErr.message || 'Login failed.');
      setAuthError(formatted);
      throw new Error(formatted);
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, pass: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    try {
      if (!isConfigured) {
        await loginDemo(email);
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      setUser({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : 'User'),
      });
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      const formatted = formatAuthError(fbErr.code || '', fbErr.message || 'Registration failed.');
      setAuthError(formatted);
      throw new Error(formatted);
    } finally {
      setLoading(false);
    }
  };

  const loginDemo = async (email: string = 'demo@meetmind.ai'): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    const demoUser: AuthUser = {
      uid: 'demo_user_101',
      email: email.trim(),
      displayName: email.split('@')[0] || 'Demo User',
      isDemoUser: true,
    };
    sessionStorage.setItem('meetmind_demo_user', JSON.stringify(demoUser));
    setUser(demoUser);
    setLoading(false);
  };

  const logout = async (): Promise<void> => {
    setLoading(true);
    try {
      if (isConfigured) {
        await signOut(auth);
      }
      sessionStorage.removeItem('meetmind_demo_user');
      setUser(null);
      setAuthError(null);
    } catch (err: unknown) {
      console.error('Logout error:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => {
    setAuthError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        isConfigured,
        login,
        register,
        loginDemo,
        logout,
        clearError,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

