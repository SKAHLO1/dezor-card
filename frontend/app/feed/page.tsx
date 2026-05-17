'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, Protected } from '@/components/AppShell';
import { JobCard } from '@/components/JobCard';
import { Input, Skeleton, EmptyState, LinkButton } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useJobs } from '@/lib/escrow';
import { JobStatus } from '@/lib/contracts';
import { api, type JobMeta } from '@/lib/api';
import { isEscrowConfigured } from '@/lib/env';

type Sort = 'newest' | 'budget';

function Feed() {
  const { profile } = useAuth();
  const [metas, setMetas] = useState<JobMeta[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [onlyOpen, setOnlyOpen] = useState(true);

  useEffect(() => {
    api.get<{ jobs: JobMeta[] }>('/jobs').then((r) => setMetas(r.jobs)).catch(() => setMetas([]));
  }, []);

  const ids = useMemo(() => (metas ?? []).map((m) => m.onchainId), [metas]);
  const { jobs: onchain } = useJobs(ids);

  const visible = useMemo(() => {
    let list = metas ?? [];
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(needle) ||
          m.description.toLowerCase().includes(needle) ||
          m.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    if (onlyOpen) {
      list = list.filter((m) => {
        const oc = onchain.get(m.onchainId);
        return !oc || oc.status === JobStatus.Open;
      });
    }
    return [...list].sort((a, b) => {
      if (sort === 'budget') return Number(b.budgetMusd ?? 0) - Number(a.budgetMusd ?? 0);
      return b.createdAt - a.createdAt;
    });
  }, [metas, q, sort, onlyOpen, onchain]);

  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Job feed</h1>
          <p className="mt-1 text-sm text-muted">
            {profile?.role === 'developer'
              ? 'Browse open jobs, claim one, and get paid in MUSD when the work lands.'
              : 'Every job posted to the TrustieWork marketplace.'}
          </p>
        </div>
        {profile?.role === 'buyer' && <LinkButton href="/jobs/new">Post a job</LinkButton>}
      </div>

      {!isEscrowConfigured() && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Escrow contract address not set — deploy it and set <code>NEXT_PUBLIC_ESCROW_ADDRESS</code>.
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, description or tags…"
          className="max-w-sm"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="input max-w-[10rem]"
        >
          <option value="newest">Newest</option>
          <option value="budget">Highest budget</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Open only
        </label>
      </div>

      {metas === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No jobs match"
          body={
            (metas?.length ?? 0) === 0
              ? 'Nothing has been posted yet. Check back soon.'
              : 'Try a different search or clear the filters.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => (
            <JobCard key={m.id} meta={m} job={onchain.get(m.onchainId)} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

export default function FeedPage() {
  return (
    <Protected>
      <Feed />
    </Protected>
  );
}
