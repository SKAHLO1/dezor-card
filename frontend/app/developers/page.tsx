'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Avatar, Badge, Card, EmptyState, Input, Skeleton, Tag } from '@/components/ui';
import { Stars } from '@/components/Stars';
import { api, type UserProfile } from '@/lib/api';
import { shortAddr } from '@/lib/format';

/** Public directory of developers, ranked by on-chain-backed reputation. */
export default function DevelopersPage() {
  const [devs, setDevs] = useState<UserProfile[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api
      .get<{ users: UserProfile[] }>('/users?role=developer')
      .then((r) => setDevs(r.users))
      .catch(() => setDevs([]));
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (devs ?? []).filter(
      (d) =>
        !needle ||
        d.displayName?.toLowerCase().includes(needle) ||
        d.bio?.toLowerCase().includes(needle) ||
        d.skills?.some((s) => s.toLowerCase().includes(needle)),
    );
    return [...list].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
  }, [devs, q]);

  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Talent</p>
          <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">Developers</h1>
          <p className="mt-1 text-sm text-muted">Reputation comes from on-chain ratings left after payment.</p>
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, bio or skill…"
          className="max-w-xs"
        />
      </div>

      {devs === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No developers found"
          body={devs.length === 0 ? 'No developers have joined yet.' : 'Try a different search.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => (
            <Link key={d.id} href={`/profile/${d.walletAddress}`}>
              <Card hover className="h-full">
                <div className="flex items-center gap-3">
                  <Avatar seed={d.walletAddress} size={44} />
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-bold leading-tight">
                      {d.displayName || 'Anonymous'}
                    </p>
                    <p className="text-xs text-faint">{shortAddr(d.walletAddress)}</p>
                  </div>
                </div>
                {d.bio && <p className="mt-3 line-clamp-2 text-sm text-muted">{d.bio}</p>}
                {d.skills?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {d.skills.slice(0, 5).map((s) => (
                      <Tag key={s}>{s}</Tag>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
                  <Stars value={d.avgRating ?? 0} />
                  <span>
                    {d.avgRating ? d.avgRating.toFixed(2) : 'No ratings'} · {d.ratingCount ?? 0} review
                    {d.ratingCount === 1 ? '' : 's'}
                  </span>
                  {d.avgRating >= 4.5 && d.ratingCount >= 3 && <Badge tone="accent">Top rated</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
