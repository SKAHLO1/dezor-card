'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, firebaseReady } from '@/lib/firebase';
import { Button, Field, Input } from '@/components/ui';
import { AuthLayout, ConfigNotice, friendly } from '@/app/login/page';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New accounts always go through onboarding next — that is where the
  // mandatory Mezo wallet gets linked.
  const finish = () => router.replace('/onboarding');

  const withEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError(null);
    if (password !== confirm) return setError('Passwords do not match.');
    if (password.length < 6) return setError('Password should be at least 6 characters.');
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
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
    <AuthLayout
      title="Create your account"
      subtitle="You'll connect a Mezo wallet on the next step — it's required to use SatLock."
    >
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
        <Field label="Password" hint="At least 6 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
          />
        </Field>
        {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} disabled={!firebaseReady} className="w-full">
          Create account
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="secondary" onClick={withGoogle} disabled={!firebaseReady || busy} className="w-full">
        Continue with Google
      </Button>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-accent-soft hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
