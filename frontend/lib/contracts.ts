import { env } from '@/lib/env';

export const escrowAddress = env.contracts.escrow;
export const musdAddress = env.contracts.musd;

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
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [jobTuple],
  },
] as const;
