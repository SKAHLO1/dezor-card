import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import hre from "hardhat";

// Mezo Matsnet (testnet) MUSD addresses, from mezo-org/musd
// solidity/artifacts/deployments/matsnet/*.json. Re-check before a real deploy.
export const MEZO_MATSNET = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
} as const;

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

  const args = [
    MEZO_MATSNET.musd,
    MEZO_MATSNET.borrowerOperations,
    MEZO_MATSNET.troveManager,
    MEZO_MATSNET.priceFeed,
    aiArbiter,
  ] as const;
  const escrow = await hre.viem.deployContract("SatLockEscrow", [...args]);
  const publicClient = await hre.viem.getPublicClient();
  const deployBlock = await publicClient.getBlockNumber();

  const addresses = {
    chainId: 31611,
    network: "matsnet",
    escrow: escrow.address,
    ...MEZO_MATSNET,
    aiArbiter,
    owner: deployer.account.address,
    constructorArgs: args,
    deployBlock: deployBlock.toString(),
    deployedAt: new Date().toISOString(),
  };

  // Kept outside artifacts/ (Hardhat prunes unknown files there on recompile) and committed.
  const outDir = resolve(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "matsnet.json");
  writeFileSync(outFile, JSON.stringify(addresses, null, 2) + "\n");

  console.log("SatLockEscrow deployed at:", escrow.address, "(block", deployBlock.toString() + ")");
  console.log("  MUSD:              ", MEZO_MATSNET.musd);
  console.log("  BorrowerOperations:", MEZO_MATSNET.borrowerOperations);
  console.log("  TroveManager:      ", MEZO_MATSNET.troveManager);
  console.log("  PriceFeed:         ", MEZO_MATSNET.priceFeed);
  console.log("  AI arbiter:        ", aiArbiter);
  console.log("  Owner (admin):     ", deployer.account.address);
  console.log(`\nAddresses written to ${outFile}`);
  console.log("Next: `pnpm run propagate --force` then `pnpm run verify`.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
