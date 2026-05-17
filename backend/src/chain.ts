import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from './env';

export const mezoMatsnet = defineChain({
  id: 31611,
  name: 'Mezo Mastnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [env.mezo.rpcUrl] } },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: mezoMatsnet,
  transport: http(),
});

export const arbiterAccount = privateKeyToAccount(env.arbiter.privateKey);

export const arbiterWallet = createWalletClient({
  account: arbiterAccount,
  chain: mezoMatsnet,
  transport: http(),
});

// On-chain Job struct, kept in sync with contracts/src/SatLockEscrow.sol.
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

// ABI subset the backend needs: read a job, the next id, resolveDispute(), and lifecycle events.
export const escrowAbi = [
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [jobTuple],
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
    name: 'resolveDispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'approve', type: 'bool' },
      { name: 'rationaleURI', type: 'string' },
    ],
    outputs: [],
  },
  parseAbiItem('event JobPosted(uint256 indexed id, address indexed employer, uint256 amount, uint8 mode, uint64 deadline)'),
  parseAbiItem('event JobClaimed(uint256 indexed id, address indexed freelancer)'),
  parseAbiItem('event JobUnclaimed(uint256 indexed id, address indexed freelancer)'),
  parseAbiItem('event WorkSubmitted(uint256 indexed id, string submissionURI)'),
  parseAbiItem('event JobDisputed(uint256 indexed id, address indexed by)'),
  parseAbiItem('event DisputeResolved(uint256 indexed id, bool approve, string rationaleURI, uint64 appealDeadline)'),
  parseAbiItem('event JobAppealed(uint256 indexed id, address indexed by)'),
  parseAbiItem('event AdminResolved(uint256 indexed id, bool approve, string rationaleURI)'),
  parseAbiItem('event JobReleased(uint256 indexed id, address indexed freelancer, uint256 amount, string rationaleURI)'),
  parseAbiItem('event JobRefunded(uint256 indexed id, address indexed employer, uint256 amount, string reason)'),
  parseAbiItem('event JobCancelled(uint256 indexed id, address indexed employer, uint256 amount)'),
  parseAbiItem('event ReviewLeft(uint256 indexed id, address indexed freelancer, uint8 rating)'),
] as const;

export const escrowAddress = env.mezo.escrowAddress;

// Status enum mirror (see SatLockEscrow.sol).
export const Status = {
  None: 0,
  Open: 1,
  Claimed: 2,
  Submitted: 3,
  Disputed: 4,
  DisputeResolved: 5,
  Appealed: 6,
  Released: 7,
  Refunded: 8,
  Cancelled: 9,
} as const;
