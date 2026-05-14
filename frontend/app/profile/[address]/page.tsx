'use client';

import { use, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card, Badge, Avatar, Skeleton, EmptyState } from '@/components/ui';
import { Stars } from '@/components/Stars';
import { api, type UserProfile, type Review } from '@/lib/api';
import { shortAddr, explorerAddr } from '@/lib/format';

function Profile({ address }: { address: string }) {
  const [data, setData] = useState<{ user: UserProfile; reviews: Review[] } | null | 'error'>(null);

  useEffect(() => {
    api
      .get<{ user: UserProfile; reviews: Review[] }>(`/users/${address}`)
      .then(setData)
      .catch(() => setData('error'));
  }, [address]);

  if (data === null) {
    return (
      <AppShell>
        <Skeleton className="h-32" />
      </AppShell>
    );
  }

  if (data === 'error') {
    return (
      <AppShell>
        <EmptyState
          title="Profile not found"
          body={`No SatLock user is linked to ${shortAddr(address)}.`}
        />
      </AppShell>
    );
  }

  const { user, reviews } = data;

  return (
    <AppShell>
      <Card className="flex items-start gap-4">
        <Avatar seed={user.walletAddress} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold">{user.displayName || 'Anonymous'}</h1>
            <Badge tone="accent">{user.role === 'developer' ? 'Developer' : 'Buyer'}</Badge>
          </div>
          <a
            href={explorerAddr(user.walletAddress)}
            target="_blank"
            className="text-sm text-faint hover:underline"
          >
            {shortAddr(user.walletAddress)}
          </a>
          {user.bio && <p className="mt-2 text-sm text-muted">{user.bio}</p>}
          {user.skills?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {user.skills.map((s) => (
                <span key={s} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  {s}
                </span>
              ))}
            </div>
          )}
          {user.role === 'developer' && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Stars value={user.avgRating} />
              <span className="text-muted">
                {user.avgRating ? user.avgRating.toFixed(2) : '—'} · {user.ratingCount ?? 0} review
                {user.ratingCount === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </Card>

      {user.role === 'developer' && (
        <>
          <h2 className="mb-3 mt-8 font-display text-lg font-bold">Reviews</h2>
          {reviews.length === 0 ? (
            <EmptyState title="No reviews yet" body="Completed and approved jobs will show up here." />
          ) : (
            <div className="space-y-3">
              {reviews.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-center justify-between">
                    <Stars value={r.rating} />
                    <span className="text-xs text-faint">
                      from {shortAddr(r.fromWallet ?? '')} · job #{r.jobId}
                    </span>
                  </div>
                  {r.text && <p className="mt-2 text-sm text-muted">{r.text}</p>}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  return <Profile address={address} />;
}
