import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  User,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
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
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
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
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Demo sign-in requires enabling "Anonymous" in Firebase Console (Authentication -> Sign-in method), or configuring VITE_FIREBASE_DEMO_EMAIL and VITE_FIREBASE_DEMO_PASSWORD in frontend/.env.';
    default:
      return fallbackMessage || 'Authentication operation failed.';
  }
};

/**
 * Resolves the current Firebase ID token directly from auth.currentUser or demo session.
 * - If Firebase client is configured, waits for auth.authStateReady() to ensure persistent session is restored.
 * - Extracts token from auth.currentUser with supported forceRefresh parameter.
 * - Does not close over stale React state variables.
 */
export const getFirebaseIdToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  if (isFirebaseClientConfigured()) {
    if (typeof auth.authStateReady === 'function') {
      try {
        await auth.authStateReady();
      } catch (err) {
        console.warn('Error awaiting Firebase authStateReady:', err);
      }
    }

    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        return await currentUser.getIdToken(forceRefresh);
      } catch (err) {
        console.error('Failed to retrieve Firebase ID token:', err);
        return null;
      }
    }

    // When Firebase client is configured, never emit fake demo tokens
    return null;
  }

  // Fallback to active demo session only when client Firebase is completely unconfigured
  const savedDemo = sessionStorage.getItem('meetmind_demo_user');
  if (savedDemo) {
    try {
      const parsed = JSON.parse(savedDemo);
      return parsed.uid ? `demo_token_${parsed.uid}` : null;
    } catch {
      return null;
    }
  }

  return null;
};

// Register stable token getter with apiService immediately on module load
apiService.setAuthTokenGetter(getFirebaseIdToken);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const isConfigured = isFirebaseClientConfigured();

  // Helper to extract token from real Firebase user or demo session
  const getIdToken = useCallback(async (forceRefresh?: boolean): Promise<string | null> => {
    return getFirebaseIdToken(forceRefresh);
  }, []);

  // Ensure token getter is synced with apiService
  useEffect(() => {
    apiService.setAuthTokenGetter(getFirebaseIdToken);
  }, []);

  // Hook into 401 unauthorized handling from apiService
  useEffect(() => {
    apiService.setOnUnauthorized(async () => {
      // Only sign out if there was an active user session to avoid false triggers on startup
      const hasFirebaseUser = Boolean(auth.currentUser);
      const hasDemoUser = Boolean(sessionStorage.getItem('meetmind_demo_user'));
      if (!hasFirebaseUser && !hasDemoUser) {
        return;
      }

      try {
        if (isConfigured) {
          await signOut(auth);
        }
      } catch (err) {
        console.warn('Error signing out after 401:', err);
      }
      sessionStorage.removeItem('meetmind_demo_user');
      setUser(null);
      setAuthError('Your session has expired. Please sign in again.');
    });
  }, [isConfigured]);

  // Listen to Firebase auth state changes using onIdTokenChanged
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

    const unsubscribe = onIdTokenChanged(auth, (firebaseUser: User | null) => {
      if (firebaseUser) {
        const isAnonymous = Boolean(firebaseUser.isAnonymous);
        const hasDemoSession = Boolean(sessionStorage.getItem('meetmind_demo_user'));
        const isDemo = isAnonymous || hasDemoSession;
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email || (isDemo ? 'demo@meetmind.ai' : null),
          displayName:
            firebaseUser.displayName ||
            (isDemo ? 'Demo User' : (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'User')),
          isDemoUser: isDemo,
        });
      } else {
        if (!sessionStorage.getItem('meetmind_demo_user')) {
          setUser(null);
        }
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
        displayName:
          cred.user.displayName ||
          (cred.user.email ? cred.user.email.split('@')[0] : 'User'),
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
        displayName:
          cred.user.displayName ||
          (cred.user.email ? cred.user.email.split('@')[0] : 'User'),
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
    try {
      if (!isConfigured) {
        // Fallback to local session if client Firebase config is not present
        const fallbackDemoUser: AuthUser = {
          uid: 'demo_user_101',
          email: email.trim(),
          displayName: 'Demo User',
          isDemoUser: true,
        };
        sessionStorage.setItem('meetmind_demo_user', JSON.stringify(fallbackDemoUser));
        setUser(fallbackDemoUser);
        return;
      }

      // Check for configured demo user credentials in environment
      const envDemoEmail = (import.meta.env.VITE_FIREBASE_DEMO_EMAIL || '').trim();
      const envDemoPassword = (import.meta.env.VITE_FIREBASE_DEMO_PASSWORD || '').trim();

      if (envDemoEmail && envDemoPassword) {
        try {
          const cred = await signInWithEmailAndPassword(auth, envDemoEmail, envDemoPassword);
          const demoUser: AuthUser = {
            uid: cred.user.uid,
            email: cred.user.email,
            displayName: cred.user.displayName || 'Demo User',
            isDemoUser: true,
          };
          sessionStorage.setItem('meetmind_demo_user', JSON.stringify(demoUser));
          setUser(demoUser);
          return;
        } catch (credErr: unknown) {
          const fbErr = credErr as { code?: string; message?: string };
          if (fbErr.code === 'auth/user-not-found' || fbErr.code === 'auth/invalid-credential') {
            try {
              const newCred = await createUserWithEmailAndPassword(auth, envDemoEmail, envDemoPassword);
              const demoUser: AuthUser = {
                uid: newCred.user.uid,
                email: newCred.user.email,
                displayName: 'Demo User',
                isDemoUser: true,
              };
              sessionStorage.setItem('meetmind_demo_user', JSON.stringify(demoUser));
              setUser(demoUser);
              return;
            } catch (createErr) {
              console.warn('Demo user auto-provisioning failed; falling back to anonymous auth:', createErr);
            }
          } else {
            console.warn('Demo credential sign-in failed; falling back to anonymous auth:', fbErr);
          }
        }
      }

      // Default: Authenticate anonymously with Firebase
      const anonCred = await signInAnonymously(auth);
      const anonDemoUser: AuthUser = {
        uid: anonCred.user.uid,
        email: 'demo@meetmind.ai',
        displayName: 'Demo User',
        isDemoUser: true,
      };
      sessionStorage.setItem('meetmind_demo_user', JSON.stringify(anonDemoUser));
      setUser(anonDemoUser);
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      const formatted = formatAuthError(fbErr.code || '', fbErr.message || 'Demo sign-in failed.');
      setAuthError(formatted);
      throw new Error(formatted);
    } finally {
      setLoading(false);
    }
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

