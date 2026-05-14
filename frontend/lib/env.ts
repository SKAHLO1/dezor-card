export const env = {
  app: {
    name: process.env.NEXT_PUBLIC_APP_NAME ?? 'SatLock',
    walletConnectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
  },
  mezo: {
    chainId: Number(process.env.NEXT_PUBLIC_MEZO_CHAIN_ID ?? 31611),
    rpcUrl: process.env.NEXT_PUBLIC_MEZO_RPC_URL ?? 'https://rpc.test.mezo.org',
    explorerUrl: process.env.NEXT_PUBLIC_MEZO_EXPLORER_URL ?? 'https://explorer.test.mezo.org',
  },
  contracts: {
    musd: (process.env.NEXT_PUBLIC_MUSD_ADDRESS ??
      '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503') as `0x${string}`,
    escrow: (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? '') as `0x${string}` | '',
  },
  backend: {
    url: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000',
  },
  admin: {
    address: (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? '').toLowerCase(),
  },
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  },
} as const;

export const isEscrowConfigured = () => env.contracts.escrow.startsWith('0x');
export const isFirebaseConfigured = () => !!env.firebase.apiKey && !!env.firebase.projectId;
