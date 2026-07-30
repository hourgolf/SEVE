// Domain-scoped admission model for running a LAB canary beside the sealed RC5
// control fleet. It deliberately owns no broker, database, timer, or execution
// access. The caller must supply complete broker/desk/order truth.

import type { ShadowDecision } from "./decide.js";

export interface AdmissionDomainPolicy {
  id: string;
  enabledForNewEntries: boolean;
  maxOpenPerFamily: number;
  maxOpenByUnderlying: Readonly<Record<string, number>>;
  maxOpenGlobal: number;
  sameOccOpenMax: number;
  reentry: "disabled" | "allowed";
  sameClockMaxByUnderlying: Readonly<Record<string, number>>;
  priorityBySlug: Readonly<Record<string, number>>;
  crossDomainSameOcc: "allow-with-receipt" | "block";
}

export interface AdmissionDomainOccupancy {
  domainId: string;
  accountId: string;
  familyId: string;
  underlying: string;
  occSymbol: string;
}

export interface AdmissionDomainSessionEntry {
  domainId: string;
  familyId: string;
  /** Immutable logical entry identity. Runner/remainder rows share this id. */
  entryId: string;
}

export interface DomainAdmissionState {
  openFamilyCount: Map<string, number>;
  enteredFamilyCount: Map<string, number>;
  openByUnderlying: Map<string, number>;
  openTotal: number;
  openOccCount: Map<string, number>;
}

export interface AdmissionDomainsState {
  byDomain: Map<string, DomainAdmissionState>;
  openDomainsByOcc: Map<string, Set<string>>;
}

export interface DomainAdmissionCandidate {
  domainId: string;
  accountId: string;
  familyId: string;
  underlying: string;
  sourceBarAtMs: number;
  maxEntriesPerSession: number;
  decision: ShadowDecision;
}

export interface DomainAdmissionResult extends DomainAdmissionCandidate {
  covarianceReceipts: readonly {
    kind: "cross-domain-same-occ";
    occSymbol: string;
    candidateDomain: string;
    observedOpenDomains: readonly string[];
  }[];
}

const emptyDomainState = (): DomainAdmissionState => ({
  openFamilyCount: new Map(),
  enteredFamilyCount: new Map(),
  openByUnderlying: new Map(),
  openTotal: 0,
  openOccCount: new Map(),
});

const key = (value: string): string => value.trim().toUpperCase();

export function buildAdmissionDomainsState(input: {
  open: readonly AdmissionDomainOccupancy[];
  sessionEntries: readonly AdmissionDomainSessionEntry[];
}): AdmissionDomainsState {
  const state: AdmissionDomainsState = {
    byDomain: new Map(),
    openDomainsByOcc: new Map(),
  };
  const domain = (id: string): DomainAdmissionState => {
    const found = state.byDomain.get(id);
    if (found) return found;
    const created = emptyDomainState();
    state.byDomain.set(id, created);
    return created;
  };
  for (const row of input.open) {
    const current = domain(row.domainId);
    const underlying = key(row.underlying);
    const occ = key(row.occSymbol);
    current.openFamilyCount.set(
      row.familyId,
      (current.openFamilyCount.get(row.familyId) ?? 0) + 1,
    );
    current.openByUnderlying.set(
      underlying,
      (current.openByUnderlying.get(underlying) ?? 0) + 1,
    );
    current.openTotal++;
    if (occ) {
      current.openOccCount.set(occ, (current.openOccCount.get(occ) ?? 0) + 1);
      const domains = state.openDomainsByOcc.get(occ) ?? new Set<string>();
      domains.add(row.domainId);
      state.openDomainsByOcc.set(occ, domains);
    }
  }
  const countedEntries = new Set<string>();
  for (const row of input.sessionEntries) {
    const logicalKey = `${row.domainId}|${row.familyId}|${row.entryId}`;
    if (countedEntries.has(logicalKey)) continue;
    countedEntries.add(logicalKey);
    const current = domain(row.domainId);
    current.enteredFamilyCount.set(
      row.familyId,
      (current.enteredFamilyCount.get(row.familyId) ?? 0) + 1,
    );
  }
  return state;
}

function block(decision: ShadowDecision, reason: string): ShadowDecision {
  return { ...decision, blocked: reason };
}

/**
 * Apply capacity only inside each admission domain. A matching OCC in another
 * paper account/domain is allowed only when the policy says so and always emits
 * a covariance receipt. Within-domain duplicate OCCs remain independently
 * bounded. Inputs already blocked upstream are never reopened.
 */
export function finalizeAdmissionDomains(input: {
  candidates: readonly DomainAdmissionCandidate[];
  policies: ReadonlyMap<string, AdmissionDomainPolicy>;
  state: AdmissionDomainsState;
  globalPositionTruthComplete: boolean;
  globalOrderTruthComplete: boolean;
}): DomainAdmissionResult[] {
  const output: DomainAdmissionResult[] = input.candidates.map((candidate) => ({
    ...candidate,
    decision: { ...candidate.decision },
    covarianceReceipts: [],
  }));

  const eligible = output.map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.decision.action === "enter" && !candidate.decision.blocked);

  for (const { candidate, index } of eligible) {
    const policy = input.policies.get(candidate.domainId);
    if (!policy) output[index].decision = block(candidate.decision, "admission_domain_unknown");
    else if (!Number.isInteger(candidate.maxEntriesPerSession)
        || candidate.maxEntriesPerSession < 1
        || candidate.maxEntriesPerSession > 3) {
      output[index].decision = block(candidate.decision, "admission_domain_entry_limit_invalid");
    } else if (policy.reentry === "disabled" && candidate.maxEntriesPerSession !== 1) {
      output[index].decision = block(candidate.decision, "admission_domain_reentry_policy_conflict");
    }
    else if (!policy.enabledForNewEntries) {
      output[index].decision = block(candidate.decision, "admission_domain_new_entries_disabled");
    } else if (!input.globalPositionTruthComplete) {
      output[index].decision = block(candidate.decision, "admission_global_snapshot_incomplete");
    } else if (!input.globalOrderTruthComplete) {
      output[index].decision = block(candidate.decision, "admission_global_orders_incomplete");
    }
  }

  const clocks = new Map<string, { index: number; priority: number }[]>();
  for (let index = 0; index < output.length; index++) {
    const candidate = output[index];
    const policy = input.policies.get(candidate.domainId);
    if (!policy || candidate.decision.action !== "enter" || candidate.decision.blocked) continue;
    const underlying = key(candidate.underlying);
    const max = policy.sameClockMaxByUnderlying[underlying] ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(max)) continue;
    const clock = `${candidate.domainId}|${underlying}|${candidate.sourceBarAtMs}`;
    const group = clocks.get(clock) ?? [];
    group.push({
      index,
      priority: policy.priorityBySlug[candidate.decision.slug] ?? Number.MAX_SAFE_INTEGER,
    });
    clocks.set(clock, group);
  }
  for (const group of clocks.values()) {
    const policy = input.policies.get(output[group[0].index].domainId)!;
    const max = policy.sameClockMaxByUnderlying[key(output[group[0].index].underlying)]!;
    group.sort((left, right) => left.priority - right.priority
      || output[left.index].decision.slug.localeCompare(output[right.index].decision.slug)
      || output[left.index].accountId.localeCompare(output[right.index].accountId));
    for (const loser of group.slice(max)) {
      output[loser.index].decision = block(
        output[loser.index].decision,
        "admission_domain_same_clock_collision",
      );
    }
  }

  const ordered = output.map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.decision.action === "enter" && !candidate.decision.blocked)
    .sort((left, right) => left.candidate.sourceBarAtMs - right.candidate.sourceBarAtMs
      || (input.policies.get(left.candidate.domainId)?.priorityBySlug[left.candidate.decision.slug]
        ?? Number.MAX_SAFE_INTEGER)
        - (input.policies.get(right.candidate.domainId)?.priorityBySlug[right.candidate.decision.slug]
          ?? Number.MAX_SAFE_INTEGER)
      || left.candidate.decision.slug.localeCompare(right.candidate.decision.slug)
      || left.candidate.accountId.localeCompare(right.candidate.accountId));

  for (const { candidate, index } of ordered) {
    const policy = input.policies.get(candidate.domainId)!;
    const domain = input.state.byDomain.get(candidate.domainId) ?? emptyDomainState();
    input.state.byDomain.set(candidate.domainId, domain);
    const underlying = key(candidate.underlying);
    const occ = key(candidate.decision.occ ?? "");
    const otherDomains = occ
      ? [...(input.state.openDomainsByOcc.get(occ) ?? new Set<string>())]
        .filter((id) => id !== candidate.domainId).sort()
      : [];
    let reason: string | null = null;
    if ((domain.openFamilyCount.get(candidate.familyId) ?? 0) >= policy.maxOpenPerFamily) {
      reason = "admission_domain_family_open";
    }
    else if (policy.reentry === "disabled"
        && (domain.enteredFamilyCount.get(candidate.familyId) ?? 0) > 0) {
      reason = "admission_domain_reentry_disabled";
    } else if ((domain.enteredFamilyCount.get(candidate.familyId) ?? 0)
        >= candidate.maxEntriesPerSession) {
      reason = "admission_domain_session_entry_limit";
    } else if (occ && (domain.openOccCount.get(occ) ?? 0) >= policy.sameOccOpenMax) {
      reason = "admission_domain_same_occ_open";
    } else if (otherDomains.length && policy.crossDomainSameOcc === "block") {
      reason = "admission_cross_domain_same_occ_open";
    } else if ((domain.openByUnderlying.get(underlying) ?? 0)
      >= (policy.maxOpenByUnderlying[underlying] ?? 0)) {
      reason = "admission_domain_underlying_concurrency";
    } else if (domain.openTotal >= policy.maxOpenGlobal) {
      reason = "admission_domain_global_concurrency";
    }
    if (reason) {
      output[index].decision = block(candidate.decision, reason);
      continue;
    }
    if (otherDomains.length) {
      output[index].covarianceReceipts = [{
        kind: "cross-domain-same-occ",
        occSymbol: occ,
        candidateDomain: candidate.domainId,
        observedOpenDomains: otherDomains,
      }];
    }
    domain.openFamilyCount.set(
      candidate.familyId,
      (domain.openFamilyCount.get(candidate.familyId) ?? 0) + 1,
    );
    domain.enteredFamilyCount.set(
      candidate.familyId,
      (domain.enteredFamilyCount.get(candidate.familyId) ?? 0) + 1,
    );
    domain.openByUnderlying.set(
      underlying,
      (domain.openByUnderlying.get(underlying) ?? 0) + 1,
    );
    domain.openTotal++;
    if (occ) {
      domain.openOccCount.set(occ, (domain.openOccCount.get(occ) ?? 0) + 1);
      const domains = input.state.openDomainsByOcc.get(occ) ?? new Set<string>();
      domains.add(candidate.domainId);
      input.state.openDomainsByOcc.set(occ, domains);
    }
  }
  return output;
}
