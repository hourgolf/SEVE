// SELECT-only confirmation for prospective immutable position-account receipts.
// It never infers an account from mutable strategist assignment and never writes
// evidence, configuration, positions, or orders.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import {
  auditProspectivePositionRouteReceipts,
  type ProspectiveRoutePosition,
  type ProspectiveRouteReceipt,
} from "../lib/ops/positionRouteReceiptAudit";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}

const SINCE = arg("since");
const REQUIRE_OBSERVATION = process.argv.includes("--require-observation");
if (!SINCE || !Number.isFinite(Date.parse(SINCE))) {
  throw new Error("--since must be an ISO timestamp");
}

const READ_OPTIONS = {
  pageSize: 250,
  attempts: 3,
  retryDelaysMs: [250, 750],
  timeoutMs: 15_000,
} as const;

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("prospective-position-route-audit");
  const [accounts, positionRows] = await Promise.all([
    pageAll<{ id: string }>((from) => sb.from("accounts")
      .select("id")
      .eq("mode", "paper")
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 1_000,
    }),
    pageAll<Omit<ProspectiveRoutePosition, "parent_position_id">>((from) => sb
      .from("positions")
      .select([
        "id",
        "strategist_id",
        "opened_at",
        "runner_of",
        "entry_reason",
        "channel_spec_version_id",
        "release_manifest_id",
        "configuration_epoch_id",
      ].join(","))
      .gte("opened_at", SINCE)
      .order("opened_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 5_000,
    }),
  ]);
  const positionIds = positionRows.map((row) => row.id);
  const outcomes: Array<{ position_id: string; parent_position_id: string | null }> = [];
  const receipts: ProspectiveRouteReceipt[] = [];
  for (const batch of chunks(positionIds, 75)) {
    outcomes.push(...await pageAll((from) => sb.from("position_outcome_events")
      .select("position_id,parent_position_id")
      .in("position_id", batch)
      .not("parent_position_id", "is", null)
      .order("event_at", { ascending: true }), {
      ...READ_OPTIONS,
      max: 10_000,
    }));
    receipts.push(...await pageAll<ProspectiveRouteReceipt>((from) => sb
      .from("execution_observations")
      .select([
        "id",
        "event_kind",
        "event_at",
        "strategist_id",
        "account_id",
        "position_id",
        "action",
        "reason",
        "blocked_reason",
        "channel_spec_version_id",
        "release_manifest_id",
        "configuration_epoch_id",
        "payload",
      ].join(","))
      .in("position_id", batch)
      .eq("reason", "position_account_route_bound")
      .order("event_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 10_000,
    }));
  }
  const parentByPosition = new Map<string, string>();
  for (const outcome of outcomes) {
    if (!outcome.parent_position_id) continue;
    const existing = parentByPosition.get(outcome.position_id);
    if (existing && existing !== outcome.parent_position_id) {
      throw new Error(`position ${outcome.position_id} has conflicting immutable parents`);
    }
    parentByPosition.set(outcome.position_id, outcome.parent_position_id);
  }
  const positions: ProspectiveRoutePosition[] = positionRows.map((position) => ({
    ...position,
    parent_position_id: parentByPosition.get(position.id) ?? position.runner_of ?? null,
  }));
  const audit = auditProspectivePositionRouteReceipts({
    positions,
    receipts,
    configuredPaperAccountIds: new Set(accounts.map((account) => account.id)),
  });

  console.log("\n══ PROSPECTIVE POSITION-ROUTE RECEIPT AUDIT · SELECT ONLY ══");
  console.log(`Since        : ${new Date(SINCE).toISOString()}`);
  console.log(`State        : ${audit.state.toUpperCase()}`);
  console.log(`Positions    : ${audit.positions}`);
  console.log(`Receipts     : ${audit.receipts}`);
  console.log(`Paper accts  : ${audit.configuredPaperAccounts}`);
  for (const issue of audit.issues) console.log(`  BLOCK ${issue}`);
  if (audit.state === "pending") {
    console.log("Result       : no prospective position exists yet; confirmation remains pending");
    if (REQUIRE_OBSERVATION) process.exitCode = 2;
  } else if (audit.state === "fail") {
    console.log("Result       : immutable prospective routing confirmation failed closed");
    process.exitCode = 1;
  } else {
    console.log("Result       : every prospective position has one exact immutable route receipt");
  }
  console.log("Authority    : no history mutation · no configuration change · no order authority");
}

void main().catch((error) => {
  console.error(
    `prospective-position-route-audit failed closed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
