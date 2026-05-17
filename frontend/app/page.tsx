import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { LinkButton } from '@/components/ui';

const steps = [
  {
    n: '01',
    title: 'Post & fund a job',
    body: 'Buyers post work to an open marketplace and fund escrow — directly in MUSD, or by locking native BTC as collateral and minting MUSD against it through Mezo’s trove system.',
  },
  {
    n: '02',
    title: 'A developer claims it',
    body: 'Developers browse an interactive feed, claim a job, and submit their deliverable as a GitHub link or other reference. Funds stay locked in the contract the entire time.',
  },
  {
    n: '03',
    title: 'AI reviews the work',
    body: 'A Google Gemini layer scans the deliverable against the job spec and recommends complete or incomplete — an objective first opinion for the buyer.',
  },
  {
    n: '04',
    title: 'Release, or escalate',
    body: 'The buyer confirms and leaves an on-chain review. If there’s a dispute, AI arbitrates first; either party can appeal to a human admin. No one can touch funds unilaterally.',
  },
];

const tracks = [
  {
    tag: 'Bitcoin Track',
    title: 'Bank on Bitcoin',
    body: 'Escrow is a core financial primitive. TrustieWork lets a buyer’s BTC keep working as trove collateral while it secures real freelance work — Bitcoin doing a job, not just sitting.',
  },
  {
    tag: 'MEZO Track',
    title: 'MEZO Utilization',
    body: 'MUSD is the settlement currency end-to-end, with direct integration into Mezo’s BorrowerOperations trove system for BTC-collateralized funding.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <Nav />

      {/* hero */}
      <section className="relative mx-auto max-w-4xl px-6 pb-24 pt-24 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
          Live on Mezo Matsnet
        </div>
        <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Freelance work escrow,
          <br />
          <span className="gradient-text">protected on Bitcoin.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
          TrustieWork is a Fiverr-style marketplace built on-chain. Buyers fund jobs in MUSD or BTC
          collateral, an AI layer reviews deliverables, and disputes go AI-first then to a human
          admin — so both sides are protected.
        </p>
        <div className="mt-9 flex justify-center gap-3">
          <LinkButton href="/signup">Get started</LinkButton>
          <LinkButton href="/login" variant="secondary">
            Log in
          </LinkButton>
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-8 font-display text-2xl font-bold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="card card-hover p-6">
              <span className="font-display text-sm font-bold text-accent-soft">{s.n}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* tracks */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <h2 className="mb-8 font-display text-2xl font-bold">Built for two hackathon tracks</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {tracks.map((t) => (
            <div key={t.title} className="card p-7">
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent-soft">
                {t.tag}
              </span>
              <h3 className="mt-4 font-display text-xl font-bold">{t.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-faint">
          <span>TrustieWork — Bitcoin-native developer-services escrow.</span>
          <Link href="/signup" className="text-accent-soft hover:underline">
            Create an account →
          </Link>
        </div>
      </footer>
    </div>
  );
}
