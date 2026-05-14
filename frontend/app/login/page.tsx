'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, firebaseReady } from '@/lib/firebase';
import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = () => router.replace('/feed');

  const withEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      finish();
    } catch (err) {
      setError(friendly((err as { code?: string }).code));
      setBusy(false);
    }
  };

  const withGoogle = async () => {
    if (!auth) return;
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      finish();
    } catch (err) {
      setError(friendly((err as { code?: string }).code));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to your SatLock account.">
      {!firebaseReady && <ConfigNotice />}
      <form onSubmit={withEmail} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </Field>
        {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} disabled={!firebaseReady} className="w-full">
          Log in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="secondary" onClick={withGoogle} disabled={!firebaseReady || busy} className="w-full">
        Continue with Google
      </Button>

      <p className="mt-6 text-center text-sm text-muted">
        New to SatLock?{' '}
        <Link href="/signup" className="text-accent-soft hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

/* ---- shared auth scaffolding (used by /login and /signup) ---- */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center font-display text-2xl font-bold">
          Sat<span className="gradient-text">Lock</span>
        </Link>
        <div className="card p-7">
          <h1 className="font-display text-xl font-bold">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ConfigNotice() {
  return (
    <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
      Firebase is not configured — set the <code>NEXT_PUBLIC_FIREBASE_*</code> variables in{' '}
      <code>.env.local</code>.
    </p>
  );
}

export function friendly(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
