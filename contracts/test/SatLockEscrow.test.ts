import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { parseEther, getAddress } from "viem";

// Status enum mirror (see SatLockEscrow.sol)
const Status = {
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

const DAY = 24 * 60 * 60;

async function deployFixture() {
  const [owner, arbiter, employer, dev, other] = await hre.viem.getWalletClients();

  const musd = await hre.viem.deployContract("MockMUSD");
  const borrowerOps = await hre.viem.deployContract("MockBorrowerOperations", [musd.address]);
  // The mock implements BorrowerOperations, TroveManager and PriceFeed in one contract.
  const escrow = await hre.viem.deployContract("SatLockEscrow", [
    musd.address,
    borrowerOps.address,
    borrowerOps.address,
    borrowerOps.address,
    arbiter.account.address,
  ]);

  // Fund the employer with MUSD and pre-approve the escrow.
  const fund = parseEther("10000");
  await musd.write.mint([employer.account.address, fund]);

  const publicClient = await hre.viem.getPublicClient();

  return { owner, arbiter, employer, dev, other, musd, borrowerOps, escrow, publicClient };
}

/** Post a MUSD-funded job from the employer and return its id. */
async function postMusdJob(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  amount = parseEther("1000"),
  deadlineFromNow = 14 * DAY,
) {
  const { escrow, musd, employer } = ctx;
  await musd.write.approve([escrow.address, amount], { account: employer.account });
  const deadline = BigInt((await time.latest()) + deadlineFromNow);
  const escrowAsEmployer = await hre.viem.getContractAt("SatLockEscrow", escrow.address, {
    client: { wallet: employer },
  });
  await escrowAsEmployer.write.postJobWithMUSD([amount, deadline, "ipfs://spec"]);
  const id = (await escrow.read.nextJobId()) - 1n;
  return id;
}

function as(escrowAddress: `0x${string}`, wallet: any) {
  return hre.viem.getContractAt("SatLockEscrow", escrowAddress, { client: { wallet } });
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TroveStatus = { none: 0, active: 1, closedByOwner: 2, closedByLiquidation: 3 } as const;

/** Post a BTC-funded job from `wallet`, sending `btc` as collateral, and return its id. */
async function postBtcJob(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  wallet: any,
  musdToBorrow: bigint,
  btc: bigint,
) {
  const deadline = BigInt((await time.latest()) + 14 * DAY);
  await (await as(ctx.escrow.address, wallet)).write.postJobWithBTC(
    [musdToBorrow, deadline, "ipfs://spec", ZERO, ZERO],
    { value: btc },
  );
  return (await ctx.escrow.read.nextJobId()) - 1n;
}

async function vaultOf(ctx: Awaited<ReturnType<typeof deployFixture>>, wallet: any) {
  const addr = await ctx.escrow.read.vaultOf([wallet.account.address]);
  return hre.viem.getContractAt("TroveVault", addr, { client: { wallet } });
}

describe("SatLockEscrow", () => {
  describe("employer troves (Mezo BorrowerOperations / TroveManager / PriceFeed)", () => {
    it("first BTC job creates the employer's vault and opens its own trove", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));

      const job = await ctx.escrow.read.getJob([id]);
      expect(job.mode).to.equal(1);
      expect(job.btcCollateral).to.equal(parseEther("0.1"));
      expect(await ctx.musd.read.balanceOf([ctx.escrow.address])).to.equal(parseEther("2000"));

      const vault = await ctx.escrow.read.vaultOf([ctx.employer.account.address]);
      expect(vault).to.not.equal(ZERO);
      // The trove belongs to the vault, not the escrow.
      expect(await ctx.borrowerOps.read.getTroveStatus([vault])).to.equal(TroveStatus.active);
      expect(await ctx.borrowerOps.read.getTroveStatus([ctx.escrow.address])).to.equal(TroveStatus.none);

      const t = await ctx.escrow.read.getTrove([ctx.employer.account.address]);
      expect(getAddress(t.vault)).to.equal(getAddress(vault));
      expect(t.status).to.equal(TroveStatus.active);
      expect(t.coll).to.equal(parseEther("0.1"));
      // 2000 principal + 0.1% fee + 200 gas compensation
      expect(t.debt).to.equal(parseEther("2202"));
      expect(t.price).to.equal(parseEther("75000"));
      expect(t.icr).to.equal((parseEther("0.1") * parseEther("75000")) / parseEther("2202"));
    });

    it("pools a second job into the same trove with adjustTrove", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));
      const vaultBefore = await ctx.escrow.read.vaultOf([ctx.employer.account.address]);

      // No new BTC: borrows against the existing collateral (0.1 BTC @ $75k = $7.5k).
      const id2 = await postBtcJob(ctx, ctx.employer, parseEther("1000"), 0n);
      expect(await ctx.escrow.read.vaultOf([ctx.employer.account.address])).to.equal(vaultBefore);

      const t = await ctx.escrow.read.getTrove([ctx.employer.account.address]);
      expect(t.coll).to.equal(parseEther("0.1"));
      expect(t.debt).to.equal(parseEther("3203")); // 2202 + 1000 + 1 fee
      expect((await ctx.escrow.read.getJob([id2])).amount).to.equal(parseEther("1000"));
      expect(await ctx.musd.read.balanceOf([ctx.escrow.address])).to.equal(parseEther("3000"));
    });

    it("gives each employer a separate vault and trove", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));
      await postBtcJob(ctx, ctx.other, parseEther("1800"), parseEther("0.05"));
      const a = await ctx.escrow.read.vaultOf([ctx.employer.account.address]);
      const b = await ctx.escrow.read.vaultOf([ctx.other.account.address]);
      expect(a).to.not.equal(b);
      expect(await ctx.borrowerOps.read.getTroveStatus([a])).to.equal(TroveStatus.active);
      expect(await ctx.borrowerOps.read.getTroveStatus([b])).to.equal(TroveStatus.active);
    });

    it("rejects opening a trove without BTC", async () => {
      const ctx = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + DAY);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.postJobWithBTC([
          parseEther("2000"), deadline, "x", ZERO, ZERO,
        ]),
      ).to.be.rejectedWith("no BTC sent");
    });

    it("employer repays part of the debt through the vault", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2500"), parseEther("0.1"));
      const vault = await vaultOf(ctx, ctx.employer);
      await ctx.musd.write.approve([vault.address, parseEther("300")], { account: ctx.employer.account });
      await vault.write.repay([parseEther("300"), ZERO, ZERO]);
      const t = await ctx.escrow.read.getTrove([ctx.employer.account.address]);
      expect(t.debt).to.equal(parseEther("2402.5")); // 2500 + 2.5 fee + 200 - 300
    });

    it("employer closes the trove and gets all BTC back, then can reopen", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));
      const vault = await vaultOf(ctx, ctx.employer);

      // debt 2202 -> owner burns 2002 (gas compensation is burned from the gas pool).
      const ceiling = parseEther("2100");
      await ctx.musd.write.approve([vault.address, ceiling], { account: ctx.employer.account });
      const musdBefore = await ctx.musd.read.balanceOf([ctx.employer.account.address]);
      const btcBefore = await ctx.publicClient.getBalance({ address: ctx.employer.account.address });

      await vault.write.closeTrove([ceiling]);

      expect(await ctx.borrowerOps.read.getTroveStatus([vault.address])).to.equal(TroveStatus.closedByOwner);
      expect(musdBefore - (await ctx.musd.read.balanceOf([ctx.employer.account.address]))).to.equal(
        parseEther("2002"),
      );
      const btcGain =
        (await ctx.publicClient.getBalance({ address: ctx.employer.account.address })) - btcBefore;
      expect(btcGain > parseEther("0.099")).to.equal(true); // 0.1 BTC back, minus gas
      expect(await ctx.publicClient.getBalance({ address: vault.address })).to.equal(0n);

      // A later BTC job reopens a fresh trove in the same vault.
      await postBtcJob(ctx, ctx.employer, parseEther("1800"), parseEther("0.05"));
      expect(await ctx.borrowerOps.read.getTroveStatus([vault.address])).to.equal(TroveStatus.active);
    });

    it("employer withdraws excess collateral", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.2"));
      const vault = await vaultOf(ctx, ctx.employer);
      await vault.write.withdrawCollateral([parseEther("0.05"), ZERO, ZERO]);
      expect((await ctx.escrow.read.getTrove([ctx.employer.account.address])).coll).to.equal(
        parseEther("0.15"),
      );
      expect(await ctx.publicClient.getBalance({ address: vault.address })).to.equal(0n);
    });

    it("employer claims surplus collateral after a liquidation", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));
      const vault = await vaultOf(ctx, ctx.employer);
      await ctx.borrowerOps.write.liquidateWithSurplus([vault.address, parseEther("0.03")]);

      const before = await ctx.publicClient.getBalance({ address: ctx.employer.account.address });
      await vault.write.claimCollateral();
      const gain = (await ctx.publicClient.getBalance({ address: ctx.employer.account.address })) - before;
      expect(gain > parseEther("0.029")).to.equal(true);
      expect(await ctx.borrowerOps.read.surplus([vault.address])).to.equal(0n);
    });

    it("only the employer can manage the vault, only the escrow can borrow through it", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.1"));
      const addr = await ctx.escrow.read.vaultOf([ctx.employer.account.address]);
      const asOther = await hre.viem.getContractAt("TroveVault", addr, { client: { wallet: ctx.other } });
      await expect(asOther.write.closeTrove([0n])).to.be.rejectedWith("not employer");
      await expect(asOther.write.claimCollateral()).to.be.rejectedWith("not employer");
      await expect(asOther.write.borrowMoreFor([parseEther("1"), ZERO, ZERO])).to.be.rejectedWith(
        "not escrow",
      );
    });

    it("reverts when the new debt would push the trove below MCR", async () => {
      const ctx = await loadFixture(deployFixture);
      await postBtcJob(ctx, ctx.employer, parseEther("2000"), parseEther("0.05"));
      await ctx.borrowerOps.write.setPrice([parseEther("50000")]); // 0.05 BTC = $2.5k
      const deadline = BigInt((await time.latest()) + DAY);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.postJobWithBTC([
          parseEther("1000"), deadline, "x", ZERO, ZERO,
        ]),
      ).to.be.rejectedWith("ICR below MCR");
    });
  });

  describe("submission record", () => {
    it("stores the WorkSubmitted block so the URL can be read back from the event", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "https://github.com/x/y"]);

      const job = await ctx.escrow.read.getJob([id]);
      expect(job.submittedBlock > 0n).to.equal(true);
      const logs = await ctx.escrow.getEvents.WorkSubmitted(
        { id },
        { fromBlock: job.submittedBlock, toBlock: job.submittedBlock },
      );
      expect(logs).to.have.length(1);
      expect(logs[0].args.submissionURI).to.equal("https://github.com/x/y");
    });
  });

  describe("posting", () => {
    it("posts a MUSD-funded job and locks the funds", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Open);
      expect(job.amount).to.equal(parseEther("1000"));
      expect(getAddress(job.employer)).to.equal(getAddress(ctx.employer.account.address));
      expect(await ctx.musd.read.balanceOf([ctx.escrow.address])).to.equal(parseEther("1000"));
    });

    it("rejects a deadline in the past", async () => {
      const ctx = await loadFixture(deployFixture);
      await ctx.musd.write.approve([ctx.escrow.address, parseEther("1000")], {
        account: ctx.employer.account,
      });
      const escrowAsEmployer = await as(ctx.escrow.address, ctx.employer);
      const past = BigInt((await time.latest()) - 1);
      await expect(
        escrowAsEmployer.write.postJobWithMUSD([parseEther("1000"), past, "x"]),
      ).to.be.rejectedWith("bad deadline");
    });
  });

  describe("happy path", () => {
    it("claim -> submit -> approveAndRelease pays the developer and records a rating", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);

      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      expect((await ctx.escrow.read.getJob([id])).status).to.equal(Status.Claimed);

      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "github.com/x/y"]);
      expect((await ctx.escrow.read.getJob([id])).status).to.equal(Status.Submitted);

      await (await as(ctx.escrow.address, ctx.employer)).write.approveAndRelease([id, 5]);

      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Released);
      expect(job.rating).to.equal(5);
      expect(await ctx.musd.read.balanceOf([ctx.dev.account.address])).to.equal(parseEther("1000"));
    });

    it("rejects an out-of-range rating", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.approveAndRelease([id, 0]),
      ).to.be.rejectedWith("rating 1-5");
    });

    it("the employer cannot claim their own job", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.claimJob([id]),
      ).to.be.rejectedWith("employer cannot claim");
    });

    it("unclaim returns a job to the open pool", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.unclaimJob([id]);
      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Open);
      expect(BigInt(job.freelancer)).to.equal(0n);
    });
  });

  describe("dispute -> finalize (no appeal)", () => {
    it("AI verdict finalizes to the developer after the appeal window", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await (await as(ctx.escrow.address, ctx.employer)).write.dispute([id]);

      await (await as(ctx.escrow.address, ctx.arbiter)).write.resolveDispute([
        id,
        true,
        "ipfs://rationale",
      ]);
      expect((await ctx.escrow.read.getJob([id])).status).to.equal(Status.DisputeResolved);

      // Cannot finalize while the window is open.
      await expect(
        (await as(ctx.escrow.address, ctx.other)).write.finalizeDispute([id]),
      ).to.be.rejectedWith("appeal window open");

      await time.increase(3 * DAY + 1);
      await (await as(ctx.escrow.address, ctx.other)).write.finalizeDispute([id]);

      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Released);
      expect(await ctx.musd.read.balanceOf([ctx.dev.account.address])).to.equal(parseEther("1000"));
    });

    it("a non-arbiter cannot resolve a dispute", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await (await as(ctx.escrow.address, ctx.employer)).write.dispute([id]);
      await expect(
        (await as(ctx.escrow.address, ctx.other)).write.resolveDispute([id, true, "x"]),
      ).to.be.rejectedWith("not arbiter");
    });
  });

  describe("dispute -> appeal -> adminResolve", () => {
    it("escalates to the admin, who refunds the employer", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await (await as(ctx.escrow.address, ctx.dev)).write.dispute([id]);

      // AI sides with the developer...
      await (await as(ctx.escrow.address, ctx.arbiter)).write.resolveDispute([id, true, "x"]);
      // ...but the employer appeals within the window.
      await (await as(ctx.escrow.address, ctx.employer)).write.appeal([id]);
      expect((await ctx.escrow.read.getJob([id])).status).to.equal(Status.Appealed);

      // Admin (owner) overturns it and refunds the employer.
      const employerBefore = await ctx.musd.read.balanceOf([ctx.employer.account.address]);
      await (await as(ctx.escrow.address, ctx.owner)).write.adminResolve([id, false, "ipfs://final"]);

      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Refunded);
      expect(await ctx.musd.read.balanceOf([ctx.employer.account.address])).to.equal(
        employerBefore + parseEther("1000"),
      );
    });

    it("cannot appeal after the window closes", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await (await as(ctx.escrow.address, ctx.employer)).write.dispute([id]);
      await (await as(ctx.escrow.address, ctx.arbiter)).write.resolveDispute([id, true, "x"]);
      await time.increase(3 * DAY + 1);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.appeal([id]),
      ).to.be.rejectedWith("appeal window closed");
    });

    it("only the owner can adminResolve", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await (await as(ctx.escrow.address, ctx.dev)).write.submitWork([id, "x"]);
      await (await as(ctx.escrow.address, ctx.employer)).write.dispute([id]);
      await (await as(ctx.escrow.address, ctx.arbiter)).write.resolveDispute([id, true, "x"]);
      await (await as(ctx.escrow.address, ctx.employer)).write.appeal([id]);
      await expect(
        (await as(ctx.escrow.address, ctx.other)).write.adminResolve([id, true, "x"]),
      ).to.be.rejectedWith("not owner");
    });
  });

  describe("buyer exits", () => {
    it("cancels an unclaimed open job and refunds the employer", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      const before = await ctx.musd.read.balanceOf([ctx.employer.account.address]);
      await (await as(ctx.escrow.address, ctx.employer)).write.cancelOpenJob([id]);
      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Cancelled);
      expect(await ctx.musd.read.balanceOf([ctx.employer.account.address])).to.equal(
        before + parseEther("1000"),
      );
    });

    it("cannot cancel a job that has been claimed", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.cancelOpenJob([id]),
      ).to.be.rejectedWith("not open");
    });

    it("reclaims an expired claimed job", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx, parseEther("1000"), 7 * DAY);
      await (await as(ctx.escrow.address, ctx.dev)).write.claimJob([id]);
      await time.increase(7 * DAY + 1);
      const before = await ctx.musd.read.balanceOf([ctx.employer.account.address]);
      await (await as(ctx.escrow.address, ctx.employer)).write.reclaimExpired([id]);
      expect((await ctx.escrow.read.getJob([id])).status).to.equal(Status.Refunded);
      expect(await ctx.musd.read.balanceOf([ctx.employer.account.address])).to.equal(
        before + parseEther("1000"),
      );
    });

    it("cannot reclaim before the deadline", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await postMusdJob(ctx);
      await expect(
        (await as(ctx.escrow.address, ctx.employer)).write.reclaimExpired([id]),
      ).to.be.rejectedWith("not expired");
    });
  });

  describe("admin", () => {
    it("owner can rotate the arbiter and owner", async () => {
      const ctx = await loadFixture(deployFixture);
      await (await as(ctx.escrow.address, ctx.owner)).write.setArbiter([ctx.other.account.address]);
      expect(getAddress(await ctx.escrow.read.aiArbiter())).to.equal(
        getAddress(ctx.other.account.address),
      );
      await (await as(ctx.escrow.address, ctx.owner)).write.setOwner([ctx.other.account.address]);
      expect(getAddress(await ctx.escrow.read.owner())).to.equal(
        getAddress(ctx.other.account.address),
      );
    });
  });
});
