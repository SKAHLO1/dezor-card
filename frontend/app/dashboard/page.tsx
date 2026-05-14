'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, Protected } from '@/components/AppShell';
import { JobCard } from '@/components/JobCard';
import { Skeleton, EmptyState, LinkButton } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useJobs } from '@/lib/escrow';
import { api, type JobMeta } from '@/lib/api';

function Dashboard() {
  const { profile } = useAuth();
  const wallet = profile?.walletAddress.toLowerCase();
  const [metas, setMetas] = useState<JobMeta[] | null>(null);

  useEffect(() => {
    api.get<{ jobs: JobMeta[] }>('/jobs').then((r) => setMetas(r.jobs)).catch(() => setMetas([]));
  }, []);

  const ids = useMemo(() => (metas ?? []).map((m) => m.onchainId), [metas]);
  const { jobs: onchain } = useJobs(ids);

  const mine = useMemo(() => {
    if (!metas || !wallet) return [];
    return metas.filter((m) => {
      const oc = onchain.get(m.onchainId);
      if (profile?.role === 'buyer') {
        return m.employerWallet?.toLowerCase() === wallet || oc?.employer.toLowerCase() === wallet;
      }
      return oc?.freelancer.toLowerCase() === wallet;
    });
  }, [metas, onchain, wallet, profile?.role]);

  const isBuyer = profile?.role === 'buyer';

  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {isBuyer ? 'Your posted jobs' : 'Your active work'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isBuyer
              ? 'Jobs you funded — track progress, review submissions, release payment.'
              : 'Jobs you claimed — submit deliverables and get paid in MUSD.'}
          </p>
        </div>
        {isBuyer ? (
          <LinkButton href="/jobs/new">Post a job</LinkButton>
        ) : (
          <LinkButton href="/feed" variant="secondary">
            Browse the feed
          </LinkButton>
        )}
      </div>

      {metas === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : mine.length === 0 ? (
        <EmptyState
          title={isBuyer ? 'You haven’t posted any jobs yet' : 'You haven’t claimed any jobs yet'}
          body={
            isBuyer
              ? 'Post your first job and fund it with MUSD or BTC collateral.'
              : 'Head to the feed and claim a job that fits your skills.'
          }
          action={
            <LinkButton href={isBuyer ? '/jobs/new' : '/feed'}>
              {isBuyer ? 'Post a job' : 'Browse jobs'}
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((m) => (
            <JobCard key={m.id} meta={m} job={onchain.get(m.onchainId)} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <Protected>
      <Dashboard />
    </Protected>
  );
}
