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
- **BTC collateral** — each employer gets their **own Mezo trove**, held by a personal
  `TroveVault` contract. The first BTC job opens it (`BorrowerOperations.openTrove`), later jobs
  pool into it (`adjustTrove`), and the employer can repay, top up, withdraw, close the trove and
  claim surplus collateral to get their BTC back. Prices and trove health come live from Mezo's
  `PriceFeed` and `TroveManager`.

## How this hits each track

- **Bank on Bitcoin — Bitcoin Track:** escrow is a core financial primitive. TrustieWork lets
  a buyer's BTC keep working as trove collateral while it secures real freelance work.
- **MEZO Utilization — MEZO Track:** MUSD is the settlement currency end-to-end, with a full
  trove lifecycle per employer on Mezo's MUSD protocol: `openTrove`, `adjustTrove`, `addColl`,
  `withdrawColl`, `repayMUSD`, `closeTrove` and `claimCollateral` on `BorrowerOperations`, plus
  live reads from `TroveManager` (status, collateral, debt, ICR), `PriceFeed` (BTC/USD) and
  `CollSurplusPool` (claimable collateral). See [Mezo integration](#mezo-integration-v2).

## Mezo integration (v2)

| | v1 (Hackathon 2) | v2 (this wave) |
|---|---|---|
| Trove owner | the escrow contract — one trove total, so only the first BTC job could ever succeed | one `TroveVault` per employer, so every employer has their own trove |
| More BTC jobs | reverted (`Trove is active`) | pooled into the employer's trove with `adjustTrove` (BTC optional) |
| Getting BTC back | impossible | `repay`, `withdrawCollateral`, `closeTrove`, `claimCollateral` via the vault; BTC is sent straight to the employer |
| BTC price | hard-coded $95,000 | Mezo `PriceFeed`, on-chain (`getTrove`) and in the UI |
| Trove health | client-side guess | `TroveManager.getTroveStatus / getTroveColl / getTroveDebt / getCurrentICR` |
| Minimum debt / fee | env defaults | `BorrowerOperations.minNetDebt()` / `getBorrowingFee()` |

How it fits together:

- `SatLockEscrow.postJobWithBTC(musd, deadline, uri, upperHint, lowerHint)` creates the caller's
  `TroveVault` on first use (CREATE2, salted by employer). If the vault's trove is not active it
  calls `openTroveFor` (opens with the BTC sent); otherwise `borrowMoreFor` (`adjustTrove` adding
  any BTC sent and minting more MUSD). The minted MUSD moves into the escrow for the job at once.
- The vault is managed by the employer only (`onlyEmployer`); only the escrow can borrow through
  it (`onlyEscrow`). Job funds never depend on the trove after minting.
- `SatLockEscrow.getTrove(employer)` returns `{vault, status, coll, debt, price, icr}` from
  TroveManager + PriceFeed; it tolerates a stale oracle (`price = 0`) instead of reverting.
- Closing burns `debt − 200 MUSD` (Mezo burns the gas compensation from its gas pool); the vault
  pulls a small buffer for interest accrued until the tx and refunds the unused MUSD.
- The buyer dashboard has a **Your Mezo trove** panel for all of the above; the post-job form
  previews the resulting trove (opens vs. pools, ratio, liquidation price) with live parameters.

Verification:

- `contracts`: `pnpm test` — 27 tests, including a faithful MUSD mock (one trove per address,
  1800 MUSD minimum, 200 MUSD gas compensation, 0.1% fee, 110% MCR, close/claim semantics).
- `contracts`: `pnpm test:fork` — runs the vault flow against **Mezo's live contracts** on a
  Matsnet fork (open → pool via adjustTrove → read TroveManager/PriceFeed → close → BTC back).
  Mezo's oracle is a precompile a fork cannot execute, so the test installs a Chainlink-style
  aggregator there carrying the live Matsnet answer; every other call hits Mezo's real code.
- `contracts`: `pnpm smoke:trove` — the same flow on Matsnet itself (needs ~0.05 BTC).

## Project history

TrustieWork was first built for **Mezo Hackathon 2** (escrow contract, MUSD + single-trove BTC
funding, Gemini review, dispute/appeal ladder). This Wave builds on that entry. Work done in the
Oct 16–26 window: UI overhaul, AI per-requirement evidence, indexer and timeline. Work done for
Wave 2: per-employer troves with pooling, the full repay/close/claim lifecycle, live
TroveManager/PriceFeed reads, the redeployed and explorer-verified escrow, party-only AI
endpoints, and on-chain-sourced submission URLs.

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
| `GEMINI_API_KEY` | Google Gemini key — primary model for both AI layers (`GROQ_API_KEY` below adds a backup) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` *or* `FIREBASE_SERVICE_ACCOUNT` | Admin SDK credentials (see "Firebase credentials" below) |
| `ADMIN_ADDRESS` | the human admin's wallet (matches the contract `owner`; auto-populated) |

### Optional / tunable

| env var | default | purpose |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | Submission-review model |
| `GEMINI_MODEL_DISPUTE` | inherits `GEMINI_MODEL` | Override the model used for dispute arbitration only |
| `GEMINI_TIMEOUT_MS` | `25000` | Hard timeout per Gemini call; one transient retry |
| `GROQ_API_KEY` | unset | Backup AI. If Gemini is unset or fails (outage, quota, timeout, bad output), the same prompt goes to Groq. Get a key at https://console.groq.com/keys |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model for submission reviews (JSON mode) |
| `GROQ_MODEL_DISPUTE` | inherits `GROQ_MODEL` | Groq model for dispute arbitration only |
| `GROQ_TIMEOUT_MS` | `25000` | Hard timeout per Groq call; one transient retry |
| `AI_AUTO_RESOLVE_MIN_CONFIDENCE` | `0.65` | Verdicts under this confidence are recorded but not sent on-chain — escalated to admin |
| `RATE_LIMIT_AI_PER_MIN` | `20` | Per-IP cap on `/ai/*` (Gemini-cost protection) |
| `GITHUB_TOKEN` | unset | Optional — raises the public GitHub rate limit when digesting repo URLs |
| `INDEXER_START_BLOCK` | `0` | Block the event indexer starts at on a fresh database (set to the escrow's deploy block by `pnpm run propagate`) |
| `FIRESTORE_NAMESPACE` | `''` | Prefix for per-deployment collections (`jobs`, `aiVerdicts`, `appeals`, indexer cursor); `propagate` sets `v2_` |
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

### Trove preview (BTC-mode posts)

The new-job form previews the employer's trove *after* this job — whether the job opens the
trove or pools into it, collateral, debt (incl. the borrowing fee and 200 MUSD gas
compensation), collateral ratio and liquidation price. Everything is read live: BTC/USD from
Mezo's `PriceFeed`, the employer's trove from `TroveManager` (both via the escrow's `getTrove`),
and `minNetDebt` / the borrowing fee from `BorrowerOperations`. No price is configured.

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
   Start: `pnpm start`. Add every backend env var. For the Firebase service account, use
   **Render Secret Files**: upload `firebase-service-account.json`, then set
   `FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json` (no base64
   mangling). Set `FRONTEND_ORIGIN` to the Vercel URL.
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
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` |
| CollSurplusPool | `0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9` |
| **SatLockEscrow v2 (verified)** | [`0xf0163fab9e58f901afc994fca363255a536f5823`](https://explorer.test.mezo.org/address/0xf0163fab9e58f901afc994fca363255a536f5823#code) — deploy block 16598747 |
| Faucet | https://faucet.test.mezo.org |

> Mezo addresses come from `mezo-org/musd` (`solidity/artifacts/deployments/matsnet`). The full
> deployment record, including constructor args, is in `contracts/deployments/matsnet.json`.

### Useful scripts

| Package | Script | Purpose |
|---|---|---|
| `contracts` | `pnpm run compile` | Hardhat compile + export ABI to `artifacts/abi/` |
| `contracts` | `pnpm test` | Full lifecycle test suite (Solidity + viem) |
| `contracts` | `pnpm run deploy` | Deploy `SatLockEscrow` to Matsnet |
| `contracts` | `pnpm run propagate` | Patch deployed address into backend + frontend env files |
| `contracts` | `pnpm run bootstrap` | compile + deploy + propagate in one shot |
| `contracts` | `pnpm test:fork` | Vault flow against Mezo's live contracts on a Matsnet fork |
| `contracts` | `pnpm run verify` | Verify the escrow on Mezo's Blockscout explorer |
| `contracts` | `pnpm smoke:trove` | Live Matsnet trove flow (open, pool, read, cancel, repay) |
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

- **Sorted-list hints are zero.** `postJobWithBTC` and the vault accept SortedTroves hints, but
  the UI passes `address(0)`, which Mezo accepts at a higher gas cost. Computing hints with
  `HintHelpers.getApproxHint` is a straightforward follow-up.
- **Redeploying restarts job ids.** Each escrow deployment gets its own Firestore namespace
  (`FIRESTORE_NAMESPACE`, set by `pnpm run propagate`); v1 records stay readable under the
  original collections.
- **The WalletConnect placeholder project ID** prints a harmless 400 in the browser console
  (analytics ping). Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from
  https://cloud.reown.com to silence it. Injected wallets (MetaMask, Rabby) work without it.
