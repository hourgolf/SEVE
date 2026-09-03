// Chronological, quote-executable shadow ledger. This is deliberately separate
// from `virtual_trades`: exploratory paths may score every hypothetical signal,
// while this engine admits only opportunities that a stateful channel/account
// could have taken at an observed ask and closed at an observed bid.

export const EXECUTABLE_SHADOW_LEDGER_VERSION = "executable-shadow-ledger-v1" as const;

export type ExecutableShadowMode = "channel_isolated" | "portfolio";
export type ExecutableShadowDisposition =
  | "filled"
  | "filled_censored"
  | "blocked_channel_open"
  | "blocked_entry_cap"
  | "blocked_channel_debit"
  | "blocked_channel_stop_exposure"
  | "blocked_same_occ"
  | "blocked_family"
  | "blocked_collision_domain"
  | "blocked_underlying_capacity"
  | "blocked_account_positions"
  | "blocked_account_debit"
  | "blocked_account_stop_exposure"
  | "blocked_account_buying_power"
  | "censored_missing_contract"
  | "censored_missing_entry_quote"
  | "censored_late_entry_quote"
  | "censored_stale_entry_quote"
  | "censored_entry_spread"
  | "censored_entry_size"
  | "censored_missing_exit_quote";

export interface ExecutableShadowQuote {
  id: string;
  capturedAt: string;
  providerAt: string | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
}

export interface ExecutableAllOutManager {
  kind: "all_out";
  id: string;
  version: string;
  stopLossPct: number;
  takeProfitPct: number | null;
  forceExitAt: string;
}

export interface ExecutableFullRatchetManager {
  kind: "full_ratchet";
  id: string;
  version: string;
  stopLossPct: number;
  armPct: number;
  keepFraction: number;
  forceExitAt: string;
}

export type ExecutableShadowManager =
  | ExecutableAllOutManager
  | ExecutableFullRatchetManager;

export interface ExecutableShadowOpportunity {
  id: string;
  signalId: string;
  channelId: string;
  channelSlug: string;
  sessionDateEt: string;
  accountId: string;
  underlying: string;
  occSymbol: string | null;
  contractSelectionId: string;
  contractSelectionSnapshot: Readonly<Record<string, unknown>>;
  familyId: string | null;
  collisionDomain: string | null;
  signalAt: string;
  decisionAt: string;
  decisionClock: string;
  decisionClockAt: string;
  quantity: number;
  priority: number;
  maxEntriesPerSession: number;
  maxDebitUsd: number;
  maxStopExposureUsd: number;
  channelSpecVersionId: string;
  releaseManifestId: string;
  configurationEpochId: string;
  manager: ExecutableShadowManager;
  quotes: readonly ExecutableShadowQuote[];
  sourceRefs: readonly string[];
}

export interface ExecutableShadowAccountPolicy {
  accountId: string;
  buyingPowerUsd: number;
  maxConcurrentDebitUsd: number;
  maxConcurrentStopExposureUsd: number;
  maxOpenPositions: number;
  maxOpenByUnderlying: Readonly<Record<string, number>>;
  sameOccProtection: boolean;
  familyProtection: boolean;
  collisionDomainProtection: boolean;
}

export interface ExecutableShadowRunPolicy {
  maxEntryDelayMs: number;
  maxQuoteAgeMs: number;
  maxForceExitQuoteGapMs: number;
  maxSpreadShare: number;
  requireProviderClock: boolean;
  requireDisplayedSize: boolean;
}

export interface ExecutableShadowExit {
  reason: "target" | "stop" | "ratchet" | "force_exit";
  quoteId: string;
  at: string;
  bid: number;
  quantity: number;
}

export interface ExecutableShadowReceipt {
  schemaVersion: 1;
  engineVersion: typeof EXECUTABLE_SHADOW_LEDGER_VERSION;
  evidenceLayer: "executable_shadow";
  mode: ExecutableShadowMode;
  opportunityId: string;
  signalId: string;
  channelId: string;
  channelSlug: string;
  sessionDateEt: string;
  accountId: string;
  underlying: string;
  occSymbol: string | null;
  contractSelectionId: string;
  contractSelectionSnapshot: Record<string, unknown>;
  familyId: string | null;
  collisionDomain: string | null;
  signalAt: string;
  decisionAt: string;
  decisionClock: string;
  decisionClockAt: string;
  disposition: ExecutableShadowDisposition;
  reason: string;
  quantity: number;
  priority: number;
  maxEntriesPerSession: number;
  maxDebitUsd: number;
  maxStopExposureUsd: number;
  entryOrdinal: number | null;
  entryQuoteId: string | null;
  entryAt: string | null;
  entryAsk: number | null;
  entryDebitUsd: number | null;
  stopExposureUsd: number | null;
  exit: ExecutableShadowExit | null;
  resultPerContractUsd: number | null;
  totalResultUsd: number | null;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  captureRatio: number | null;
  channelSpecVersionId: string;
  releaseManifestId: string;
  configurationEpochId: string;
  managerId: string;
  managerVersion: string;
  managerSnapshot: ExecutableShadowManager;
  sourceRefs: string[];
  executionAuthority: false;
  orderAuthority: false;
}

export interface ExecutableShadowLedger {
  version: typeof EXECUTABLE_SHADOW_LEDGER_VERSION;
  generatedAt: string;
  modes: ExecutableShadowMode[];
  receipts: ExecutableShadowReceipt[];
  summaries: Array<{
    mode: ExecutableShadowMode;
    opportunities: number;
    fills: number;
    scored: number;
    censored: number;
    blocked: number;
    totalResultUsd: number;
  }>;
  exploratoryVirtualPathsIncluded: false;
  productionWrites: 0;
  executionAuthority: false;
  orderAuthority: false;
}

interface SimulatedExit {
  disposition: "filled" | "filled_censored";
  reason: string;
  exit: ExecutableShadowExit | null;
  resultPerContractUsd: number | null;
  totalResultUsd: number | null;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  captureRatio: number | null;
}

interface OpenPosition {
  channelSlug: string;
  sessionDateEt: string;
  accountId: string;
  underlying: string;
  occSymbol: string;
  familyId: string | null;
  collisionDomain: string | null;
  entryDebitUsd: number;
  stopExposureUsd: number;
  exitAtMs: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validIso = (value: string): boolean => Number.isFinite(Date.parse(value));
const round = (value: number, places = 4): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const quoteAgeMs = (quote: ExecutableShadowQuote): number | null => {
  if (!quote.providerAt || !validIso(quote.providerAt) || !validIso(quote.capturedAt)) return null;
  return Math.max(0, Date.parse(quote.capturedAt) - Date.parse(quote.providerAt));
};
const returnPct = (entryAsk: number, exitBid: number): number => ((exitBid - entryAsk) / entryAsk) * 100;

function assertInput(input: {
  opportunities: readonly ExecutableShadowOpportunity[];
  accountPolicies: readonly ExecutableShadowAccountPolicy[];
  policy: ExecutableShadowRunPolicy;
}): void {
  const ids = new Set<string>();
  for (const row of input.opportunities) {
    if (!row.id || ids.has(row.id)) throw new Error(`executable shadow opportunity identity is missing or duplicated: ${row.id}`);
    ids.add(row.id);
    if (!row.signalId || !row.channelId || !row.channelSlug || !row.accountId
        || !row.sessionDateEt || !row.underlying || !row.contractSelectionId
        || !row.contractSelectionSnapshot || Object.keys(row.contractSelectionSnapshot).length === 0
        || !row.decisionClock
        || !row.channelSpecVersionId || !row.releaseManifestId || !row.configurationEpochId
        || !validIso(row.signalAt) || !validIso(row.decisionAt) || !validIso(row.decisionClockAt)
        || Date.parse(row.decisionAt) < Date.parse(row.signalAt)
        || Date.parse(row.decisionAt) < Date.parse(row.decisionClockAt)
        || !Number.isInteger(row.quantity) || row.quantity < 1
        || !Number.isInteger(row.maxEntriesPerSession) || row.maxEntriesPerSession < 1
        || !Number.isFinite(row.maxDebitUsd) || row.maxDebitUsd < 0
        || !Number.isFinite(row.maxStopExposureUsd) || row.maxStopExposureUsd < 0
        || !Number.isFinite(row.priority)) {
      throw new Error(`${row.id}: executable shadow opportunity is incomplete`);
    }
    if (!row.manager.id || !row.manager.version || !validIso(row.manager.forceExitAt)
        || row.manager.stopLossPct <= 0) {
      throw new Error(`${row.id}: executable shadow manager is incomplete`);
    }
    if (row.manager.kind === "full_ratchet"
        && (row.manager.armPct <= 0 || row.manager.keepFraction <= 0
          || row.manager.keepFraction > 1)) {
      throw new Error(`${row.id}: executable shadow ratchet is invalid`);
    }
  }
  const accountIds = new Set<string>();
  for (const account of input.accountPolicies) {
    if (!account.accountId || accountIds.has(account.accountId)) {
      throw new Error(`executable shadow account policy is missing or duplicated: ${account.accountId}`);
    }
    accountIds.add(account.accountId);
    if (![account.buyingPowerUsd, account.maxConcurrentDebitUsd,
      account.maxConcurrentStopExposureUsd, account.maxOpenPositions]
      .every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error(`${account.accountId}: executable shadow account limits are invalid`);
    }
  }
  if (!Number.isFinite(input.policy.maxEntryDelayMs) || input.policy.maxEntryDelayMs < 0
      || !Number.isFinite(input.policy.maxQuoteAgeMs) || input.policy.maxQuoteAgeMs < 0
      || !Number.isFinite(input.policy.maxForceExitQuoteGapMs) || input.policy.maxForceExitQuoteGapMs < 0
      || !Number.isFinite(input.policy.maxSpreadShare) || input.policy.maxSpreadShare < 0
      || input.policy.maxSpreadShare > 1) {
    throw new Error("executable shadow quote policy is invalid");
  }
}

function baseReceipt(
  row: ExecutableShadowOpportunity,
  mode: ExecutableShadowMode,
  disposition: ExecutableShadowDisposition,
  reason: string,
): ExecutableShadowReceipt {
  return {
    schemaVersion: 1,
    engineVersion: EXECUTABLE_SHADOW_LEDGER_VERSION,
    evidenceLayer: "executable_shadow",
    mode,
    opportunityId: row.id,
    signalId: row.signalId,
    channelId: row.channelId,
    channelSlug: row.channelSlug,
    sessionDateEt: row.sessionDateEt,
    accountId: row.accountId,
    underlying: row.underlying,
    occSymbol: row.occSymbol,
    contractSelectionId: row.contractSelectionId,
    contractSelectionSnapshot: structuredClone(row.contractSelectionSnapshot),
    familyId: row.familyId,
    collisionDomain: row.collisionDomain,
    signalAt: row.signalAt,
    decisionAt: row.decisionAt,
    decisionClock: row.decisionClock,
    decisionClockAt: row.decisionClockAt,
    disposition,
    reason,
    quantity: row.quantity,
    priority: row.priority,
    maxEntriesPerSession: row.maxEntriesPerSession,
    maxDebitUsd: row.maxDebitUsd,
    maxStopExposureUsd: row.maxStopExposureUsd,
    entryOrdinal: null,
    entryQuoteId: null,
    entryAt: null,
    entryAsk: null,
    entryDebitUsd: null,
    stopExposureUsd: null,
    exit: null,
    resultPerContractUsd: null,
    totalResultUsd: null,
    returnPct: null,
    mfePct: null,
    maePct: null,
    captureRatio: null,
    channelSpecVersionId: row.channelSpecVersionId,
    releaseManifestId: row.releaseManifestId,
    configurationEpochId: row.configurationEpochId,
    managerId: row.manager.id,
    managerVersion: row.manager.version,
    managerSnapshot: structuredClone(row.manager),
    sourceRefs: [...new Set(row.sourceRefs)].sort(),
    executionAuthority: false,
    orderAuthority: false,
  };
}

function validBidQuote(
  quote: ExecutableShadowQuote,
  policy: ExecutableShadowRunPolicy,
  quantity: number,
): boolean {
  if (!validIso(quote.capturedAt) || !finite(quote.bid) || quote.bid < 0) return false;
  const age = quoteAgeMs(quote);
  if (policy.requireProviderClock && age == null) return false;
  if (age != null && age > policy.maxQuoteAgeMs) return false;
  if (policy.requireDisplayedSize && (!finite(quote.bidSize) || quote.bidSize < quantity)) return false;
  return true;
}

function entryQuote(
  row: ExecutableShadowOpportunity,
  policy: ExecutableShadowRunPolicy,
): { quote: ExecutableShadowQuote | null; disposition: ExecutableShadowDisposition; reason: string } {
  if (!row.occSymbol) {
    return { quote: null, disposition: "censored_missing_contract", reason: "No OCC contract was selected." };
  }
  const decisionAt = Date.parse(row.decisionAt);
  const ordered = [...row.quotes].sort((left, right) =>
    left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id));
  const afterDecision = ordered.filter((quote) => validIso(quote.capturedAt)
    && Date.parse(quote.capturedAt) >= decisionAt);
  if (!afterDecision.length) {
    return { quote: null, disposition: "censored_missing_entry_quote", reason: "No observed quote exists at or after the decision." };
  }
  const withinDelay = afterDecision.filter((quote) =>
    Date.parse(quote.capturedAt) - decisionAt <= policy.maxEntryDelayMs);
  if (!withinDelay.length) {
    return { quote: null, disposition: "censored_late_entry_quote", reason: "The first observed quote arrived after the allowed entry delay." };
  }
  let sawFresh = false;
  let sawExecutablePrice = false;
  let sawAdmissibleSpread = false;
  for (const quote of withinDelay) {
    const age = quoteAgeMs(quote);
    if ((policy.requireProviderClock && age == null) || (age != null && age > policy.maxQuoteAgeMs)) continue;
    sawFresh = true;
    if (!finite(quote.ask) || quote.ask <= 0 || !finite(quote.bid) || quote.bid < 0) continue;
    sawExecutablePrice = true;
    const spreadShare = (quote.ask - quote.bid) / quote.ask;
    if (spreadShare < 0 || spreadShare > policy.maxSpreadShare) continue;
    sawAdmissibleSpread = true;
    if (policy.requireDisplayedSize && (!finite(quote.askSize) || quote.askSize < row.quantity)) continue;
    return { quote, disposition: "filled", reason: "An executable ask passed the frozen quote policy." };
  }
  if (!sawFresh) return { quote: null, disposition: "censored_stale_entry_quote", reason: "No quote inside the entry window has a sufficiently fresh provider clock." };
  if (!sawExecutablePrice) return { quote: null, disposition: "censored_missing_entry_quote", reason: "No fresh quote inside the entry window has a positive executable ask." };
  if (!sawAdmissibleSpread) return { quote: null, disposition: "censored_entry_spread", reason: "No executable quote inside the entry window passes the frozen spread limit." };
  return { quote: null, disposition: "censored_entry_size", reason: "No otherwise-admissible ask inside the entry window supports the modeled quantity." };
}

function simulateExit(
  row: ExecutableShadowOpportunity,
  entry: ExecutableShadowQuote,
  policy: ExecutableShadowRunPolicy,
): SimulatedExit {
  const entryAsk = entry.ask!;
  const forceExitAt = Date.parse(row.manager.forceExitAt);
  const quotes = [...row.quotes].filter((quote) =>
    validIso(quote.capturedAt)
      && Date.parse(quote.capturedAt) >= Date.parse(entry.capturedAt)
      && Date.parse(quote.capturedAt) <= forceExitAt
      && validBidQuote(quote, policy, row.quantity))
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)
      || left.id.localeCompare(right.id));
  if (!quotes.length) {
    return {
      disposition: "filled_censored",
      reason: "The entry was quote-executable, but no fresh executable bid can close it.",
      exit: null,
      resultPerContractUsd: null,
      totalResultUsd: null,
      returnPct: null,
      mfePct: null,
      maePct: null,
      captureRatio: null,
    };
  }
  let peakReturn = Number.NEGATIVE_INFINITY;
  let troughReturn = Number.POSITIVE_INFINITY;
  let armed = false;
  let chosen: ExecutableShadowQuote | null = null;
  let reason: ExecutableShadowExit["reason"] = "force_exit";
  for (const quote of quotes) {
    const currentReturn = returnPct(entryAsk, quote.bid!);
    peakReturn = Math.max(peakReturn, currentReturn);
    troughReturn = Math.min(troughReturn, currentReturn);
    if (row.manager.kind === "all_out") {
      if (row.manager.takeProfitPct != null
          && currentReturn + 1e-9 >= row.manager.takeProfitPct) {
        chosen = quote;
        reason = "target";
        break;
      }
      if (currentReturn - 1e-9 <= -row.manager.stopLossPct) {
        chosen = quote;
        reason = "stop";
        break;
      }
    } else {
      if (peakReturn + 1e-9 >= row.manager.armPct) armed = true;
      const ratchetFloor = peakReturn * row.manager.keepFraction;
      if (armed && currentReturn - 1e-9 <= ratchetFloor) {
        chosen = quote;
        reason = "ratchet";
        break;
      }
      if (!armed && currentReturn - 1e-9 <= -row.manager.stopLossPct) {
        chosen = quote;
        reason = "stop";
        break;
      }
    }
  }
  if (!chosen) {
    const finalQuote = quotes[quotes.length - 1]!;
    if (forceExitAt - Date.parse(finalQuote.capturedAt) > policy.maxForceExitQuoteGapMs) {
      return {
        disposition: "filled_censored",
        reason: "The entry was quote-executable, but no fresh executable bid exists near the frozen force-exit clock.",
        exit: null,
        resultPerContractUsd: null,
        totalResultUsd: null,
        returnPct: null,
        mfePct: round(peakReturn),
        maePct: round(troughReturn),
        captureRatio: null,
      };
    }
    chosen = finalQuote;
  }
  const realizedReturn = returnPct(entryAsk, chosen.bid!);
  const perContract = (chosen.bid! - entryAsk) * 100;
  return {
    disposition: "filled",
    reason: `Closed on an observed bid via ${reason.replace("_", " ")}.`,
    exit: {
      reason,
      quoteId: chosen.id,
      at: chosen.capturedAt,
      bid: chosen.bid!,
      quantity: row.quantity,
    },
    resultPerContractUsd: round(perContract, 2),
    totalResultUsd: round(perContract * row.quantity, 2),
    returnPct: round(realizedReturn),
    mfePct: round(peakReturn),
    maePct: round(troughReturn),
    captureRatio: peakReturn > 0 ? round(realizedReturn / peakReturn) : null,
  };
}

function activePositions(positions: OpenPosition[], row: ExecutableShadowOpportunity): OpenPosition[] {
  const at = Date.parse(row.decisionAt);
  return positions.filter((position) => position.exitAtMs > at);
}

function block(
  row: ExecutableShadowOpportunity,
  mode: ExecutableShadowMode,
  disposition: ExecutableShadowDisposition,
  reason: string,
): ExecutableShadowReceipt {
  return baseReceipt(row, mode, disposition, reason);
}

function runMode(input: {
  mode: ExecutableShadowMode;
  opportunities: readonly ExecutableShadowOpportunity[];
  accounts: ReadonlyMap<string, ExecutableShadowAccountPolicy>;
  policy: ExecutableShadowRunPolicy;
}): ExecutableShadowReceipt[] {
  const receipts: ExecutableShadowReceipt[] = [];
  let positions: OpenPosition[] = [];
  const filledByChannelSession = new Map<string, number>();
  const ordered = [...input.opportunities].sort((left, right) =>
    left.decisionClockAt.localeCompare(right.decisionClockAt)
      || left.priority - right.priority
      || left.decisionClock.localeCompare(right.decisionClock)
      || left.decisionAt.localeCompare(right.decisionAt)
      || left.signalAt.localeCompare(right.signalAt)
      || left.channelSlug.localeCompare(right.channelSlug)
      || left.id.localeCompare(right.id));
  for (const row of ordered) {
    positions = activePositions(positions, row);
    const channelOpen = positions.some((position) => position.channelSlug === row.channelSlug);
    if (channelOpen) {
      receipts.push(block(row, input.mode, "blocked_channel_open", "The channel already had an executable-shadow position open."));
      continue;
    }
    const entryKey = `${row.channelSlug}\u0000${row.sessionDateEt}`;
    const priorEntries = filledByChannelSession.get(entryKey) ?? 0;
    if (priorEntries >= row.maxEntriesPerSession) {
      receipts.push(block(row, input.mode, "blocked_entry_cap", "The frozen same-session filled-entry cap was exhausted."));
      continue;
    }
    const selected = entryQuote(row, input.policy);
    if (!selected.quote) {
      receipts.push(block(row, input.mode, selected.disposition, selected.reason));
      continue;
    }
    const ask = selected.quote.ask!;
    const debit = ask * 100 * row.quantity;
    const stopExposure = debit * row.manager.stopLossPct / 100;
    if (debit > row.maxDebitUsd) {
      receipts.push(block(row, input.mode, "blocked_channel_debit", "The contract exceeded the channel's frozen debit envelope."));
      continue;
    }
    if (stopExposure > row.maxStopExposureUsd) {
      receipts.push(block(row, input.mode, "blocked_channel_stop_exposure", "The contract exceeded the channel's frozen stop-exposure envelope."));
      continue;
    }
    if (input.mode === "portfolio") {
      const account = input.accounts.get(row.accountId);
      if (!account) throw new Error(`${row.id}: portfolio mode lacks an account policy`);
      const occupied = positions.filter((position) => position.accountId === row.accountId);
      if (account.sameOccProtection && occupied.some((position) => position.occSymbol === row.occSymbol)) {
        receipts.push(block(row, input.mode, "blocked_same_occ", "The account already held the same OCC contract."));
        continue;
      }
      if (account.familyProtection && row.familyId
          && occupied.some((position) => position.familyId === row.familyId)) {
        receipts.push(block(row, input.mode, "blocked_family", "The account already held this protected channel family."));
        continue;
      }
      if (account.collisionDomainProtection && row.collisionDomain
          && occupied.some((position) => position.collisionDomain === row.collisionDomain)) {
        receipts.push(block(row, input.mode, "blocked_collision_domain", "The account already occupied this collision domain."));
        continue;
      }
      const underlyingOpen = occupied.filter((position) => position.underlying === row.underlying).length;
      const underlyingMax = account.maxOpenByUnderlying[row.underlying] ?? account.maxOpenPositions;
      if (underlyingOpen >= underlyingMax) {
        receipts.push(block(row, input.mode, "blocked_underlying_capacity", "The account's frozen underlying-position limit was occupied."));
        continue;
      }
      if (occupied.length >= account.maxOpenPositions) {
        receipts.push(block(row, input.mode, "blocked_account_positions", "The account's frozen open-position limit was occupied."));
        continue;
      }
      const occupiedDebit = occupied.reduce((sum, position) => sum + position.entryDebitUsd, 0);
      if (occupiedDebit + debit > account.maxConcurrentDebitUsd) {
        receipts.push(block(row, input.mode, "blocked_account_debit", "The account's frozen concurrent-debit limit was exceeded."));
        continue;
      }
      const occupiedStop = occupied.reduce((sum, position) => sum + position.stopExposureUsd, 0);
      if (occupiedStop + stopExposure > account.maxConcurrentStopExposureUsd) {
        receipts.push(block(row, input.mode, "blocked_account_stop_exposure", "The account's frozen stop-exposure limit was exceeded."));
        continue;
      }
      if (occupiedDebit + debit > account.buyingPowerUsd) {
        receipts.push(block(row, input.mode, "blocked_account_buying_power", "The account lacked modeled buying power for the executable ask."));
        continue;
      }
    }
    const simulated = simulateExit(row, selected.quote, input.policy);
    const entryOrdinal = priorEntries + 1;
    filledByChannelSession.set(entryKey, entryOrdinal);
    const receipt = {
      ...baseReceipt(row, input.mode, simulated.disposition,
        simulated.disposition === "filled" ? simulated.reason : simulated.reason),
      entryOrdinal,
      entryQuoteId: selected.quote.id,
      entryAt: selected.quote.capturedAt,
      entryAsk: ask,
      entryDebitUsd: round(debit, 2),
      stopExposureUsd: round(stopExposure, 2),
      exit: simulated.exit,
      resultPerContractUsd: simulated.resultPerContractUsd,
      totalResultUsd: simulated.totalResultUsd,
      returnPct: simulated.returnPct,
      mfePct: simulated.mfePct,
      maePct: simulated.maePct,
      captureRatio: simulated.captureRatio,
    } satisfies ExecutableShadowReceipt;
    receipts.push(receipt);
    positions.push({
      channelSlug: row.channelSlug,
      sessionDateEt: row.sessionDateEt,
      accountId: row.accountId,
      underlying: row.underlying,
      occSymbol: row.occSymbol!,
      familyId: row.familyId,
      collisionDomain: row.collisionDomain,
      entryDebitUsd: debit,
      stopExposureUsd: stopExposure,
      exitAtMs: receipt.exit ? Date.parse(receipt.exit.at) : Number.POSITIVE_INFINITY,
    });
  }
  return receipts;
}

export function buildExecutableShadowLedger(input: {
  generatedAt: string;
  opportunities: readonly ExecutableShadowOpportunity[];
  accountPolicies: readonly ExecutableShadowAccountPolicy[];
  policy: ExecutableShadowRunPolicy;
  modes?: readonly ExecutableShadowMode[];
}): ExecutableShadowLedger {
  assertInput(input);
  const modes = [...new Set(input.modes ?? ["channel_isolated", "portfolio"])] as ExecutableShadowMode[];
  const accounts = new Map(input.accountPolicies.map((row) => [row.accountId, row]));
  const receipts = modes.flatMap((mode) => runMode({
    mode,
    opportunities: input.opportunities,
    accounts,
    policy: input.policy,
  }));
  return {
    version: EXECUTABLE_SHADOW_LEDGER_VERSION,
    generatedAt: input.generatedAt,
    modes,
    receipts,
    summaries: modes.map((mode) => {
      const rows = receipts.filter((row) => row.mode === mode);
      const scored = rows.filter((row) => row.resultPerContractUsd != null);
      return {
        mode,
        opportunities: rows.length,
        fills: rows.filter((row) => row.disposition === "filled"
          || row.disposition === "filled_censored").length,
        scored: scored.length,
        censored: rows.filter((row) => row.disposition.startsWith("censored_")
          || row.disposition === "filled_censored").length,
        blocked: rows.filter((row) => row.disposition.startsWith("blocked_")).length,
        totalResultUsd: round(scored.reduce((sum, row) => sum + (row.totalResultUsd ?? 0), 0), 2),
      };
    }),
    exploratoryVirtualPathsIncluded: false,
    productionWrites: 0,
    executionAuthority: false,
    orderAuthority: false,
  };
}
