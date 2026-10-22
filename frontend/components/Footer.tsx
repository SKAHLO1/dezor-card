import Link from 'next/link';
import Image from 'next/image';

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-xs text-muted sm:px-6">
        <Image src="/brand/logo-light.png" alt="TrustieWork" width={120} height={24} style={{ height: 24, width: 'auto' }} />
        <nav className="flex items-center gap-5">
          <Link href="/feed" className="hover:text-fg">Jobs</Link>
          <Link href="/developers" className="hover:text-fg">Developers</Link>
          <Link href="/#how" className="hover:text-fg">How it works</Link>
          <Link href="/#about" className="hover:text-fg">About</Link>
        </nav>
        <p className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent ring-1 ring-ink/30" />
          Built on Bitcoin × Mezo
        </p>
      </div>
    </footer>
  );
}
