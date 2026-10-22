'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatEther } from 'viem';
import { JobCard } from '@/components/JobCard';
import { Skeleton, StatTile } from '@/components/ui';
import { api, type JobMeta, type MarketStats } from '@/lib/api';
import { useJobs } from '@/lib/escrow';
import { JobStatus } from '@/lib/contracts';
import { DEFAULT_BTC_PRICE_USD } from '@/lib/mezo/trove';

const fmt = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

/** Black ledger band — live numbers from the backend `/stats` endpoint (Firestore projection of the chain). */
export function LiveStats() {
  const [stats, setStats] = useState<MarketStats | null | undefined>(undefined);

  useEffect(() => {
    api.get<MarketStats>('/stats').then(setStats).catch(() => setStats(null));
  }, []);

  const btcLocked = stats ? Number(formatEther(BigInt(stats.btcLockedWei))) : 0;
  const musdPaid = stats ? Number(formatEther(BigInt(stats.musdPaidWei))) : 0;
  const loading = stats === undefined;
  // Backend unreachable: show dashes rather than zeros that would read as real numbers.
  const n = (v: string) => (stats ? v : '—');

  return (
    <div className="panel-ink grid gap-6 p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
      {loading ? (
        <div className="col-span-full h-16 animate-pulse rounded-lg bg-ink-3" />
      ) : (
        <>
          <StatTile
            label="Total BTC collateral locked"
            value={
              <>
                {n(fmt(btcLocked, 4))} <span className="text-lg text-accent">BTC</span>
              </>
            }
            sub={stats ? `≈ $${fmt(btcLocked * DEFAULT_BTC_PRICE_USD, 0)} at $${fmt(DEFAULT_BTC_PRICE_USD, 0)}/BTC` : 'Live stats unavailable'}
          />
          <StatTile label="Active jobs" value={n(fmt(stats?.activeJobs ?? 0, 0))} sub={stats ? `${fmt(stats.totalJobs, 0)} posted all-time` : undefined} />
          <StatTile label="Developers paid" value={n(fmt(stats?.developersPaid ?? 0, 0))} sub={stats ? `${fmt(stats.settledJobs, 0)} jobs settled` : undefined} />
          <StatTile
            label="MUSD paid out"
            value={
              <>
                {n(fmt(musdPaid, 0))} <span className="text-lg text-accent">MUSD</span>
              </>
            }
            sub="Released from escrow to developers"
          />
        </>
      )}
    </div>
  );
}

/** Newest open jobs, enriched with on-chain state. */
export function FeaturedJobs() {
  const [metas, setMetas] = useState<JobMeta[] | null>(null);

  useEffect(() => {
    api.get<{ jobs: JobMeta[] }>('/jobs').then((r) => setMetas(r.jobs)).catch(() => setMetas([]));
  }, []);

  const ids = useMemo(() => (metas ?? []).map((m) => m.onchainId), [metas]);
  const { jobs: onchain } = useJobs(ids);

  const featured = useMemo(() => {
    const list = (metas ?? []).filter((m) => {
      const oc = onchain.get(m.onchainId);
      return oc ? oc.status === JobStatus.Open : true;
    });
    // Nothing open right now — show the newest jobs rather than an empty section.
    return (list.length > 0 ? list : (metas ?? [])).slice(0, 3);
  }, [metas, onchain]);

  if (metas === null) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    );
  }
  if (featured.length === 0) {
    return (
      <div className="card border-dashed p-8 text-center text-sm text-muted">
        No open jobs yet — be the first to{' '}
        <Link href="/signup" className="font-semibold text-fg underline">
          post one
        </Link>
        .
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {featured.map((m) => (
        <JobCard key={m.id} meta={m} job={onchain.get(m.onchainId)} />
      ))}
    </div>
  );
}
