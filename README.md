# TrustieWork

**A developer-services marketplace, on-chain — escrow protected on Bitcoin via Mezo.**

Buyers post and fund jobs to an open marketplace. Developers browse an interactive feed, claim
work, and submit deliverables (a GitHub link or any public URL). A **Google Gemini 2.5 Flash**
layer scans the deliverable against the job spec and recommends *complete* or *incomplete* —
the buyer then confirms and leaves an on-chain rating. Disputes go **AI-first**, then escalate
to a human **admin**. Funds are locked in a smart contract the entire time; nobody can touch
them unilaterally, and no settlement is reversible once final.

Funding works two ways:

- **MUSD** — the buyer deposits the stablecoin directly.
- **BTC collateral** — the buyer locks native BTC; TrustieWork mints MUSD against it through
  Mezo's trove system (`BorrowerOperations.openTrove`). The Bitcoin keeps working as collateral
  while it secures the job.

## How this hits each track

- **Bank on Bitcoin — Bitcoin Track:** escrow is a core financial primitive. TrustieWork lets
  a buyer's BTC keep working as trove collateral while it secures real freelance work.
- **MEZO Utilization — MEZO Track:** MUSD is the settlement currency end-to-end, with direct
  integration into Mezo's `BorrowerOperations` trove system for BTC-collateralized funding.

## Architecture

```
                ┌────────────────────────────────────────────┐
                │              Mezo Matsnet                  │
                │  SatLockEscrow  ◀──MUSD─┐    MUSD token    │
                │      │  ▲              │                   │
                │      │  └─ BorrowerOps ◀ trove (BTC)       │
                └──────┼──┼──────────────────────────────────┘
                       │  │ resolveDispute / reads
                       │  │
        events ────────┘  │
        ▼                 │
 ┌────────────────────────┴────────┐         ┌───────────────────┐
 │ Backend (Express)               │         │ Frontend (Next 16)│
 │  ├ /ai  (Gemini 2.5 Flash)      │◀────────│  wagmi writes     │
 │  ├ /jobs /users /reviews        │  REST   │  REST reads       │
 │  ├ /admin (signed-proof gate)   │         │  Firebase Auth    │
 │  ├ /auth/wallet-challenge (SIWE)│         │  RainbowKit       │
 │  └ Indexer (events → Firestore) │         └───────────────────┘
 └─────────────┬───────────────────┘
               │
        ┌──────┴──────┐
        │  Firestore  │  (jobs, users, reviews, appeals, aiVerdicts)
        └─────────────┘
```

**Source-of-truth split.** The chain holds escrow + lifecycle state + on-chain ratings;
Firestore holds the rich content (titles, descriptions, written reviews, AI rationales,
appeal threads). The backend uses Firebase's Admin SDK with a service account, so client-side
Firestore rules can stay locked to `if false` — every legitimate read/write goes through
authenticated Express routes.

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

**Confidence floor.** Verdicts below `AI_AUTO_RESOLVE_MIN_CONFIDENCE` (default 0.65) are
recorded off-chain but *not* submitted to `resolveDispute()` — they're automatically escalated
to the admin appeal queue instead. The AI is allowed to admit it can't tell.

## Repo layout

```
TrustieWork/
├── .github/workflows/    CI — contracts (compile+test), backend (typecheck+vitest), frontend (typecheck+vitest+build)
├── contracts/            Solidity + Hardhat — SatLockEscrow contract, full lifecycle tests, deploy + propagate scripts
├── backend/              Express service — Gemini AI layers, GitHub + URL digest, Firebase Admin, chain indexer
└── frontend/             Next.js 16 app — Firebase auth, wagmi + RainbowKit, wired to Mezo Matsnet
```

Each package is self-contained with its own `package.json`. Install per folder.

> **pnpm caveat:** several scripts collide with built-in pnpm commands (`deploy`, `bootstrap`).
> Always invoke them as `pnpm run <script>` — plain `pnpm deploy` runs pnpm's deploy command,
> not yours.

---

## 1. Contracts

```bash
cd contracts
pnpm install
pnpm run compile                # also exports the ABI to artifacts/abi/ for frontend + backend
pnpm test                       # full lifecycle test suite (mocked MUSD + BorrowerOperations)
```

To deploy: create `contracts/.env` from `.env.example`, fill in `DEPLOYER_PRIVATE_KEY` and
`AI_ARBITER_ADDRESS`, then:

```bash
pnpm run bootstrap              # = compile + deploy + propagate-address in one shot
```

The bootstrap script:

1. Compiles + exports ABIs to `contracts/artifacts/abi/`
2. Deploys `SatLockEscrow` to Matsnet, writes `artifacts/addresses.matsnet.json`
3. Patches `ESCROW_ADDRESS` + `ADMIN_ADDRESS` into `backend/.env` and the corresponding
   `NEXT_PUBLIC_*` vars into `frontend/.env.local` (idempotent; refuses to clobber pinned
   values without `--force`)

The deployer becomes the contract `owner` (the admin / final appeal authority).
`AI_ARBITER_ADDRESS` is the **public address** of the wallet the backend will use to sign
`resolveDispute()` — the backend must hold the matching private key as `ARBITER_PRIVATE_KEY`.

---

## 2. Backend

```bash
cd backend
pnpm install
cp .env.example .env             # see the variables below
pnpm dev                         # http://localhost:4000 — API only
# or:
pnpm run dev:all                 # API + event indexer in one terminal (recommended)
```

### Required env vars

| env var | purpose |
|---|---|
| `ESCROW_ADDRESS` | deployed SatLockEscrow address (auto-populated by `pnpm run bootstrap`) |
| `ARBITER_PRIVATE_KEY` | backend wallet — **must** match the contract's `aiArbiter` |
| `GEMINI_API_KEY` | Google Gemini key — powers both AI layers |
| `FIREBASE_SERVICE_ACCOUNT_PATH` *or* `FIREBASE_SERVICE_ACCOUNT` | Admin SDK credentials (see "Firebase credentials" below) |
| `ADMIN_ADDRESS` | the human admin's wallet (matches the contract `owner`; auto-populated) |

### Optional / tunable

| env var | default | purpose |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | Submission-review model |
| `GEMINI_MODEL_DISPUTE` | inherits `GEMINI_MODEL` | Override the model used for dispute arbitration only |
| `GEMINI_TIMEOUT_MS` | `25000` | Hard timeout per Gemini call; one transient retry |
| `AI_AUTO_RESOLVE_MIN_CONFIDENCE` | `0.65` | Verdicts under this confidence are recorded but not sent on-chain — escalated to admin |
| `RATE_LIMIT_AI_PER_MIN` | `20` | Per-IP cap on `/ai/*` (Gemini-cost protection) |
| `GITHUB_TOKEN` | unset | Optional — raises the public GitHub rate limit when digesting repo URLs |
| `INDEXER_START_BLOCK` | `0` | Block the event indexer starts at on a fresh database |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Pino log level |

### Firebase credentials — three accepted formats

Pick whichever is least painful for your deploy target. Loaders try them in this order:

1. **File path** (recommended for local dev): `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`
2. **Inline JSON** (one line, single-quoted in `.env`): `FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",…}'`
3. **Base64** (best for Render/Vercel-style env-only platforms):
   `FIREBASE_SERVICE_ACCOUNT=eyJ…` + `FIREBASE_SERVICE_ACCOUNT_BASE64=1`

Any downloaded `firebase-service-account*.json` is gitignored.

### Service split

- `pnpm dev` — Express API (REST + auth + admin gate)
- `pnpm run dev:indexer` — chain event indexer. Watches `WorkSubmitted`, `JobDisputed`, every
  lifecycle event; projects on-chain job snapshots into Firestore and auto-fires AI review /
  arbitration. Idempotent (deduped per `(jobId, layer)`), 50-block reorg rewind.
- `pnpm run dev:all` — both, via `concurrently`.

The indexer is optional for demos — the UI has manual "Run AI review" / "Trigger AI arbitration"
buttons that work without it.

---

## 3. Frontend

```bash
cd frontend
pnpm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_ESCROW_ADDRESS, NEXT_PUBLIC_FIREBASE_*,
                                   #     NEXT_PUBLIC_ADMIN_ADDRESS, WalletConnect ID
pnpm dev                           # http://localhost:3000
```

Auth is **Firebase** (email/password + Google). Signup routes straight into onboarding, where
the user picks a role (buyer or developer), links a **Mezo wallet**, and signs a one-shot
challenge proving they control that wallet's private key. The signature is verified by the
backend before the profile is saved — wallets cannot be spoofed.

### Trove preview env vars (BTC-mode posts)

The new-job form shows a live trove-health preview (collateral ratio, max safe borrow,
liquidation warnings) before the buyer signs. Defaults are conservative; override if Mezo's
parameters change:

| env var | default | purpose |
|---|---|---|
| `NEXT_PUBLIC_TROVE_MIN_CR` | `1.10` | Protocol minimum collateral ratio |
| `NEXT_PUBLIC_TROVE_SAFE_CR` | `1.50` | Recommended safety buffer |
| `NEXT_PUBLIC_TROVE_MIN_DEBT_MUSD` | `1800` | Protocol minimum net debt |
| `NEXT_PUBLIC_BTC_PRICE_USD` | `95000` | Default BTC price for the preview (form lets buyer override per-post) |

### Failure recovery

If an on-chain post lands but the off-chain metadata sync fails (network blip, tab close),
the job is orphaned: funds locked, no title/description. The job detail page detects this and
shows a yellow **"Finish setting up this job"** panel for the buyer — fill in title +
description + tags, click Save, the job appears in the public feed. No new transaction is
needed.

### Admin console

`/admin` is gated to the contract owner — the wallet currently connected in MetaMask must
match `NEXT_PUBLIC_ADMIN_ADDRESS`. On entry the page asks the wallet to sign a per-session
admin proof (1-hour TTL); every admin API call includes the signature, the backend verifies
with `verifyMessage`. The console groups every dispute-state job into three sections:

| Section | Action available |
|---|---|
| **Appealed — your action required** | Write rationale + sign `adminResolve()` |
| **Disputed — awaiting AI arbitration** | Manually trigger AI arbitration |
| **AI verdict — appeal window open** | Read-only; shows verdict + appeal-window countdown |

Each card shows the latest AI verdict plus its **digest quality** (`github-full` /
`http-fetched` / `unreachable` / `empty`) so you can tell "AI judged the work and said no"
from "AI couldn't see the work at all."

---

## Deploying to production

A clean split: **Vercel** for the Next.js frontend, **Render** for the Express backend.
Detailed step-by-step in the deploy notes; the short version:

1. **Vercel** — Import the GitHub repo. Root directory: `frontend`. Add every `NEXT_PUBLIC_*`
   env var. Deploy → note the URL.
2. **Render** — New Web Service. Root: `backend`. Build: `pnpm install --frozen-lockfile && pnpm build`.
   Start: `pnpm start`. Add every backend env var. **Use base64 mode** for the Firebase
   service account (Render has no filesystem for file uploads). Set `FRONTEND_ORIGIN` to the
   Vercel URL.
3. Update Vercel's `NEXT_PUBLIC_BACKEND_URL` to point at the Render URL → redeploy.
4. Firebase Console → Authentication → Settings → Authorized domains → add the Vercel
   hostname (otherwise Google sign-in throws `auth/unauthorized-domain` in prod).

The indexer can run as a second Render Web Service (Start: `pnpm run start:indexer`, no
health check needed) if you want auto-AI in production. Skipping it just means using the
manual UI buttons.

---

## Reference

### Mezo Matsnet

| | |
|---|---|
| Chain ID | 31611 |
| RPC | https://rpc.test.mezo.org |
| Explorer | https://explorer.test.mezo.org |
| MUSD token | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` |
| Faucet | https://faucet.test.mezo.org |

> Verify the MUSD / BorrowerOperations addresses against the latest Mezo docs before a real
> deploy — testnet addresses can change.

### Useful scripts

| Package | Script | Purpose |
|---|---|---|
| `contracts` | `pnpm run compile` | Hardhat compile + export ABI to `artifacts/abi/` |
| `contracts` | `pnpm test` | Full lifecycle test suite (Solidity + viem) |
| `contracts` | `pnpm run deploy` | Deploy `SatLockEscrow` to Matsnet |
| `contracts` | `pnpm run propagate` | Patch deployed address into backend + frontend env files |
| `contracts` | `pnpm run bootstrap` | compile + deploy + propagate in one shot |
| `backend` | `pnpm dev` | API server (watch mode) |
| `backend` | `pnpm run dev:indexer` | Event indexer (watch mode) |
| `backend` | `pnpm run dev:all` | Both, via `concurrently` |
| `backend` | `pnpm typecheck` | `tsc --noEmit` |
| `backend` | `pnpm test` | Vitest unit tests |
| `frontend` | `pnpm dev` | Next.js dev server |
| `frontend` | `pnpm build` | Production build |
| `frontend` | `pnpm typecheck` | `tsc --noEmit` |
| `frontend` | `pnpm test` | Vitest unit tests |

### Known limitations (v1)

- **BTC mode is one-shot per contract deployment.** Mezo's MUSD is a Liquity-style CDP — one
  trove per owner address — so the escrow contract can only have one active trove at any
  time. After the first BTC-mode post, subsequent BTC-mode posts revert with
  `BorrowerOps: Trove is active.` Use MUSD mode for additional jobs, or fix in v1.1 by
  switching the contract to `adjustTrove()` so all BTC jobs share one pooled trove.
- **BTC collateral is not retrievable in v1.** Reclaiming BTC by repaying the trove debt is
  out of scope for v1: the trove is opened and owned by the escrow contract, and `cancelOpenJob`
  refunds the MUSD only. For BTC-mode jobs, plan to see them through to a developer payout.
- **The WalletConnect placeholder project ID** prints a harmless 400 in the browser console
  (analytics ping). Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from
  https://cloud.reown.com to silence it. Injected wallets (MetaMask, Rabby) work without it.
