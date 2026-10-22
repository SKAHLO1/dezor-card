import Image from 'next/image';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { FeaturedJobs, LiveStats } from '@/components/landing';
import { LinkButton } from '@/components/ui';

const trust = [
  { k: 'BTC Collateral', v: 'Through Mezo Troves', icon: '₿' },
  { k: 'MUSD Escrow', v: 'Stable settlement', icon: '$' },
  { k: 'AI Verification', v: 'Gemini + GitHub', icon: '✦' },
  { k: 'Human Appeal', v: '3-day window', icon: '⚖' },
];

const steps = [
  { n: 1, title: 'Lock BTC', note: 'via Mezo Trove', icon: '₿' },
  { n: 2, title: 'Mint MUSD', note: '& fund escrow', icon: '$' },
  { n: 3, title: 'Submit work', note: 'GitHub repo', icon: '↗' },
  { n: 4, title: 'AI verification', note: 'Gemini review', icon: '✦' },
  { n: 5, title: 'Get paid', note: 'in MUSD', icon: '✓' },
];

const compare = [
  ['10–20% fees', 'Minimal protocol fees'],
  ['Centralized dispute resolution', 'Smart contract escrow'],
  ['Fiat-only settlement', 'Bitcoin-backed stable settlement'],
  ['Manual review process', 'AI-assisted verification'],
  ['Delayed payments', 'Automated payouts'],
  ['Chargeback risk', 'Final blockchain settlement'],
];

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <path d="M20 0 C21.5 13 27 18.5 40 20 C27 21.5 21.5 27 20 40 C18.5 27 13 21.5 0 20 C13 18.5 18.5 13 20 0Z" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Nav />

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-12 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div>
          <p className="eyebrow">Bitcoin-native freelance marketplace</p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            Trust the Work.
            <br />
            <span className="text-accent-2">Bank on Bitcoin.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            The first AI-verified developer marketplace on Bitcoin and Mezo. Lock BTC as collateral,
            fund jobs with MUSD, and pay only when work is verified.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/feed" className="px-5 py-3">
              Explore work <span aria-hidden>→</span>
            </LinkButton>
            <LinkButton href="/signup" variant="secondary" className="px-5 py-3">
              Create an account
            </LinkButton>
          </div>

          <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {trust.map((t) => (
              <li key={t.k} className="flex flex-col gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ink text-sm font-bold">
                  {t.icon}
                </span>
                <span className="text-xs font-semibold">{t.k}</span>
                <span className="-mt-1.5 text-[11px] text-muted">{t.v}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* robot panel */}
        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <div className="absolute -right-3 -top-3 h-[78%] w-[72%] rounded-[1.75rem] bg-accent-2 sm:-right-5 sm:-top-5" />
          <div className="relative aspect-[5/5.2] overflow-hidden rounded-[1.75rem] bg-ink shadow-[0_30px_60px_-30px_rgba(16,18,13,0.7)]">
            <Image
              src="/images/hero-robot.webp"
              alt="An AI agent with a porcelain-white face and amber lights in profile"
              fill
              priority
              sizes="(min-width: 1024px) 520px, 90vw"
              className="-scale-x-100 object-cover object-[30%_40%]"
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/80 to-transparent" />
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-bg/95 px-3 py-1.5 text-xs font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-success" />
              Every deliverable verified by Gemini
            </div>
          </div>
          <span className="absolute -left-4 top-8 flex h-16 w-16 items-center justify-center rounded-full bg-ink text-3xl font-bold text-accent-2 ring-4 ring-bg sm:h-20 sm:w-20 sm:text-4xl">
            ₿
          </span>
          <Sparkle className="absolute -bottom-4 right-8 h-10 w-10 text-accent" />
        </div>
      </section>

      {/* ledger band */}
      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <LiveStats />
      </section>

      {/* featured jobs */}
      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-display text-3xl font-bold tracking-tight">Featured jobs</h2>
          <Link href="/feed" className="text-sm font-semibold hover:underline">
            View all →
          </Link>
        </div>
        <FeaturedJobs />
      </section>

      {/* how it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16 sm:px-6">
        <h2 className="font-display text-3xl font-bold tracking-tight">How it works</h2>
        <p className="mt-2 text-sm text-muted">
          From BTC collateral to verified work — enforced on-chain, reviewed by AI.
        </p>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s) => (
            <li key={s.n} className="flex items-center gap-4 lg:flex-col lg:items-start">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-ink bg-accent text-xl font-bold">
                {s.icon}
              </span>
              <div>
                <p className="text-sm font-semibold">
                  {s.n}. {s.title}
                </p>
                <p className="text-xs text-muted">{s.note}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-3xl text-sm text-muted">
          The buyer reviews the AI&apos;s findings and releases payment with an on-chain rating. If either
          side disputes, the AI arbiter re-evaluates and records a verdict on-chain; either party can then
          appeal to a human admin within 3 days. Funds are never clawed back — they only move when a
          settlement is final.
        </p>
      </section>

      {/* about */}
      <section id="about" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <p className="eyebrow">About TrustieWork</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">
              Make Bitcoin productive — without selling it.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Instead of selling BTC to pay for labor, buyers lock it as collateral through Mezo&apos;s
              Trove system and mint MUSD to fund jobs. Developers are paid in a stable asset, shielded
              from Bitcoin volatility, and every deliverable is checked by AI before funds move.
              TrustieWork replaces intermediaries with programmable trust.
            </p>
          </div>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-2 bg-ink px-5 py-3 text-xs font-semibold uppercase tracking-wide text-bg">
              <span>Traditional platforms</span>
              <span className="text-accent">TrustieWork</span>
            </div>
            {compare.map(([a, b]) => (
              <div key={a} className="grid grid-cols-2 gap-4 border-t border-border px-5 py-2.5 text-sm">
                <span className="text-muted">{a}</span>
                <span className="font-medium">{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <div className="panel-ink relative overflow-hidden">
          <Image
            src="/images/hero-robot.webp"
            alt=""
            fill
            sizes="(min-width: 1024px) 1100px, 100vw"
            className="-scale-x-100 object-cover object-[60%_35%] opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-transparent" />
          <div className="relative flex flex-wrap items-center justify-between gap-6 p-8 sm:p-10">
            <div>
              <p className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Real work. Real value.</p>
              <p className="mt-2 text-sm text-bg/70">Turn your Bitcoin into productive capital.</p>
            </div>
            <LinkButton href="/signup" className="px-6 py-3">
              Get started <span aria-hidden>→</span>
            </LinkButton>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
