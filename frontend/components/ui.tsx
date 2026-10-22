'use client';

import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/* TrustieWork shared UI primitives — themed, reused across every page. */
/* ------------------------------------------------------------------ */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ---- Button ---- */
type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink font-semibold border border-ink/10 hover:brightness-95',
  secondary: 'bg-transparent text-ink font-medium border border-ink hover:bg-ink hover:text-bg',
  dark: 'bg-ink text-bg font-semibold hover:bg-ink-3',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger/10 text-danger font-medium border border-danger/30 hover:bg-danger/20',
};

export function Button({
  variant = 'primary',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
        buttonStyles[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition',
        buttonStyles[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ---- Spinner ---- */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/* ---- Card ---- */
export function Card({
  className,
  hover,
  children,
}: {
  className?: string;
  hover?: boolean;
  children: ReactNode;
}) {
  return <div className={cx('card p-5', hover && 'card-hover', className)}>{children}</div>;
}

/* ---- Section heading used inside cards ---- */
export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-lg font-bold tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}

/* ---- Inputs ---- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('input', props.className)} />;
}

/* ---- Badge / StatusChip ---- */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'ink';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border-strong',
  accent: 'bg-accent/50 text-accent-soft border-accent',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  ink: 'bg-ink text-bg border-ink',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        toneStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ---- Tag chip ---- */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-bg-elevated px-2 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

/* ---- Avatar ---- */
export function Avatar({ seed, size = 36 }: { seed: string; size?: number }) {
  // Deterministic gradient from the seed (wallet address / uid).
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (h >> 8) % 360;
  return (
    <span
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${a} 70% 60%), hsl(${b} 70% 45%))`,
      }}
      className="inline-block shrink-0 rounded-full ring-1 ring-ink/20"
    />
  );
}

/* ---- Skeleton ---- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-surface-2', className)} />;
}

/* ---- Empty state ---- */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 border-dashed py-14 text-center">
      <p className="font-display text-lg font-bold text-fg">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

/* ---- Banner (inline alert) ---- */
const bannerStyles: Record<'info' | 'warning' | 'danger' | 'success', string> = {
  info: 'border-border-strong bg-bg-elevated text-fg',
  warning: 'border-warning/40 bg-warning/10 text-fg',
  danger: 'border-danger/40 bg-danger/10 text-fg',
  success: 'border-success/40 bg-success/10 text-fg',
};

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
        bannerStyles[tone],
      )}
    >
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ---- Stat tile (for dark panels) ---- */
export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-[0.12em] text-bg/60">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold leading-none tracking-tight">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-bg/60">{sub}</p>}
    </div>
  );
}

/* ---- Stepper ---- */
export type StepState = 'done' | 'active' | 'todo' | 'error';
export interface StepItem {
  label: string;
  note?: string;
  state: StepState;
}

export function Stepper({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.label} className="relative">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cx(
                'absolute left-8 right-[-1rem] top-[0.9rem] h-px',
                s.state === 'done' ? 'bg-ink' : 'bg-border-strong',
              )}
            />
          )}
          <div className="relative flex items-start gap-2.5">
            <span
              className={cx(
                'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                s.state === 'done' && 'border-ink bg-ink text-accent',
                s.state === 'active' && 'border-ink bg-accent text-ink',
                s.state === 'todo' && 'border-border-strong bg-bg text-faint',
                s.state === 'error' && 'border-danger bg-danger text-white',
              )}
            >
              {s.state === 'done' ? '✓' : s.state === 'error' ? '!' : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cx('text-xs font-semibold', s.state === 'todo' ? 'text-faint' : 'text-fg')}>
                {s.label}
              </p>
              {s.note && <p className="mt-0.5 truncate text-[11px] text-muted">{s.note}</p>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---- Countdown ---- */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Live countdown to a unix-seconds target. */
export function Countdown({ to, className }: { to?: bigint | number | null; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!to || now === null) return <span className={className}>—</span>;
  const ms = Number(to) * 1000 - now;
  return <span className={className}>{ms <= 0 ? 'Expired' : formatRemaining(ms)}</span>;
}

/* ---- Bullet list (job requirements) ---- */
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-2 text-sm text-muted">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
