export const DESK_SAME_CLOCK_CAPACITY_REPLAY_VERSION =
  "desk-same-clock-capacity-replay-v1" as const;

export interface DeskReplayCandidate {
  id: string;
  session: string;
  atMs: number;
  sourceBarAtMs: number;
  slug: string;
  accountId: string;
  domainId: string;
  familyId: string;
  underlying: string;
  occ: string;
  quantity: number;
  maxEntriesPerSession: number;
  exitAtMs: number;
  pnlUsd: number;
  basis: "actual-executed" | "virtual-mid-basis";
  originalActed: boolean;
}

export interface DeskReplayPolicy {
  id: string;
  enabledForNewEntries: boolean;
  maxOpenPerFamily: number;
  maxOpenByUnderlying: Record<string, number>;
  maxOpenGlobal: number;
  sameOccOpenMax: number;
  reentry: "disabled" | "bounded";
  sameClockMaxByUnderlying: Record<string, number>;
  priorityBySlug: Record<string, number>;
  crossDomainSameOcc: "block" | "allow-with-receipt";
}

export interface DeskReplayVariant {
  id: string;
  label: string;
  distinctOccAtSameClock: boolean;
  policies: DeskReplayPolicy[];
}

export interface DeskReplayRejection {
  id: string;
  slug: string;
  reason: string;
}

export interface DeskReplayResult {
  version: typeof DESK_SAME_CLOCK_CAPACITY_REPLAY_VERSION;
  variantId: string;
  label: string;
  admitted: DeskReplayCandidate[];
  rejected: DeskReplayRejection[];
  modeledPnlUsd: number;
  actualPaths: number;
  virtualPaths: number;
  sessions: Array<{
    session: string;
    admitted: number;
    modeledPnlUsd: number;
  }>;
}

interface OpenPosition {
  candidate: DeskReplayCandidate;
}

function key(value: string): string {
  return value.trim().toUpperCase();
}

function priority(
  policy: DeskReplayPolicy,
  candidate: DeskReplayCandidate,
): number {
  return policy.priorityBySlug[candidate.slug] ?? Number.MAX_SAFE_INTEGER;
}

function purge(open: OpenPosition[], atMs: number): void {
  for (let index = open.length - 1; index >= 0; index--) {
    if (open[index].candidate.exitAtMs <= atMs) open.splice(index, 1);
  }
}

export function replayDeskSameClockCapacity(input: {
  candidates: DeskReplayCandidate[];
  variant: DeskReplayVariant;
}): DeskReplayResult {
  const policyById = new Map(input.variant.policies.map((row) => [row.id, row]));
  const admitted: DeskReplayCandidate[] = [];
  const rejected: DeskReplayRejection[] = [];
  const sessionRows: DeskReplayResult["sessions"] = [];
  const sessions = [...new Set(input.candidates.map((row) => row.session))].sort();

  for (const session of sessions) {
    const rows = input.candidates.filter((row) => row.session === session)
      .sort((left, right) => left.sourceBarAtMs - right.sourceBarAtMs
        || left.atMs - right.atMs || left.slug.localeCompare(right.slug));
    const open: OpenPosition[] = [];
    const enteredFamily = new Map<string, number>();
    const sessionAdmitted: DeskReplayCandidate[] = [];
    const bars = [...new Set(rows.map((row) => row.sourceBarAtMs))].sort((a, b) => a - b);

    for (const sourceBarAtMs of bars) {
      const clockRows = rows.filter((row) => row.sourceBarAtMs === sourceBarAtMs);
      purge(open, Math.min(...clockRows.map((row) => row.atMs)));
      const groups = new Map<string, DeskReplayCandidate[]>();
      for (const row of clockRows) {
        const groupKey = `${row.domainId}|${key(row.underlying)}`;
        const group = groups.get(groupKey) ?? [];
        group.push(row);
        groups.set(groupKey, group);
      }

      const clockSelected: DeskReplayCandidate[] = [];
      for (const group of groups.values()) {
        const policy = policyById.get(group[0].domainId);
        if (!policy || !policy.enabledForNewEntries) {
          for (const row of group) rejected.push({
            id: row.id, slug: row.slug, reason: "domain_disabled",
          });
          continue;
        }
        const max = policy.sameClockMaxByUnderlying[key(group[0].underlying)] ?? 0;
        const ordered = [...group].sort((left, right) =>
          priority(policy, left) - priority(policy, right)
          || left.slug.localeCompare(right.slug)
          || left.accountId.localeCompare(right.accountId));
        const selectedOcc = new Set<string>();
        for (const row of ordered) {
          const occ = key(row.occ);
          if (input.variant.distinctOccAtSameClock && selectedOcc.has(occ)) {
            rejected.push({ id: row.id, slug: row.slug, reason: "same_clock_same_occ" });
            continue;
          }
          if (clockSelected.filter((candidate) =>
            candidate.domainId === row.domainId
            && key(candidate.underlying) === key(row.underlying)).length >= max) {
            rejected.push({ id: row.id, slug: row.slug, reason: "same_clock" });
            continue;
          }
          selectedOcc.add(occ);
          clockSelected.push(row);
        }
      }

      clockSelected.sort((left, right) => left.sourceBarAtMs - right.sourceBarAtMs
        || priority(policyById.get(left.domainId)!, left)
          - priority(policyById.get(right.domainId)!, right)
        || left.slug.localeCompare(right.slug)
        || left.accountId.localeCompare(right.accountId));
      for (const row of clockSelected) {
        purge(open, row.atMs);
        const policy = policyById.get(row.domainId)!;
        const domainOpen = open.filter((position) =>
          position.candidate.domainId === row.domainId);
        const familyKey = `${row.domainId}|${row.familyId}`;
        const familyEntries = enteredFamily.get(familyKey) ?? 0;
        const otherDomainsForOcc = open.filter((position) =>
          key(position.candidate.occ) === key(row.occ)
          && position.candidate.domainId !== row.domainId);
        let reason: string | null = null;
        if (domainOpen.filter((position) =>
          position.candidate.familyId === row.familyId).length
          >= policy.maxOpenPerFamily) reason = "family_open";
        else if (policy.reentry === "disabled" && familyEntries > 0) {
          reason = "reentry_disabled";
        } else if (familyEntries >= row.maxEntriesPerSession) {
          reason = "session_entry_limit";
        } else if (domainOpen.filter((position) =>
          key(position.candidate.occ) === key(row.occ)).length
          >= policy.sameOccOpenMax) reason = "same_occ_open";
        else if (otherDomainsForOcc.length
          && policy.crossDomainSameOcc === "block") reason = "cross_domain_same_occ";
        else if (domainOpen.filter((position) =>
          key(position.candidate.underlying) === key(row.underlying)).length
          >= (policy.maxOpenByUnderlying[key(row.underlying)] ?? 0)) {
          reason = "underlying_capacity";
        } else if (domainOpen.length >= policy.maxOpenGlobal) {
          reason = "global_capacity";
        }
        if (reason) {
          rejected.push({ id: row.id, slug: row.slug, reason });
          continue;
        }
        admitted.push(row);
        sessionAdmitted.push(row);
        enteredFamily.set(familyKey, familyEntries + 1);
        open.push({ candidate: row });
      }
    }
    sessionRows.push({
      session,
      admitted: sessionAdmitted.length,
      modeledPnlUsd: Math.round(sessionAdmitted.reduce((sum, row) =>
        sum + row.pnlUsd, 0) * 100) / 100,
    });
  }

  return {
    version: DESK_SAME_CLOCK_CAPACITY_REPLAY_VERSION,
    variantId: input.variant.id,
    label: input.variant.label,
    admitted,
    rejected,
    modeledPnlUsd: Math.round(admitted.reduce((sum, row) => sum + row.pnlUsd, 0) * 100) / 100,
    actualPaths: admitted.filter((row) => row.basis === "actual-executed").length,
    virtualPaths: admitted.filter((row) => row.basis === "virtual-mid-basis").length,
    sessions: sessionRows,
  };
}

export function compareDeskReplay(
  baseline: DeskReplayResult,
  candidate: DeskReplayResult,
): {
  added: DeskReplayCandidate[];
  displaced: DeskReplayCandidate[];
  modeledPnlDeltaUsd: number;
} {
  const baselineIds = new Set(baseline.admitted.map((row) => row.id));
  const candidateIds = new Set(candidate.admitted.map((row) => row.id));
  return {
    added: candidate.admitted.filter((row) => !baselineIds.has(row.id)),
    displaced: baseline.admitted.filter((row) => !candidateIds.has(row.id)),
    modeledPnlDeltaUsd: Math.round(
      (candidate.modeledPnlUsd - baseline.modeledPnlUsd) * 100,
    ) / 100,
  };
}
