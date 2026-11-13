import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import hre from "hardhat";
import { formatEther, parseEther } from "viem";

/**
 * Live Matsnet smoke test of the per-employer trove flow, signed by DEPLOYER_PRIVATE_KEY (or
 * SMOKE_PRIVATE_KEY). Leaves an on-chain trail judges can inspect on the explorer:
 *   1. postJobWithBTC  — creates the employer's TroveVault and opens their Mezo trove
 *   2. postJobWithBTC  — pools a second job into the same trove via adjustTrove (no new BTC)
 *   3. getTrove        — reads TroveManager + PriceFeed through the escrow
 *   4. cancelOpenJob x2 — MUSD back to the employer
 *   5. repay           — repays part of the trove debt through the vault
 *
 * Needs ~0.05 BTC on Matsnet (Mezo's 1800 MUSD minimum debt at a safe collateral ratio).
 *   pnpm exec hardhat run scripts/smoke-trove.ts --network matsnet
 */
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const COLLATERAL = parseEther(process.env.SMOKE_BTC ?? "0.05");

async function main() {
  const a = JSON.parse(readFileSync(resolve(__dirname, "..", "deployments", "matsnet.json"), "utf8"));
  const [wallet] = await hre.viem.getWalletClients();
  const pc = await hre.viem.getPublicClient();
  const escrow = await hre.viem.getContractAt("SatLockEscrow", a.escrow, { client: { wallet } });
  const explorer = (tx: string) => `https://explorer.test.mezo.org/tx/${tx}`;
  const wait = async (label: string, hash: `0x${string}`) => {
    const r = await pc.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted: ${explorer(hash)}`);
    console.log(`✔ ${label}\n    ${explorer(hash)}`);
  };

  const balance = await pc.getBalance({ address: wallet.account.address });
  console.log(`Employer ${wallet.account.address}: ${formatEther(balance)} BTC`);
  if (balance < COLLATERAL + parseEther("0.002")) {
    throw new Error(`Need at least ${formatEther(COLLATERAL + parseEther("0.002"))} BTC — fund this address from the Mezo faucet.`);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  const first = await escrow.read.nextJobId();
  await wait(
    "Job 1: opened the employer's own trove (postJobWithBTC → TroveVault.openTroveFor)",
    await escrow.write.postJobWithBTC([parseEther("1800"), deadline, "smoke:1", ZERO, ZERO], { value: COLLATERAL }),
  );
  await wait(
    "Job 2: pooled into the same trove (adjustTrove, no new BTC)",
    await escrow.write.postJobWithBTC([parseEther("200"), deadline, "smoke:2", ZERO, ZERO]),
  );

  const t = await escrow.read.getTrove([wallet.account.address]);
  console.log(
    `\nTrove (via TroveManager + PriceFeed): vault ${t.vault}\n  status ${t.status}, coll ${formatEther(t.coll)} BTC, ` +
      `debt ${formatEther(t.debt)} MUSD, ICR ${(Number(formatEther(t.icr)) * 100).toFixed(0)}%, BTC $${Number(formatEther(t.price)).toFixed(0)}`,
  );
  console.log(`  https://explorer.test.mezo.org/address/${t.vault}\n`);

  await wait("Cancelled job 1 (MUSD refunded to employer)", await escrow.write.cancelOpenJob([first]));
  await wait("Cancelled job 2 (MUSD refunded to employer)", await escrow.write.cancelOpenJob([first + 1n]));

  const vault = await hre.viem.getContractAt("TroveVault", t.vault, { client: { wallet } });
  const musd = await hre.viem.getContractAt("MockMUSD", a.musd, { client: { wallet } }); // ERC20 surface only
  const repayAmount = parseEther("150");
  await wait("Approved MUSD to the vault", await musd.write.approve([t.vault, repayAmount]));
  await wait("Repaid 150 MUSD through the vault (BorrowerOperations.repayMUSD)", await vault.write.repay([repayAmount, ZERO, ZERO]));

  const after = await escrow.read.getTrove([wallet.account.address]);
  console.log(`\nDebt after repay: ${formatEther(after.debt)} MUSD. Close it from the dashboard to get the BTC back.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
