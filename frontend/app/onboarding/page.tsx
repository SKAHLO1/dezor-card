'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Protected } from '@/components/AppShell';
import { Button, Card, Field, Input, Textarea } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { api, type UserProfile } from '@/lib/api';

type Role = 'buyer' | 'developer';

function OnboardingForm() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const { address, isConnected } = useAccount();

  const [role, setRole] = useState<Role | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [skills, setSkills] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = !!role && isConnected && !!address && displayName.trim().length > 1;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await api.post<UserProfile>('/users', {
        role,
        walletAddress: address,
        displayName: displayName.trim(),
        bio: bio.trim(),
        skills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await refreshProfile();
      router.replace('/feed');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="font-display text-2xl font-bold">Set up your profile</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Two quick things — pick how you&apos;ll use SatLock and link your Mezo wallet.
      </p>

      {/* role */}
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">I want to…</p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {(
          [
            { id: 'buyer', title: 'Hire developers', body: 'Post jobs, fund escrow, review work.' },
            { id: 'developer', title: 'Work on jobs', body: 'Browse the feed, claim jobs, get paid.' },
          ] as { id: Role; title: string; body: string }[]
        ).map((r) => (
          <button
            key={r.id}
            onClick={() => setRole(r.id)}
            className={`card card-hover text-left ${
              role === r.id ? 'border-accent ring-1 ring-accent/40' : ''
            }`}
          >
            <p className="font-semibold">{r.title}</p>
            <p className="mt-1 text-sm text-muted">{r.body}</p>
          </button>
        ))}
      </div>

      {/* wallet */}
      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Mezo wallet</p>
            <p className="text-sm text-muted">
              {isConnected ? 'Connected — this address holds your escrow funds.' : 'Required to continue.'}
            </p>
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </Card>

      {/* profile */}
      <div className="space-y-4">
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ada Lovelace"
          />
        </Field>
        <Field label="Bio" hint="Optional — shown on your public profile.">
          <Textarea
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={
              role === 'developer'
                ? 'What you build, your stack, notable work…'
                : 'What you typically hire for…'
            }
          />
        </Field>
        <Field label="Skills / tags" hint="Comma-separated, e.g. solidity, react, design.">
          <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="solidity, react, design" />
        </Field>

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">{error}</p>
        )}

        <Button onClick={submit} disabled={!canSubmit} loading={busy} className="w-full">
          {isConnected ? 'Finish setup' : 'Connect a wallet to continue'}
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Protected mode="onboarding">
      <OnboardingForm />
    </Protected>
  );
}
