'use client';

import Link from 'next/link';
import { Avatar, Badge, Tag } from '@/components/ui';
import { FundingMode, JobStatus, jobStatusLabel, jobStatusTone, type OnchainJob } from '@/lib/contracts';
import { btc, musd, shortAddr, timeLeft } from '@/lib/format';
import type { JobMeta } from '@/lib/api';

export function JobCard({ meta, job }: { meta: JobMeta; job?: OnchainJob }) {
  const status = (job?.status ?? JobStatus.None) as JobStatus;
  const poster = job?.employer ?? meta.employerWallet ?? undefined;
  const isBtc = job ? job.mode === FundingMode.BTC : meta.fundingMode === 'BTC';
  const tags = [...(meta.category ? [meta.category] : []), ...meta.tags].slice(0, 4);

  return (
    <Link href={`/jobs/${meta.onchainId}`} className="card card-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-display text-base font-bold text-ink ring-1 ring-ink/20">
          {meta.title.trim().charAt(0).toUpperCase() || '#'}
        </span>
        {job && <Badge tone={jobStatusTone[status]}>{jobStatusLabel[status]}</Badge>}
      </div>

      <h3 className="font-display text-lg font-bold leading-snug tracking-tight">{meta.title}</h3>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}

      <p className="line-clamp-2 text-sm text-muted">{meta.description || 'No description provided.'}</p>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="font-semibold text-fg">
          {job ? musd(job.amount) : `${meta.budgetMusd ?? '—'} MUSD`}
        </span>
        <span className="text-xs text-muted">{timeLeft(job?.deadline ?? meta.deadline)}</span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5">
          {poster && <Avatar seed={poster} size={18} />}
          {poster ? shortAddr(poster) : 'Unknown poster'}
        </span>
        {isBtc && (
          <span className="rounded bg-ink px-1.5 py-0.5 font-medium text-accent">
            {job && job.btcCollateral > 0n ? `${btc(job.btcCollateral)} collateral` : 'BTC-backed'}
          </span>
        )}
      </div>
    </Link>
  );
}
