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
  console.log("Deploying SatLockEscrow with:", deployer.account.address);

  const escrow = await hre.viem.deployContract("SatLockEscrow", [
    MUSD,
    BORROWER_OPERATIONS,
    aiArbiter,
  ]);

  console.log("SatLockEscrow deployed at:", escrow.address);
  console.log("  MUSD:              ", MUSD);
  console.log("  BorrowerOperations:", BORROWER_OPERATIONS);
  console.log("  AI arbiter:        ", aiArbiter);
  console.log("  Owner (admin):     ", deployer.account.address);
  console.log("\nBackend .env  -> ESCROW_ADDRESS=" + escrow.address);
  console.log("Frontend .env -> NEXT_PUBLIC_ESCROW_ADDRESS=" + escrow.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
