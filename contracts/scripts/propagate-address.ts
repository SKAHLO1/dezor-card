import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Reads the canonical deploy artifact written by deploy.ts and patches the escrow address
 * into backend/.env and frontend/.env.local. Idempotent.
 *
 * Pass `--force` to overwrite an existing pinned address; otherwise the script aborts if
 * the env file already has a non-empty ESCROW_ADDRESS pointing somewhere else.
 *
 *   pnpm exec tsx scripts/propagate-address.ts        # safe mode
 *   pnpm exec tsx scripts/propagate-address.ts --force
 */

const ROOT = resolve(__dirname, '..', '..');
const ADDRESSES = resolve(__dirname, '..', 'artifacts', 'addresses.matsnet.json');
const BACKEND_ENV = resolve(ROOT, 'backend', '.env');
const FRONTEND_ENV = resolve(ROOT, 'frontend', '.env.local');

const force = process.argv.includes('--force');

function patchEnv(path: string, key: string, value: string) {
  const exists = existsSync(path);
  const current = exists ? readFileSync(path, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const match = current.match(re);

  if (match) {
    const existingValue = match[0].slice(key.length + 1).trim();
    if (existingValue && existingValue !== value && !force) {
      console.error(
        `refusing to overwrite ${key} in ${path} (already set to ${existingValue}). Re-run with --force to override.`,
      );
      return false;
    }
    writeFileSync(path, current.replace(re, line));
  } else {
    const sep = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    writeFileSync(path, current + sep + line + '\n');
  }
  console.log(`patched ${key} -> ${value} in ${path}`);
  return true;
}

function main() {
  if (!existsSync(ADDRESSES)) {
    throw new Error(`No deploy artifact found at ${ADDRESSES}. Run \`pnpm deploy\` first.`);
  }
  const addr = JSON.parse(readFileSync(ADDRESSES, 'utf8'));
  if (!addr.escrow) throw new Error('addresses.matsnet.json is missing `escrow`');

  patchEnv(BACKEND_ENV, 'ESCROW_ADDRESS', addr.escrow);
  patchEnv(FRONTEND_ENV, 'NEXT_PUBLIC_ESCROW_ADDRESS', addr.escrow);

  if (addr.owner) patchEnv(BACKEND_ENV, 'ADMIN_ADDRESS', addr.owner);
  if (addr.owner) patchEnv(FRONTEND_ENV, 'NEXT_PUBLIC_ADMIN_ADDRESS', addr.owner);
}

main();
