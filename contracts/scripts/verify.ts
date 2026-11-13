import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";

/**
 * Verifies the deployed SatLockEscrow on Mezo's Blockscout explorer using the constructor
 * args recorded by deploy.ts. TroveVaults are created by the escrow with the same bytecode, so
 * Blockscout matches each vault once one copy is verified; pass a vault address to verify it:
 *
 *   pnpm run verify
 *   pnpm run verify -- --vault 0xVaultAddress 0xEmployerAddress
 */
const ADDRESSES = resolve(__dirname, "..", "deployments", "matsnet.json");

function hardhatVerify(address: string, args: string[], contract: string) {
  const bin = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(
    bin,
    ["hardhat", "verify", "--network", "matsnet", "--contract", contract, address, ...args],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
}

function main() {
  if (!existsSync(ADDRESSES)) throw new Error(`No ${ADDRESSES}. Run \`pnpm run deploy\` first.`);
  const a = JSON.parse(readFileSync(ADDRESSES, "utf8"));

  const vaultIdx = process.argv.indexOf("--vault");
  if (vaultIdx > -1) {
    const [vault, employer] = process.argv.slice(vaultIdx + 1, vaultIdx + 3);
    if (!vault || !employer) throw new Error("usage: --vault <vaultAddress> <employerAddress>");
    hardhatVerify(vault, [employer, a.borrowerOperations, a.musd], "src/TroveVault.sol:TroveVault");
    return;
  }
  hardhatVerify(a.escrow, a.constructorArgs, "src/SatLockEscrow.sol:SatLockEscrow");
  console.log(`\nVerified: https://explorer.test.mezo.org/address/${a.escrow}?tab=contract`);
}

main();
