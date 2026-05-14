// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Minimal interface to Mezo's MUSD BorrowerOperations (Liquity-style trove system).
interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;
}

/// @title SatLockEscrow
/// @notice Bitcoin-native developer-services marketplace on Mezo. Buyers post and fund jobs
///         to an open marketplace — either directly in MUSD, or by locking native BTC as
///         collateral and minting MUSD against it via Mezo's trove system. Any developer can
///         claim an open job and submit work. The happy path lets the buyer accept and leave
///         an on-chain rating. Disputes are handled AI-first (the off-chain Gemini arbiter
///         calls `resolveDispute`), with an appeal window that escalates to the admin owner.
///         Funds stay locked until a settlement is final — there is never a clawback.
contract SatLockEscrow {
    enum Status {
        None,
        Open,            // posted & funded, no developer yet
        Claimed,         // a developer has taken the job
        Submitted,       // developer delivered work
        Disputed,        // a party escalated — awaiting AI arbiter
        DisputeResolved, // AI arbiter recorded a verdict — appeal window open
        Appealed,        // a party appealed the AI verdict — awaiting admin
        Released,        // funds paid to the developer (final)
        Refunded,        // funds returned to the buyer (final)
        Cancelled        // open job withdrawn by the buyer before any claim (final)
    }

    enum FundingMode { MUSD, BTC }

    struct Job {
        address employer;       // buyer who posted and funded the job
        address freelancer;     // developer who claimed it (zero until claimed)
        uint256 amount;         // MUSD held in escrow for this job
        uint256 btcCollateral;  // native BTC locked in the trove (BTC mode only)
        FundingMode mode;
        Status status;
        uint64 deadline;        // unix seconds; past this an un-submitted job can be reclaimed
        uint64 claimedAt;       // unix seconds the job was claimed (0 until claimed)
        uint64 appealDeadline;  // unix seconds; set when a dispute is AI-resolved
        bool aiVerdictApprove;  // pending AI verdict awaiting finalization (DisputeResolved)
        uint8 rating;           // 1-5 buyer rating of the developer (0 until released w/ review)
        string detailsURI;      // off-chain job spec (Firestore/IPFS/HTTPS)
    }

    uint64 public constant APPEAL_WINDOW = 3 days;

    IERC20 public immutable musd;
    IBorrowerOperations public immutable borrowerOps;
    address public owner;       // admin — final appeal authority
    address public aiArbiter;   // backend wallet — records AI dispute verdicts
    uint256 public nextJobId;

    mapping(uint256 => Job) public jobs;

    event JobPosted(uint256 indexed id, address indexed employer, uint256 amount, FundingMode mode, uint64 deadline);
    event JobClaimed(uint256 indexed id, address indexed freelancer);
    event JobUnclaimed(uint256 indexed id, address indexed freelancer);
    event WorkSubmitted(uint256 indexed id, string submissionURI);
    event JobDisputed(uint256 indexed id, address indexed by);
    event DisputeResolved(uint256 indexed id, bool approve, string rationaleURI, uint64 appealDeadline);
    event JobAppealed(uint256 indexed id, address indexed by);
    event AdminResolved(uint256 indexed id, bool approve, string rationaleURI);
    event JobReleased(uint256 indexed id, address indexed freelancer, uint256 amount, string rationaleURI);
    event JobRefunded(uint256 indexed id, address indexed employer, uint256 amount, string reason);
    event JobCancelled(uint256 indexed id, address indexed employer, uint256 amount);
    event ReviewLeft(uint256 indexed id, address indexed freelancer, uint8 rating);
    event ArbiterChanged(address indexed arbiter);
    event OwnerChanged(address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == aiArbiter, "not arbiter");
        _;
    }

    constructor(address _musd, address _borrowerOps, address _aiArbiter) {
        require(_musd != address(0) && _aiArbiter != address(0), "zero addr");
        musd = IERC20(_musd);
        borrowerOps = IBorrowerOperations(_borrowerOps);
        aiArbiter = _aiArbiter;
        owner = msg.sender;
    }

    // --------------------------------------------------------------------
    // Posting (open, unassigned jobs)
    // --------------------------------------------------------------------

    /// @notice Post a job funded with MUSD the buyer already holds. Requires prior approve().
    function postJobWithMUSD(
        uint256 amount,
        uint64 deadline,
        string calldata detailsURI
    ) external returns (uint256 id) {
        require(amount > 0, "zero amount");
        require(deadline > block.timestamp, "bad deadline");
        require(musd.transferFrom(msg.sender, address(this), amount), "MUSD transfer failed");

        id = nextJobId++;
        Job storage j = jobs[id];
        j.employer = msg.sender;
        j.amount = amount;
        j.mode = FundingMode.MUSD;
        j.status = Status.Open;
        j.deadline = deadline;
        j.detailsURI = detailsURI;

        emit JobPosted(id, msg.sender, amount, FundingMode.MUSD, deadline);
    }

    /// @notice Post a job by locking native BTC as collateral and minting MUSD against it.
    ///         The trove is owned by this contract; the buyer's BTC keeps working in Mezo's
    ///         system. Reclaiming the collateral by repaying the trove is out of scope v1.
    /// @param musdToBorrow MUSD debt to mint — must clear the protocol minimum net debt.
    function postJobWithBTC(
        uint256 musdToBorrow,
        uint64 deadline,
        string calldata detailsURI
    ) external payable returns (uint256 id) {
        require(msg.value > 0, "no BTC sent");
        require(musdToBorrow > 0, "zero debt");
        require(deadline > block.timestamp, "bad deadline");

        uint256 balBefore = musd.balanceOf(address(this));
        borrowerOps.openTrove{value: msg.value}(musdToBorrow, address(0), address(0));
        uint256 minted = musd.balanceOf(address(this)) - balBefore;
        require(minted >= musdToBorrow, "mint shortfall");

        id = nextJobId++;
        Job storage j = jobs[id];
        j.employer = msg.sender;
        j.amount = musdToBorrow;
        j.btcCollateral = msg.value;
        j.mode = FundingMode.BTC;
        j.status = Status.Open;
        j.deadline = deadline;
        j.detailsURI = detailsURI;

        emit JobPosted(id, msg.sender, musdToBorrow, FundingMode.BTC, deadline);
    }

    // --------------------------------------------------------------------
    // Lifecycle
    // --------------------------------------------------------------------

    /// @notice Any developer (other than the buyer) claims an open job.
    function claimJob(uint256 id) external {
        Job storage j = jobs[id];
        require(j.status == Status.Open, "not open");
        require(msg.sender != j.employer, "employer cannot claim");
        j.freelancer = msg.sender;
        j.claimedAt = uint64(block.timestamp);
        j.status = Status.Claimed;
        emit JobClaimed(id, msg.sender);
    }

    /// @notice Developer abandons a claimed job before submitting — returns it to the pool.
    function unclaimJob(uint256 id) external {
        Job storage j = jobs[id];
        require(msg.sender == j.freelancer, "not freelancer");
        require(j.status == Status.Claimed, "not claimed");
        j.freelancer = address(0);
        j.claimedAt = 0;
        j.status = Status.Open;
        emit JobUnclaimed(id, msg.sender);
    }

    /// @notice Developer marks work as delivered, pointing at an off-chain submission
    ///         (GitHub link or other deliverable reference).
    function submitWork(uint256 id, string calldata submissionURI) external {
        Job storage j = jobs[id];
        require(msg.sender == j.freelancer, "not freelancer");
        require(j.status == Status.Claimed, "not claimed");
        j.status = Status.Submitted;
        emit WorkSubmitted(id, submissionURI);
    }

    /// @notice Happy path: buyer accepts the submission, releases payment, and leaves a
    ///         1-5 on-chain rating for the developer's reputation.
    function approveAndRelease(uint256 id, uint8 rating) external {
        Job storage j = jobs[id];
        require(msg.sender == j.employer, "not employer");
        require(j.status == Status.Submitted, "not submitted");
        require(rating >= 1 && rating <= 5, "rating 1-5");
        j.status = Status.Released;
        j.rating = rating;
        require(musd.transfer(j.freelancer, j.amount), "payout failed");
        emit ReviewLeft(id, j.freelancer, rating);
        emit JobReleased(id, j.freelancer, j.amount, "");
    }

    /// @notice Either party escalates a submitted job to AI arbitration.
    function dispute(uint256 id) external {
        Job storage j = jobs[id];
        require(msg.sender == j.employer || msg.sender == j.freelancer, "not a party");
        require(j.status == Status.Submitted, "not submitted");
        j.status = Status.Disputed;
        emit JobDisputed(id, msg.sender);
    }

    // --------------------------------------------------------------------
    // Dispute -> appeal ladder (funds stay locked until final)
    // --------------------------------------------------------------------

    /// @notice AI arbiter records a verdict on a disputed job. Does NOT move funds — it opens
    ///         an appeal window. `rationaleURI` points at the arbiter's written reasoning.
    function resolveDispute(uint256 id, bool approve, string calldata rationaleURI)
        external
        onlyArbiter
    {
        Job storage j = jobs[id];
        require(j.status == Status.Disputed, "not disputed");
        j.status = Status.DisputeResolved;
        j.aiVerdictApprove = approve;
        j.appealDeadline = uint64(block.timestamp) + APPEAL_WINDOW;
        emit DisputeResolved(id, approve, rationaleURI, j.appealDeadline);
    }

    /// @notice Either party appeals the AI verdict before the appeal window closes,
    ///         escalating to the admin owner.
    function appeal(uint256 id) external {
        Job storage j = jobs[id];
        require(msg.sender == j.employer || msg.sender == j.freelancer, "not a party");
        require(j.status == Status.DisputeResolved, "not resolvable");
        require(block.timestamp <= j.appealDeadline, "appeal window closed");
        j.status = Status.Appealed;
        emit JobAppealed(id, msg.sender);
    }

    /// @notice After the appeal window passes with no appeal, anyone can finalize the
    ///         dispute — funds settle per the AI verdict.
    function finalizeDispute(uint256 id) external {
        Job storage j = jobs[id];
        require(j.status == Status.DisputeResolved, "not finalizable");
        require(block.timestamp > j.appealDeadline, "appeal window open");
        _settle(id, j.aiVerdictApprove, "ai-verdict-finalized");
    }

    /// @notice Admin (owner) resolves an appealed job — final settlement.
    function adminResolve(uint256 id, bool approve, string calldata rationaleURI)
        external
        onlyOwner
    {
        Job storage j = jobs[id];
        require(j.status == Status.Appealed, "not appealed");
        emit AdminResolved(id, approve, rationaleURI);
        _settle(id, approve, rationaleURI);
    }

    /// @dev Moves escrowed MUSD to the developer (approve) or back to the buyer (refund).
    function _settle(uint256 id, bool approve, string memory rationaleURI) internal {
        Job storage j = jobs[id];
        if (approve) {
            j.status = Status.Released;
            require(musd.transfer(j.freelancer, j.amount), "payout failed");
            emit JobReleased(id, j.freelancer, j.amount, rationaleURI);
        } else {
            j.status = Status.Refunded;
            require(musd.transfer(j.employer, j.amount), "refund failed");
            emit JobRefunded(id, j.employer, j.amount, rationaleURI);
        }
    }

    // --------------------------------------------------------------------
    // Buyer exits
    // --------------------------------------------------------------------

    /// @notice Buyer withdraws an open job that no developer has claimed yet.
    function cancelOpenJob(uint256 id) external {
        Job storage j = jobs[id];
        require(msg.sender == j.employer, "not employer");
        require(j.status == Status.Open, "not open");
        j.status = Status.Cancelled;
        require(musd.transfer(j.employer, j.amount), "refund failed");
        emit JobCancelled(id, j.employer, j.amount);
    }

    /// @notice Buyer reclaims escrow if the deadline passes with no work submitted —
    ///         whether the job was still Open or sitting Claimed.
    function reclaimExpired(uint256 id) external {
        Job storage j = jobs[id];
        require(msg.sender == j.employer, "not employer");
        require(j.status == Status.Open || j.status == Status.Claimed, "not reclaimable");
        require(block.timestamp > j.deadline, "not expired");
        j.status = Status.Refunded;
        require(musd.transfer(j.employer, j.amount), "refund failed");
        emit JobRefunded(id, j.employer, j.amount, "deadline-expired");
    }

    // --------------------------------------------------------------------
    // Admin
    // --------------------------------------------------------------------

    function setArbiter(address newArbiter) external onlyOwner {
        require(newArbiter != address(0), "zero addr");
        aiArbiter = newArbiter;
        emit ArbiterChanged(newArbiter);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero addr");
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    // --------------------------------------------------------------------
    // Views
    // --------------------------------------------------------------------

    function getJob(uint256 id) external view returns (Job memory) {
        return jobs[id];
    }

    /// @notice Total number of jobs ever posted — also the next id to be assigned.
    function getJobsCount() external view returns (uint256) {
        return nextJobId;
    }
}
