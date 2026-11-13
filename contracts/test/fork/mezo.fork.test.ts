import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { parseEther, parseAbi, formatEther, createPublicClient, http, pad, toHex } from "viem";

/**
 * Runs SatLockEscrow + TroveVault against Mezo's real MUSD contracts on a Matsnet fork:
 *   pnpm test:fork
 * Skipped in the normal suite (no fork configured).
 */
const MEZO = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  borrowerOps: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
} as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);
const borrowerOpsAbi = parseAbi(["function openTrove(uint256,address,address) payable"]);
const ORACLE = "0x7b7c000000000000000000000000000000000015" as const;
const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
]);

const describeFork = "forking" in hre.network.config ? describe : describe.skip;

describeFork("Mezo Matsnet fork: per-employer troves", function () {
  this.timeout(600_000);

  it("opens, pools, reads, closes and returns BTC using Mezo's live contracts", async () => {
    const [deployer, employer, helper] = await hre.viem.getWalletClients();
    const pc = await hre.viem.getPublicClient();

    // Mezo's PriceFeed reads a Chainlink-style oracle precompile that the fork can't execute.
    // Install an aggregator there carrying the live answer/decimals read from Matsnet.
    const live = createPublicClient({ transport: http(process.env.MEZO_RPC_URL ?? "https://rpc.test.mezo.org") });
    const [, answer] = await live.readContract({ address: ORACLE, abi: aggregatorAbi, functionName: "latestRoundData" });
    const decimals = await live.readContract({ address: ORACLE, abi: aggregatorAbi, functionName: "decimals" });
    const mock = await hre.viem.deployContract("MockAggregator");
    const code = await pc.getCode({ address: mock.address });
    const test = await hre.viem.getTestClient();
    await test.setCode({ address: ORACLE, bytecode: code! });
    await test.setStorageAt({ address: ORACLE, index: 0, value: pad(toHex(answer)) });
    await test.setStorageAt({ address: ORACLE, index: 1, value: pad(toHex(decimals)) });

    const escrow = await hre.viem.deployContract("SatLockEscrow", [
      MEZO.musd,
      MEZO.borrowerOps,
      MEZO.troveManager,
      MEZO.priceFeed,
      deployer.account.address,
    ]);
    const asEmployer = await hre.viem.getContractAt("SatLockEscrow", escrow.address, {
      client: { wallet: employer },
    });

    const price = (await escrow.read.getTrove([employer.account.address])).price;
    console.log(`      PriceFeed: $${formatEther(price)} / BTC`);
    expect(price > 0n).to.equal(true);

    // Job 1 opens the employer's own trove; job 2 pools into it with adjustTrove.
    const deadline = BigInt((await time.latest()) + 7 * 86400);
    await asEmployer.write.postJobWithBTC([parseEther("1800"), deadline, "fork:1", ZERO, ZERO], {
      value: parseEther("0.1"),
    });
    await asEmployer.write.postJobWithBTC([parseEther("500"), deadline, "fork:2", ZERO, ZERO], {
      value: parseEther("0.01"),
    });

    const t = await escrow.read.getTrove([employer.account.address]);
    console.log(
      `      vault ${t.vault} status=${t.status} coll=${formatEther(t.coll)} BTC debt=${formatEther(t.debt)} MUSD ICR=${(Number(formatEther(t.icr)) * 100).toFixed(0)}%`,
    );
    expect(t.status).to.equal(1);
    expect(t.coll).to.equal(parseEther("0.11"));
    expect(await pc.readContract({ address: MEZO.musd, abi: erc20, functionName: "balanceOf", args: [escrow.address] })).to.equal(
      parseEther("2300"),
    );

    // Cancel both jobs (MUSD back to the employer), top up the fee/interest shortfall from a
    // helper trove, then close: Mezo burns debt - 200 and returns all 0.11 BTC.
    await asEmployer.write.cancelOpenJob([0n]);
    await asEmployer.write.cancelOpenJob([1n]);
    await helper.writeContract({
      address: MEZO.borrowerOps,
      abi: borrowerOpsAbi,
      functionName: "openTrove",
      args: [parseEther("1800"), ZERO, ZERO],
      value: parseEther("0.1"),
    });
    await helper.writeContract({
      address: MEZO.musd,
      abi: erc20,
      functionName: "transfer",
      args: [employer.account.address, parseEther("100")],
    });

    const vault = await hre.viem.getContractAt("TroveVault", t.vault, { client: { wallet: employer } });
    const ceiling = await pc.readContract({
      address: MEZO.musd,
      abi: erc20,
      functionName: "balanceOf",
      args: [employer.account.address],
    });
    await employer.writeContract({ address: MEZO.musd, abi: erc20, functionName: "approve", args: [vault.address, ceiling] });
    const btcBefore = await pc.getBalance({ address: employer.account.address });
    await vault.write.closeTrove([ceiling]);
    const btcGain = (await pc.getBalance({ address: employer.account.address })) - btcBefore;
    console.log(`      closed: ${formatEther(btcGain)} BTC returned to employer (net of gas)`);

    const after = await escrow.read.getTrove([employer.account.address]);
    expect(after.status).to.equal(2); // closedByOwner
    expect(btcGain > parseEther("0.109")).to.equal(true); // 0.11 BTC back, minus fork gas
    expect(await pc.getBalance({ address: vault.address })).to.equal(0n);
  });
});
