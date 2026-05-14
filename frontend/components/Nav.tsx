'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/ui';
import { env } from '@/lib/env';

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`text-sm transition ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
    >
      {label}
    </Link>
  );
}

export function Nav() {
  const { user, profile, signOut } = useAuth();
  const isAdmin =
    !!profile?.walletAddress && profile.walletAddress === env.admin.address && !!env.admin.address;

  return (
    <header className="sticky top-0 z-40 border-b border-border glass">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href={user ? '/feed' : '/'} className="flex items-center gap-2">
          <span className="font-display text-lg font-bold tracking-tight">
            Sat<span className="gradient-text">Lock</span>
          </span>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-soft">
            Matsnet
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          {profile && (
            <>
              <NavLink href="/feed" label="Feed" />
              <NavLink href="/dashboard" label="Dashboard" />
              {profile.role === 'buyer' && <NavLink href="/jobs/new" label="Post a job" />}
              {isAdmin && <NavLink href="/admin" label="Admin" />}
            </>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
              {profile && (
                <Link href={`/profile/${profile.walletAddress}`} className="flex items-center gap-2">
                  <Avatar seed={profile.walletAddress} size={30} />
                </Link>
              )}
              <button onClick={signOut} className="text-sm text-muted hover:text-fg">
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <NavLink href="/login" label="Log in" />
              <Link
                href="/signup"
                className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-sm font-semibold text-bg"
              >
                Get started
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
