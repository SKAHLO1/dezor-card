'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { auth, firebaseReady } from '@/lib/firebase';
import { api, type UserProfile } from '@/lib/api';

interface AuthState {
  /** true until the initial Firebase auth check resolves */
  loading: boolean;
  firebaseReady: boolean;
  user: User | null;
  /** backend profile — null if the user has not completed onboarding */
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const refreshProfile = async () => {
    if (!auth?.currentUser) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.get<UserProfile>('/users/me'));
    } catch {
      setProfile(null); // 404 => not onboarded yet
    }
  };

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) await refreshProfile();
      else setProfile(null);
      setLoading(false);
    });
  }, []);

  const signOut = async () => {
    if (auth) await fbSignOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{ loading, firebaseReady, user, profile, refreshProfile, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
