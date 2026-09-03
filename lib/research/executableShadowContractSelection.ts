// Causal contract selection for executable-shadow studies. Alternatives must
// come from one observed chain poll after the signal decision; selecting each
// arm from its own later snapshot would introduce look-ahead and liquidity bias.

export interface ExecutableShadowContractCandidate {
  id: string;
  occSymbol: string;
  optionType: string | null;
  expiration: string | null;
  strike: number | null;
  delta: number | null;
  underlyingPrice: number | null;
  capturedAt: string;
  requestStartedAt: string | null;
  observedAt: string | null;
  providerAt: string | null;
  bid: number | null;
  ask: number | null;
  askSize: number | null;
}

export type ExecutableShadowContractArm =
  | { kind: "abs_delta"; target: number }
  | { kind: "itm_steps"; steps: number; baseOccSymbol: string };

export interface ExecutableShadowContractSelectionPolicy {
  maxEntryDelayMs: number;
  maxQuoteAgeMs: number;
  maxSpreadShare: number;
  requireProviderClock: boolean;
  requireDisplayedSize: boolean;
}

export interface ExecutableShadowContractSelection {
  occSymbol: string | null;
  quoteId: string | null;
  snapshotKey: string | null;
  snapshotCapturedAt: string | null;
  strike: number | null;
  observedDelta: number | null;
  underlyingPrice: number | null;
  reason: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validIso = (value: string | null): value is string => Boolean(value && Number.isFinite(Date.parse(value)));

const snapshotKey = (row: ExecutableShadowContractCandidate): string =>
  row.requestStartedAt ?? row.observedAt ?? row.capturedAt;

export function selectExecutableShadowContract(input: {
  decisionAt: string;
  expiration: string;
  optionType: string;
  quantity: number;
  candidates: readonly ExecutableShadowContractCandidate[];
  arm: ExecutableShadowContractArm;
  policy: ExecutableShadowContractSelectionPolicy;
}): ExecutableShadowContractSelection {
  const empty = (reason: string, snapshot: string | null = null,
    capturedAt: string | null = null): ExecutableShadowContractSelection => ({
    occSymbol: null,
    quoteId: null,
    snapshotKey: snapshot,
    snapshotCapturedAt: capturedAt,
    strike: null,
    observedDelta: null,
    underlyingPrice: null,
    reason,
  });
  const decisionMs = Date.parse(input.decisionAt);
  if (!Number.isFinite(decisionMs)) return empty("invalid_decision_clock");

  const chronological = input.candidates.filter((row) => {
    const capturedMs = Date.parse(row.capturedAt);
    return row.expiration === input.expiration
      && row.optionType?.toLowerCase() === input.optionType.toLowerCase()
      && Number.isFinite(capturedMs)
      && capturedMs >= decisionMs
      && capturedMs - decisionMs <= input.policy.maxEntryDelayMs;
  }).sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)
    || left.id.localeCompare(right.id));
  if (!chronological.length) return empty("no_chain_snapshot_inside_entry_window");

  // Freeze the first post-decision chain poll for every arm. The request start
  // is shared by all contracts in a provider batch and is stronger than a
  // guessed captured_at tolerance.
  const firstKey = snapshotKey(chronological[0]!);
  const snapshot = chronological.filter((row) => snapshotKey(row) === firstKey);
  const firstCapturedAt = snapshot[0]?.capturedAt ?? null;
  const executable = snapshot.filter((row) => {
    if (!finite(row.ask) || row.ask <= 0 || !finite(row.bid) || row.bid < 0) return false;
    const spreadShare = (row.ask - row.bid) / row.ask;
    if (spreadShare < 0 || spreadShare > input.policy.maxSpreadShare) return false;
    if (input.policy.requireDisplayedSize && (!finite(row.askSize) || row.askSize < input.quantity)) return false;
    if (input.policy.requireProviderClock && !validIso(row.providerAt)) return false;
    if (validIso(row.providerAt)
        && Math.max(0, Date.parse(row.capturedAt) - Date.parse(row.providerAt)) > input.policy.maxQuoteAgeMs) return false;
    return finite(row.strike);
  });
  if (!executable.length) return empty("first_chain_snapshot_has_no_executable_contract", firstKey, firstCapturedAt);

  let selected: ExecutableShadowContractCandidate | null = null;
  if (input.arm.kind === "abs_delta") {
    const arm = input.arm;
    const withDelta = executable.filter((row) => finite(row.delta));
    if (!withDelta.length) return empty("first_chain_snapshot_has_no_observed_delta", firstKey, firstCapturedAt);
    selected = [...withDelta].sort((left, right) =>
      Math.abs(Math.abs(left.delta!) - arm.target)
        - Math.abs(Math.abs(right.delta!) - arm.target)
      || left.occSymbol.localeCompare(right.occSymbol))[0] ?? null;
  } else {
    const arm = input.arm;
    const base = snapshot.find((row) => row.occSymbol.toUpperCase() === arm.baseOccSymbol.toUpperCase());
    if (!base || !finite(base.strike)) return empty("base_contract_missing_from_first_chain_snapshot", firstKey, firstCapturedAt);
    const deeper = executable.filter((row) => input.optionType.toLowerCase() === "put"
      ? row.strike! > base.strike! : row.strike! < base.strike!);
    deeper.sort((left, right) => input.optionType.toLowerCase() === "put"
      ? left.strike! - right.strike! || left.occSymbol.localeCompare(right.occSymbol)
      : right.strike! - left.strike! || left.occSymbol.localeCompare(right.occSymbol));
    const uniqueByStrike = deeper.filter((row, index, rows) => index === 0 || row.strike !== rows[index - 1]!.strike);
    selected = uniqueByStrike[arm.steps - 1] ?? null;
    if (!selected) return empty("requested_itm_step_unavailable_in_first_chain_snapshot", firstKey, firstCapturedAt);
  }
  return selected ? {
    occSymbol: selected.occSymbol,
    quoteId: selected.id,
    snapshotKey: firstKey,
    snapshotCapturedAt: firstCapturedAt,
    strike: selected.strike,
    observedDelta: selected.delta,
    underlyingPrice: selected.underlyingPrice,
    reason: "selected_from_first_post_decision_chain_snapshot",
  } : empty("contract_selection_failed", firstKey, firstCapturedAt);
}
