'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui';
import { JobStatus, jobStatusLabel, jobStatusTone, type OnchainJob } from '@/lib/contracts';
import { musd, timeLeft } from '@/lib/format';
import type { JobMeta } from '@/lib/api';

export function JobCard({ meta, job }: { meta: JobMeta; job?: OnchainJob }) {
  const status = (job?.status ?? JobStatus.None) as JobStatus;
  return (
    <Link href={`/jobs/${meta.onchainId}`} className="card card-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug">{meta.title}</h3>
        {job && <Badge tone={jobStatusTone[status]}>{jobStatusLabel[status]}</Badge>}
      </div>

      <p className="line-clamp-2 text-sm text-muted">{meta.description || 'No description provided.'}</p>

      {meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="font-semibold text-fg">{job ? musd(job.amount) : `${meta.budgetMusd ?? '—'} MUSD`}</span>
        <span className="text-faint">
          {meta.fundingMode === 'BTC' && (
            <span className="mr-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent-soft">BTC-backed</span>
          )}
          {timeLeft(job?.deadline ?? meta.deadline)}
        </span>
      </div>
    </Link>
  );
}
