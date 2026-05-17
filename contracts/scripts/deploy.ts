import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import hre from "hardhat";

// Mezo Matsnet (testnet) addresses. Verify against the latest Mezo docs / mezo-org/musd
// before a real deploy — testnet addresses can change.
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const BORROWER_OPERATIONS = "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5";

async function main() {
  const aiArbiter = process.env.AI_ARBITER_ADDRESS;
  if (!aiArbiter) {
    throw new Error("Set AI_ARBITER_ADDRESS — the backend wallet allowed to call resolveDispute()");
  }

  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) {
    throw new Error(
      "No deployer wallet configured. Set DEPLOYER_PRIVATE_KEY in contracts/.env " +
        "(must start with 0x and be 64 hex chars). Then re-run `pnpm run deploy`.",
    );
  }
  console.log("Deploying SatLockEscrow with:", deployer.account.address);

  const escrow = await hre.viem.deployContract("SatLockEscrow", [
    MUSD,
    BORROWER_OPERATIONS,
    aiArbiter,
  ]);

  const addresses = {
    chainId: 31611,
    network: "matsnet",
    escrow: escrow.address,
    musd: MUSD,
    borrowerOperations: BORROWER_OPERATIONS,
    aiArbiter,
    owner: deployer.account.address,
    deployedAt: new Date().toISOString(),
  };

  const outDir = resolve(__dirname, "..", "artifacts");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "addresses.matsnet.json");
  writeFileSync(outFile, JSON.stringify(addresses, null, 2) + "\n");

  console.log("SatLockEscrow deployed at:", escrow.address);
  console.log("  MUSD:              ", MUSD);
  console.log("  BorrowerOperations:", BORROWER_OPERATIONS);
  console.log("  AI arbiter:        ", aiArbiter);
  console.log("  Owner (admin):     ", deployer.account.address);
  console.log(`\nAddresses written to ${outFile}`);
  console.log("\nBackend .env  -> ESCROW_ADDRESS=" + escrow.address);
  console.log("Frontend .env -> NEXT_PUBLIC_ESCROW_ADDRESS=" + escrow.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
