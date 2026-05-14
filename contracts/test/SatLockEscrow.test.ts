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
  const escrow = await hre.viem.deployContract("SatLockEscrow", [
    musd.address,
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

describe("SatLockEscrow", () => {
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

    it("posts a BTC-collateralized job by opening a trove", async () => {
      const ctx = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + 14 * DAY);
      const escrowAsEmployer = await as(ctx.escrow.address, ctx.employer);
      await escrowAsEmployer.write.postJobWithBTC(
        [parseEther("2000"), deadline, "ipfs://spec"],
        { value: parseEther("0.1") },
      );
      const id = (await ctx.escrow.read.nextJobId()) - 1n;
      const job = await ctx.escrow.read.getJob([id]);
      expect(job.status).to.equal(Status.Open);
      expect(job.mode).to.equal(1); // BTC
      expect(job.btcCollateral).to.equal(parseEther("0.1"));
      expect(await ctx.musd.read.balanceOf([ctx.escrow.address])).to.equal(parseEther("2000"));
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
