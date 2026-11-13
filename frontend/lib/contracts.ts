import { env } from '@/lib/env';

export const escrowAddress = env.contracts.escrow;
export const musdAddress = env.contracts.musd;

/** Mezo MUSD protocol contracts on Matsnet (mezo-org/musd deployments/matsnet). */
export const mezo = {
  borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
  collSurplusPool: '0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9',
} as const;

/** Mezo protocol constants (LiquityBase.sol). */
export const MUSD_GAS_COMPENSATION = 200n * 10n ** 18n;
export const MCR = 1.1; // minimum collateral ratio
export const CCR = 1.5; // system critical ratio; also our recommended per-trove buffer

/** TroveManager.Status */
export enum TroveStatus {
  None = 0,
  Active = 1,
  ClosedByOwner = 2,
  ClosedByLiquidation = 3,
  ClosedByRedemption = 4,
}

/* ---- enums (mirror SatLockEscrow.sol) ---- */
export enum JobStatus {
  None = 0,
  Open = 1,
  Claimed = 2,
  Submitted = 3,
  Disputed = 4,
  DisputeResolved = 5,
  Appealed = 6,
  Released = 7,
  Refunded = 8,
  Cancelled = 9,
}

export enum FundingMode {
  MUSD = 0,
  BTC = 1,
}

export const jobStatusLabel: Record<JobStatus, string> = {
  [JobStatus.None]: 'Unknown',
  [JobStatus.Open]: 'Open',
  [JobStatus.Claimed]: 'In progress',
  [JobStatus.Submitted]: 'Submitted',
  [JobStatus.Disputed]: 'In AI arbitration',
  [JobStatus.DisputeResolved]: 'AI verdict — appeal window',
  [JobStatus.Appealed]: 'Escalated to admin',
  [JobStatus.Released]: 'Released',
  [JobStatus.Refunded]: 'Refunded',
  [JobStatus.Cancelled]: 'Cancelled',
};

export const jobStatusTone: Record<JobStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  [JobStatus.None]: 'neutral',
  [JobStatus.Open]: 'accent',
  [JobStatus.Claimed]: 'accent',
  [JobStatus.Submitted]: 'warning',
  [JobStatus.Disputed]: 'warning',
  [JobStatus.DisputeResolved]: 'warning',
  [JobStatus.Appealed]: 'danger',
  [JobStatus.Released]: 'success',
  [JobStatus.Refunded]: 'neutral',
  [JobStatus.Cancelled]: 'neutral',
};

/* ---- on-chain Job shape returned by getJob ---- */
export interface OnchainJob {
  employer: `0x${string}`;
  freelancer: `0x${string}`;
  amount: bigint;
  btcCollateral: bigint;
  mode: number;
  status: number;
  deadline: bigint;
  claimedAt: bigint;
  appealDeadline: bigint;
  aiVerdictApprove: boolean;
  rating: number;
  detailsURI: string;
  submittedBlock: bigint;
}

/* ---- employer trove view returned by getTrove ---- */
export interface OnchainTrove {
  vault: `0x${string}`;
  status: number;
  coll: bigint;
  debt: bigint;
  /** BTC/USD from Mezo's PriceFeed, 18 decimals. 0 when the oracle is stale. */
  price: bigint;
  /** Individual collateral ratio, 18 decimals. */
  icr: bigint;
}

/* ---- ABIs ---- */
export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const jobTuple = {
  type: 'tuple',
  components: [
    { name: 'employer', type: 'address' },
    { name: 'freelancer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'btcCollateral', type: 'uint256' },
    { name: 'mode', type: 'uint8' },
    { name: 'status', type: 'uint8' },
    { name: 'deadline', type: 'uint64' },
    { name: 'claimedAt', type: 'uint64' },
    { name: 'appealDeadline', type: 'uint64' },
    { name: 'aiVerdictApprove', type: 'bool' },
    { name: 'rating', type: 'uint8' },
    { name: 'detailsURI', type: 'string' },
    { name: 'submittedBlock', type: 'uint64' },
  ],
} as const;

const troveTuple = {
  type: 'tuple',
  components: [
    { name: 'vault', type: 'address' },
    { name: 'status', type: 'uint8' },
    { name: 'coll', type: 'uint256' },
    { name: 'debt', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'icr', type: 'uint256' },
  ],
} as const;

export const satLockEscrowAbi = [
  {
    type: 'function',
    name: 'postJobWithMUSD',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
      { name: 'detailsURI', type: 'string' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'postJobWithBTC',
    stateMutability: 'payable',
    inputs: [
      { name: 'musdToBorrow', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
      { name: 'detailsURI', type: 'string' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimJob',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unclaimJob',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitWork',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'submissionURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveAndRelease',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'rating', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'dispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'appeal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'finalizeDispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'adminResolve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'approve', type: 'bool' },
      { name: 'rationaleURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelOpenJob',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reclaimExpired',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'nextJobId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTrove',
    stateMutability: 'view',
    inputs: [{ name: 'employer', type: 'address' }],
    outputs: [troveTuple],
  },
  {
    type: 'function',
    name: 'vaultOf',
    stateMutability: 'view',
    inputs: [{ name: 'employer', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [jobTuple],
  },
] as const;

/** The employer's TroveVault — owns their Mezo trove; every BTC it returns goes to the employer. */
export const troveVaultAbi = [
  {
    type: 'function',
    name: 'addCollateral',
    stateMutability: 'payable',
    inputs: [
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawCollateral',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'closeTrove',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'maxMusd', type: 'uint256' }],
    outputs: [],
  },
  { type: 'function', name: 'claimCollateral', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

/** Reads from Mezo's BorrowerOperations and CollSurplusPool used for previews. */
export const borrowerOpsAbi = [
  { type: 'function', name: 'minNetDebt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getBorrowingFee',
    stateMutability: 'view',
    inputs: [{ name: '_debt', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const collSurplusPoolAbi = [
  {
    type: 'function',
    name: 'getCollateral',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
