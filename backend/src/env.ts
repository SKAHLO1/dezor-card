import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  mezo: {
    rpcUrl: process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org',
    escrowAddress: required('ESCROW_ADDRESS') as `0x${string}`,
  },
  arbiter: {
    // Backend wallet allowed to call resolveDispute() — must match the contract's aiArbiter.
    privateKey: required('ARBITER_PRIVATE_KEY') as `0x${string}`,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  },
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
  },
  firebase: {
    // Full service-account JSON, single-line. Optional in dev — auth is skipped if unset.
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? '',
  },
  admin: {
    // Wallet address of the human admin (final appeal authority).
    address: (process.env.ADMIN_ADDRESS ?? '').toLowerCase(),
  },
};
