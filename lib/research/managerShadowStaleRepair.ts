import { createHash } from "node:crypto";
import {
  attachActualClose,
  censorManagerShadowRun,
  decodeManagerShadowRun,
  encodeManagerShadowRun,
  type ManagerShadowDbRow,
} from "../../worker/src/managerShadowBookModel.js";

export interface ManagerShadowRepairPosition {
  id: string;
  status: string;
  closed_at: string | null;
  close_reason: string | null;
  realized_pnl: number | string | null;
}

export interface ManagerShadowRepairTransition {
  id: string;
  positionId: string;
  channelSlug: string;
  managerId: string;
  entryAt: string;
  priorStatus: "active";
  nextStatus: "censored";
  patch: {
    status: "censored";
    evidence_state: string;
    actual_close_at: string | null;
    actual_close_reason: string | null;
    actual_realized_pnl: number | null;
    censored_at: string;
    censor_code: "missed_session_cutoff";
    censor_fact: string;
    updated_at: string;
  };
}

export interface ManagerShadowRepairBlocker {
  id: string;
  channelSlug: string;
  managerId: string;
  code: "decode_failed" | "position_missing" | "position_open" | "position_close_incomplete";
}

export interface ManagerShadowRepairPlan {
  sessionDateEt: string;
  generatedAt: string;
  activeRows: number;
  currentSessionRows: number;
  transitions: ManagerShadowRepairTransition[];
  blockers: ManagerShadowRepairBlocker[];
  beforeHash: string;
  proposedHash: string;
}

const dateEt = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  }
  return item;
});

export const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;

export function buildManagerShadowStaleRepairPlan(input: {
  activeRows: readonly ManagerShadowDbRow[];
  positions: readonly ManagerShadowRepairPosition[];
  sessionDateEt: string;
  nowIso: string;
}): ManagerShadowRepairPlan {
  const positions = new Map(input.positions.map((position) => [position.id, position]));
  const transitions: ManagerShadowRepairTransition[] = [];
  const blockers: ManagerShadowRepairBlocker[] = [];
  let currentSessionRows = 0;
  const ordered = [...input.activeRows].sort((left, right) => left.id.localeCompare(right.id));

  for (const row of ordered) {
    if (dateEt(row.entry_at) >= input.sessionDateEt) {
      currentSessionRows++;
      continue;
    }
    let run = decodeManagerShadowRun(row);
    if (!run) {
      blockers.push({ id: row.id, channelSlug: row.channel_slug, managerId: row.manager_id, code: "decode_failed" });
      continue;
    }
    const position = positions.get(row.position_id);
    if (!position) {
      blockers.push({ id: row.id, channelSlug: row.channel_slug, managerId: row.manager_id, code: "position_missing" });
      continue;
    }
    if (position.status === "open") {
      blockers.push({ id: row.id, channelSlug: row.channel_slug, managerId: row.manager_id, code: "position_open" });
      continue;
    }
    if (!position.closed_at || position.realized_pnl == null) {
      blockers.push({ id: row.id, channelSlug: row.channel_slug, managerId: row.manager_id, code: "position_close_incomplete" });
      continue;
    }
    if (run.actualCloseAt == null) {
      run = attachActualClose(run, {
        atMs: Date.parse(position.closed_at),
        reason: position.close_reason ?? "unattributed_close",
        realizedPnl: Number(position.realized_pnl),
      });
    }
    const next = censorManagerShadowRun(run, {
      atMs: Date.parse(input.nowIso),
      code: "missed_session_cutoff",
      fact: "after-hours reconciliation found an expired active observer with no durable fresh cutoff bid",
    });
    const encoded = encodeManagerShadowRun(next, { sourceBootId: row.source_boot_id });
    if (!encoded || next.status !== "censored" || !next.censoredAt) {
      blockers.push({ id: row.id, channelSlug: row.channel_slug, managerId: row.manager_id, code: "decode_failed" });
      continue;
    }
    transitions.push({
      id: row.id,
      positionId: row.position_id,
      channelSlug: row.channel_slug,
      managerId: row.manager_id,
      entryAt: row.entry_at,
      priorStatus: "active",
      nextStatus: "censored",
      patch: {
        status: "censored",
        evidence_state: encoded.evidence_state ?? "pending_quote",
        actual_close_at: encoded.actual_close_at,
        actual_close_reason: encoded.actual_close_reason,
        actual_realized_pnl: encoded.actual_realized_pnl,
        censored_at: encoded.censored_at as string,
        censor_code: "missed_session_cutoff",
        censor_fact: encoded.censor_fact ?? "after-hours reconciliation",
        updated_at: input.nowIso,
      },
    });
  }

  return {
    sessionDateEt: input.sessionDateEt,
    generatedAt: input.nowIso,
    activeRows: ordered.length,
    currentSessionRows,
    transitions,
    blockers,
    beforeHash: sha256(ordered),
    proposedHash: sha256(transitions),
  };
}
