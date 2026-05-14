'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/* SatLock shared UI primitives — themed, reused across every page.    */
/* ------------------------------------------------------------------ */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ---- Button ---- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-accent to-accent-2 text-bg font-semibold hover:opacity-90 shadow-[0_8px_30px_-10px_rgba(124,92,255,0.6)]',
  secondary: 'bg-surface-2 text-fg border border-border-strong hover:border-accent/60',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
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

/* ---- Inputs ---- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">
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
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border-strong',
  accent: 'bg-accent/15 text-accent-soft border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
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
        background: `linear-gradient(135deg, hsl(${a} 70% 60%), hsl(${b} 70% 50%))`,
      }}
      className="inline-block shrink-0 rounded-full ring-1 ring-border-strong"
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
      <p className="font-medium text-fg">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}
