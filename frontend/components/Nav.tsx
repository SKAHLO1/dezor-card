'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/ui';

export function Logo({ variant = 'light', height = 34 }: { variant?: 'light' | 'dark'; height?: number }) {
  return (
    <Image
      src={variant === 'light' ? '/brand/logo-light.png' : '/brand/logo-dark.png'}
      alt="TrustieWork"
      width={Math.round(height * (1758 / 346))}
      height={height}
      priority
      style={{ height, width: 'auto' }}
    />
  );
}

function NavLink({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  const pathname = usePathname();
  const active = href.startsWith('/#') ? false : pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`text-sm transition ${active ? 'font-semibold text-fg' : 'text-muted hover:text-fg'}`}
    >
      {label}
    </Link>
  );
}

export function Nav() {
  const { user, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const links = (onClick?: () => void) => (
    <>
      <NavLink href="/feed" label="Jobs" onClick={onClick} />
      <NavLink href="/developers" label="Developers" onClick={onClick} />
      <NavLink href="/#how" label="How it works" onClick={onClick} />
      <NavLink href="/#about" label="About" onClick={onClick} />
      {profile && <NavLink href="/dashboard" label="Dashboard" onClick={onClick} />}
      {profile?.role === 'buyer' && <NavLink href="/jobs/new" label="Post a job" onClick={onClick} />}
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-3 sm:px-6">
        <Link href={user ? '/feed' : '/'} className="flex shrink-0 items-center" aria-label="TrustieWork home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">{links()}</nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="hidden sm:block">
                <ConnectButton
                  showBalance={{ smallScreen: false, largeScreen: true }}
                  chainStatus="none"
                  accountStatus="address"
                />
              </div>
              {profile && (
                <Link href={`/profile/${profile.walletAddress}`} aria-label="Your profile">
                  <Avatar seed={profile.walletAddress} size={32} />
                </Link>
              )}
              <button onClick={signOut} className="hidden text-sm text-muted hover:text-fg lg:block">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden text-sm text-muted hover:text-fg sm:block">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-bg transition hover:bg-ink-3"
              >
                Get started
              </Link>
            </>
          )}
          <button
            className="rounded-md border border-border-strong p-2 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <span className="block h-0.5 w-4 bg-ink" />
            <span className="mt-1 block h-0.5 w-4 bg-ink" />
            <span className="mt-1 block h-0.5 w-4 bg-ink" />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-bg px-5 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {links(() => setOpen(false))}
            {user ? (
              <>
                <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
                <button onClick={signOut} className="text-left text-sm text-muted">
                  Sign out
                </button>
              </>
            ) : (
              <NavLink href="/login" label="Log in" onClick={() => setOpen(false)} />
            )}
          </div>
        </div>
      )}
    </header>
  );
}
