export type ReadinessCheckState = "pass" | "block" | "warn";

export interface ReadinessCheck {
  id: string;
  state: ReadinessCheckState;
  fact: string;
}

export interface OperationalRootIdentity {
  slug: string;
  accountId: string;
  channelVersion: string;
  managerVersion: string;
  configurationEpoch: string;
  quantity: number;
  takeProfitPct: number | null;
}

export interface OperationalReleaseContract {
  adapterId: string;
  authoritySource: string;
  releaseId: string;
  configurationSha256: string;
  strategyWorkerVersion: string;
  runtimeVersion: string;
  roots: readonly OperationalRootIdentity[];
  requiredAccountIds: readonly string[];
  paperOrigin: string;
  stockFeed: string;
  optionFeed: string;
  capture: {
    required: boolean;
    targetSamples: number;
    maxAgeMs: number;
  };
  managerObserver: {
    required: boolean;
    quoteMaxAgeMs: number;
  };
  flatBoundaryReceiptRequired: boolean;
}

export interface WorkerObservation {
  runtimeVersion: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  lastPhase: string | null;
  lastError: string | null;
}

export interface ReleaseReceiptObservation {
  releaseId: string;
  configurationSha256: string;
  strategyWorkerVersion: string | null;
  createdAt: string;
  dryRun: boolean | null;
  liveTrading: boolean | null;
  alpacaPaperOrigin: string | null;
  stockFeed: string | null;
  optionFeed: string | null;
  heldCaptureEnabled: boolean | null;
  heldCaptureTargetSamples: number | null;
  heldCaptureMaxAgeMs: number | null;
  heldCaptureReady: boolean | null;
  heldCaptureStartedBeforeBootDecision: boolean | null;
  managerObserverEnabled: boolean | null;
  managerObserverQuoteMaxAgeMs: number | null;
  flatEraBoundaryProven: boolean | null;
}

export interface PaperAccountObservation {
  accountId: string;
  name: string;
  mode: string;
  configuredArmed: boolean;
  configuredHalted: boolean;
  credentialsPresent: boolean;
  brokerReachable: boolean;
  brokerActive: boolean;
  brokerUnblocked: boolean;
  brokerIdentity: string | null;
  positionsKnown: boolean;
  ordersKnown: boolean;
  openOrderCount: number | null;
  brokerPositionCount: number | null;
  deskPositionCount: number;
  booksMatch: boolean;
}

export interface PreopenReadinessInput {
  nowMs: number;
  workerFreshMs: number;
  fund: {
    mode: string | null;
    halted: boolean | null;
  };
  contract: OperationalReleaseContract;
  bindingIssues: readonly string[];
  workers: readonly WorkerObservation[];
  receipt: ReleaseReceiptObservation | null;
  configuredPaperAccounts: readonly PaperAccountObservation[];
  unattributedDeskPositionCount: number;
}

export interface PreopenReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: ReadinessCheck[];
  warnings: ReadinessCheck[];
  currentWorker: WorkerObservation | null;
}

const SHA256 = /^[a-f0-9]{64}$/;
const finiteDate = (value: string | null): number =>
  value == null ? Number.NaN : Date.parse(value);

const check = (
  checks: ReadinessCheck[],
  id: string,
  pass: boolean,
  passFact: string,
  blockFact: string,
): void => {
  checks.push({ id, state: pass ? "pass" : "block", fact: pass ? passFact : blockFact });
};

export function evaluatePreopenReadiness(input: PreopenReadinessInput): PreopenReadinessResult {
  const checks: ReadinessCheck[] = [];
  const contract = input.contract;
  const roots = [...contract.roots];
  const rootSlugs = new Set(roots.map((root) => root.slug));
  const requiredAccountIds = new Set(contract.requiredAccountIds);

  check(
    checks,
    "release-contract",
    contract.adapterId.trim().length > 0
      && contract.authoritySource.trim().length > 0
      && contract.releaseId.trim().length > 0
      && SHA256.test(contract.configurationSha256)
      && roots.length > 0
      && rootSlugs.size === roots.length
      && requiredAccountIds.size > 0
      && roots.every((root) =>
        root.slug.trim().length > 0
        && requiredAccountIds.has(root.accountId)
        && SHA256.test(root.channelVersion.replace(/^sha256:/, ""))
        && SHA256.test(root.managerVersion.replace(/^sha256:/, ""))
        && SHA256.test(root.configurationEpoch.replace(/^sha256:/, ""))),
    `sealed runtime contract ${contract.releaseId} · ${roots.length} roots`,
    "sealed runtime contract identity is incomplete or internally inconsistent",
  );
  check(
    checks,
    "release-bindings",
    input.bindingIssues.length === 0,
    "database fleet and checked-in sealed identities are congruent",
    `release binding mismatch: ${input.bindingIssues.join(", ") || "unknown"}`,
  );
  check(
    checks,
    "paper-fund",
    input.fund.mode?.toLowerCase() === "paper" && input.fund.halted === false,
    "fund is paper and not halted",
    `fund boundary is mode=${input.fund.mode ?? "unknown"} halted=${String(input.fund.halted)}`,
  );

  const freshWorkers = input.workers.filter((worker) => {
    const heartbeatAt = finiteDate(worker.heartbeatAt);
    return Number.isFinite(heartbeatAt) && input.nowMs - heartbeatAt <= input.workerFreshMs;
  });
  const currentWorker = freshWorkers.length === 1 ? freshWorkers[0] : null;
  check(
    checks,
    "worker-cardinality",
    freshWorkers.length === 1,
    "exactly one fresh worker run observed",
    `expected one fresh worker run, observed ${freshWorkers.length}`,
  );
  if (input.workers.length > freshWorkers.length) {
    checks.push({
      id: "stale-open-worker-ledger",
      state: "warn",
      fact: `${input.workers.length - freshWorkers.length} stale open worker ledger row(s) ignored as liveness`,
    });
  }
  check(
    checks,
    "worker-runtime",
    currentWorker?.runtimeVersion === contract.runtimeVersion
      && currentWorker?.lastError == null,
    `worker runtime ${contract.runtimeVersion} is fresh and clean`,
    `worker runtime/error mismatch: observed ${currentWorker?.runtimeVersion ?? "missing"} error=${currentWorker?.lastError ?? "none"}`,
  );

  const receipt = input.receipt;
  const workerStart = finiteDate(currentWorker?.startedAt ?? null);
  const receiptAt = finiteDate(receipt?.createdAt ?? null);
  check(
    checks,
    "release-receipt-identity",
    receipt?.releaseId === contract.releaseId
      && receipt.configurationSha256 === contract.configurationSha256
      && receipt.strategyWorkerVersion === contract.strategyWorkerVersion,
    `exact ${contract.releaseId} receipt matches release, configuration, and strategy worker`,
    `release receipt identity mismatch or missing for ${contract.releaseId}`,
  );
  check(
    checks,
    "release-receipt-freshness",
    currentWorker != null
      && receipt != null
      && Number.isFinite(workerStart)
      && Number.isFinite(receiptAt)
      && receiptAt >= workerStart,
    "release receipt belongs to the current worker start",
    "release receipt is missing, invalid, or predates the current worker start",
  );
  check(
    checks,
    "paper-order-boundary",
    receipt?.alpacaPaperOrigin === contract.paperOrigin
      && receipt.dryRun === false
      && receipt.liveTrading === true,
    "paper broker origin and two-key paper executor match the sealed receipt",
    "paper broker origin or two-key paper executor is not established by the current receipt",
  );
  check(
    checks,
    "market-feeds",
    receipt?.stockFeed === contract.stockFeed
      && receipt.optionFeed === contract.optionFeed,
    `feeds match stock=${contract.stockFeed} option=${contract.optionFeed}`,
    `feed mismatch: stock=${receipt?.stockFeed ?? "unknown"} option=${receipt?.optionFeed ?? "unknown"}`,
  );

  const capturePass = !contract.capture.required || (
    receipt?.heldCaptureEnabled === true
    && receipt.heldCaptureTargetSamples === contract.capture.targetSamples
    && receipt.heldCaptureMaxAgeMs === contract.capture.maxAgeMs
    && receipt.heldCaptureReady === true
    && receipt.heldCaptureStartedBeforeBootDecision === true
  );
  check(
    checks,
    "held-capture",
    capturePass,
    contract.capture.required
      ? `held capture ready before boot decision · ${contract.capture.targetSamples} samples / ${contract.capture.maxAgeMs / 1_000}s`
      : "held capture is not required by this sealed contract",
    "held capture configuration or runtime readiness does not match the sealed contract",
  );

  const managerPass = !contract.managerObserver.required || (
    receipt?.managerObserverEnabled === true
    && receipt.managerObserverQuoteMaxAgeMs === contract.managerObserver.quoteMaxAgeMs
  );
  check(
    checks,
    "manager-observer",
    managerPass,
    contract.managerObserver.required
      ? `manager observer ready · quote max ${contract.managerObserver.quoteMaxAgeMs / 1_000}s`
      : "manager observation is not required by this sealed contract",
    "manager observer configuration does not match the sealed contract",
  );
  check(
    checks,
    "flat-boundary-receipt",
    !contract.flatBoundaryReceiptRequired || receipt?.flatEraBoundaryProven === true,
    contract.flatBoundaryReceiptRequired
      ? "startup receipt records a proven flat era boundary"
      : "flat era boundary receipt is not required by this sealed contract",
    "current release receipt does not prove the required flat era boundary",
  );

  const accounts = [...input.configuredPaperAccounts];
  check(
    checks,
    "desk-position-attribution",
    input.unattributedDeskPositionCount === 0,
    "every open desk position is attributable to a configured paper account",
    `${input.unattributedDeskPositionCount} open desk position row(s) cannot be reconciled to a configured paper account`,
  );
  check(
    checks,
    "configured-paper-account-set",
    accounts.length > 0
      && new Set(accounts.map((account) => account.accountId)).size === accounts.length
      && [...requiredAccountIds].every((id) => accounts.some((account) => account.accountId === id)),
    `${accounts.length} configured paper account(s) observed; every release-required account is included`,
    "configured paper account set is empty, duplicated, or omits a release-required account",
  );

  const brokerIdentities = accounts.flatMap((account) => account.brokerIdentity ? [account.brokerIdentity] : []);
  check(
    checks,
    "broker-identities",
    brokerIdentities.length === accounts.length
      && new Set(brokerIdentities).size === brokerIdentities.length,
    "every configured paper account resolves to a distinct broker identity",
    "broker identity is missing or duplicated across configured paper accounts",
  );

  for (const account of accounts) {
    const prefix = `account:${account.name}`;
    const required = requiredAccountIds.has(account.accountId);
    check(
      checks,
      `${prefix}:configuration`,
      account.mode.toLowerCase() === "paper"
        && (!required || (account.configuredArmed && !account.configuredHalted)),
      `${account.name}: paper configuration${required ? " is armed and not halted" : " observed outside the release manifest"}`,
      `${account.name}: ${required ? "release-required account is not armed/unhalted paper" : "configured account is not paper"}`,
    );
    check(
      checks,
      `${prefix}:broker`,
      account.credentialsPresent
        && account.brokerReachable
        && account.brokerActive
        && account.brokerUnblocked,
      `${account.name}: broker account reachable, ACTIVE, and unblocked`,
      `${account.name}: credentials, reachability, ACTIVE status, or broker block state is incomplete`,
    );
    check(
      checks,
      `${prefix}:positions`,
      account.positionsKnown && account.booksMatch,
      `${account.name}: broker and desk position books are known and congruent`,
      `${account.name}: broker/desk position truth is incomplete or mismatched`,
    );
    check(
      checks,
      `${prefix}:orders`,
      account.ordersKnown && account.openOrderCount === 0,
      `${account.name}: open broker orders known · zero`,
      `${account.name}: open broker orders are unknown or nonzero (${account.openOrderCount ?? "unknown"})`,
    );
    check(
      checks,
      `${prefix}:flat`,
      account.positionsKnown
        && account.brokerPositionCount === 0
        && account.deskPositionCount === 0,
      `${account.name}: broker and desk are flat`,
      `${account.name}: pre-open requires broker and desk flat`,
    );
  }

  const blockers = checks.filter((item) => item.state === "block");
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    warnings: checks.filter((item) => item.state === "warn"),
    currentWorker,
  };
}
