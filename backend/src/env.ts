import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const env = {
  port: num('PORT', 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  mezo: {
    rpcUrl: process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org',
    escrowAddress: required('ESCROW_ADDRESS') as `0x${string}`,
    // Block to start indexing from. 0 = scan from contract deploy / chain start.
    indexerStartBlock: BigInt(process.env.INDEXER_START_BLOCK ?? '0'),
  },
  arbiter: {
    // Backend wallet allowed to call resolveDispute() — must match the contract's aiArbiter.
    privateKey: required('ARBITER_PRIVATE_KEY') as `0x${string}`,
    // Below this confidence the auto-arbiter records the verdict but does NOT submit it
    // on-chain. The dispute is escalated to the admin queue instead.
    autoResolveMinConfidence: num('AI_AUTO_RESOLVE_MIN_CONFIDENCE', 0.65),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    // Override for the dispute layer — defaults to the same model unless explicitly set.
    modelDispute: process.env.GEMINI_MODEL_DISPUTE ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    timeoutMs: num('GEMINI_TIMEOUT_MS', 25_000),
  },
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
  },
  firebase: {
    // Either FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file — recommended) OR
    // FIREBASE_SERVICE_ACCOUNT (raw single-line JSON, or base64 if the *_BASE64 flag is on).
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? '',
    serviceAccountBase64:
      (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ?? '').toLowerCase() === '1' ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ?? '').toLowerCase() === 'true',
  },
  admin: {
    // Wallet address of the human admin (final appeal authority).
    address: (process.env.ADMIN_ADDRESS ?? '').toLowerCase(),
  },
  rateLimit: {
    aiPerMin: num('RATE_LIMIT_AI_PER_MIN', 20),
  },
};
