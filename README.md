# TrustieWork

**A Developer-services marketplace, on-chain — escrow protected on Bitcoin via Mezo.**

Buyers post and fund jobs to an open marketplace. Developers browse an interactive feed, claim
work, and submit deliverables (a GitHub link or other reference). A **Google Gemini** layer
scans the deliverable against the job spec and recommends *complete* or *incomplete* — the
buyer then confirms and leaves an on-chain review. Disputes go **AI-first**, then escalate to a
human **admin**. Funds are locked in a smart contract the entire time; nobody can touch them
unilaterally, and no settlement is reversible once final.

Funding works two ways:

- **MUSD** — the buyer deposits the stablecoin directly.
- **BTC collateral** — the buyer locks native BTC; TrustieWork mints MUSD against it through Mezo's
  trove system (`BorrowerOperations.openTrove`). The Bitcoin keeps working as collateral while
  it secures the job.

## How this hits each track

- **Bank on Bitcoin — Bitcoin Track:** escrow is a core financial primitive. TrustieWork lets a
  buyer's BTC keep working as trove collateral while it secures real freelance work.
- **MEZO Utilization — MEZO Track:** MUSD is the settlement currency end-to-end, with direct
  integration into Mezo's `BorrowerOperations` trove system for BTC-collateralized funding.

## The job lifecycle

```
Open ──claim──▶ Claimed ──submit──▶ Submitted ──approveAndRelease──▶ Released  (+ on-chain rating)
  │                │                    │
  │                │                    └──dispute──▶ Disputed ──AI resolveDispute──▶ DisputeResolved
  │                │                                                                    │
cancelOpenJob   reclaimExpired                                          ┌────────────────┴───────────┐
  │                │                                              finalizeDispute            appeal
  ▼                ▼                                              (no appeal,                  │
Cancelled       Refunded                                           settles per AI)             ▼
                                                                         │                  Appealed
                                                                         ▼                     │
                                                                  Released / Refunded   adminResolve
                                                                                               │
                                                                                               ▼
                                                                                       Released / Refunded
```

The AI's submission review is **advisory only** — it never moves funds. On a dispute, the AI
arbiter records an on-chain verdict and opens a 3-day appeal window; if nobody appeals, anyone
can finalize it, otherwise the admin (contract `owner`) makes the final, binding call.

## Repo layout

```
TrustieWork/
├── contracts/   Solidity + Hardhat — SatLockEscrow marketplace contract, tests, Matsnet deploy
├── backend/     Express service — Google Gemini AI layers, GitHub scanner, Firebase + Firestore
└── frontend/    Next.js 16 app — Firebase auth, wagmi + RainbowKit, wired to Mezo Matsnet
```

Each package is self-contained with its own `package.json`. Install per folder.

## 1. Contracts

```bash
cd contracts
pnpm install
pnpm compile
pnpm test                       # full lifecycle test suite (mocked MUSD + BorrowerOperations)
# set DEPLOYER_PRIVATE_KEY + AI_ARBITER_ADDRESS in your env, then:
pnpm deploy                     # deploys to Matsnet, prints the escrow address
```

The deployer becomes the contract `owner` (the admin / final appeal authority).
`AI_ARBITER_ADDRESS` is the backend wallet allowed to call `resolveDispute()`.

## 2. Backend

```bash
cd backend
pnpm install
cp .env.example .env            # see the variables below
pnpm dev                        # http://localhost:4000
```

| env var | purpose |
|---|---|
| `ESCROW_ADDRESS` | deployed SatLockEscrow address |
| `ARBITER_PRIVATE_KEY` | backend wallet — **must** match the contract's `aiArbiter` |
| `GEMINI_API_KEY` | Google Gemini key — powers both AI layers |
| `GITHUB_TOKEN` | optional — raises the rate limit for scanning deliverable repos |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin service-account JSON, single-line — verifies ID tokens and backs Firestore |
| `ADMIN_ADDRESS` | the human admin's wallet (matches the contract `owner`) |

The chain holds escrow + lifecycle + the on-chain rating; **Firestore** holds the rich
marketplace data — job metadata, profiles, reviews, appeals, and AI rationales.

## 3. Frontend

```bash
cd frontend
pnpm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_ESCROW_ADDRESS, NEXT_PUBLIC_FIREBASE_*,
                                   #     NEXT_PUBLIC_ADMIN_ADDRESS, WalletConnect ID
pnpm dev                           # http://localhost:3000
```

Auth is **Firebase** (email/password + Google). Signup flows straight into onboarding, where
linking a **Mezo wallet is mandatory** — that address is what gates the rest of the app and
holds the user's escrow funds.

## Mezo Matsnet references

| | |
|---|---|
| Chain ID | 31611 |
| RPC | https://rpc.test.mezo.org |
| Explorer | https://explorer.test.mezo.org |
| MUSD token | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` |
| Faucet | https://faucet.test.mezo.org |

> Verify the MUSD / BorrowerOperations addresses against the latest Mezo docs before a real
> deploy — testnet addresses can change. Reclaiming BTC collateral by repaying the trove is
> out of scope for v1: the trove is opened and owned by the escrow contract.
