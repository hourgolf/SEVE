// Bounded after-hours research repair. Default is SELECT-only dry-run. Apply
// mode can update only manager_shadow_runs and requires exact count/hash guards.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerSupabaseClient } from "./serverSupabase.js";
import {
  buildManagerShadowStaleRepairPlan,
  sha256,
  type ManagerShadowRepairPosition,
} from "../lib/research/managerShadowStaleRepair.js";
import type { ManagerShadowDbRow } from "../worker/src/managerShadowBookModel.js";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const etDate = (now = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
};

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const expectedCount = Number(arg("expected-count"));
  const expectedBeforeHash = arg("expected-before-hash");
  const sessionDateEt = arg("session") ?? etDate();
  const nowIso = new Date().toISOString();
  const outputDir = resolve(arg("output-dir") ?? `data/after-close-recovery/${sessionDateEt}/manager-shadow-reconciliation`);
  const sb = createServerSupabaseClient("reconcile-stale-manager-shadow");

  const activeRows = await pageAll<ManagerShadowDbRow>((from, to) => sb
    .from("manager_shadow_runs").select("*")
    .eq("shadow_book_version", "manager-shadow-book-v2")
    .eq("status", "active")
    .order("entry_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to));
  const positionIds = [...new Set(activeRows.map((row) => row.position_id))];
  const positions = positionIds.length
    ? await pageAll<ManagerShadowRepairPosition>((from, to) => sb.from("positions")
      .select("id,status,closed_at,close_reason,realized_pnl")
      .in("id", positionIds)
      .order("id", { ascending: true })
      .range(from, to))
    : [];
  const plan = buildManagerShadowStaleRepairPlan({ activeRows, positions, sessionDateEt, nowIso });
  if (plan.blockers.length) {
    throw new Error(`repair blocked: ${plan.blockers.map((row) => `${row.id}:${row.code}`).join(",")}`);
  }

  const receipt: Record<string, unknown> = {
    version: "manager-shadow-stale-reconciliation-v1",
    mode: apply ? "apply" : "dry-run",
    generatedAt: nowIso,
    sessionDateEt,
    allowedTables: ["manager_shadow_runs"],
    eventInserts: 0,
    activeRows: plan.activeRows,
    currentSessionRows: plan.currentSessionRows,
    proposedUpdates: plan.transitions.length,
    beforeHash: plan.beforeHash,
    proposedHash: plan.proposedHash,
    blockers: plan.blockers,
    transitions: plan.transitions,
  };

  if (apply) {
    if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount !== plan.transitions.length) {
      throw new Error(`--expected-count must equal proposed updates ${plan.transitions.length}`);
    }
    if (!expectedBeforeHash || expectedBeforeHash !== plan.beforeHash) {
      throw new Error(`--expected-before-hash must equal ${plan.beforeHash}`);
    }
    let updated = 0;
    for (const transition of plan.transitions) {
      const { data, error } = await sb.from("manager_shadow_runs")
        .update(transition.patch)
        .eq("id", transition.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`update ${transition.id} failed: ${error.message}`);
      if (!data) throw new Error(`update ${transition.id} lost optimistic active guard`);
      updated++;
    }
    const ids = plan.transitions.map((transition) => transition.id);
    const readback = ids.length
      ? await pageAll<Record<string, unknown>>((from, to) => sb.from("manager_shadow_runs")
        .select("id,status,censored_at,censor_code,censor_fact,actual_close_at,actual_close_reason,actual_realized_pnl,updated_at")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to))
      : [];
    if (readback.length !== updated || readback.some((row) => row.status !== "censored" || row.censor_code !== "missed_session_cutoff")) {
      throw new Error(`readback mismatch: updated ${updated}, verified ${readback.length}`);
    }
    receipt.updated = updated;
    receipt.verifiedReadbacks = readback.length;
    receipt.readbackHash = sha256(readback);
  }

  mkdirSync(outputDir, { recursive: true });
  const receiptFile = resolve(outputDir, apply ? "apply-receipt.json" : "dry-run-receipt.json");
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    mode: receipt.mode,
    sessionDateEt,
    activeRows: plan.activeRows,
    proposedUpdates: plan.transitions.length,
    currentSessionRows: plan.currentSessionRows,
    beforeHash: plan.beforeHash,
    proposedHash: plan.proposedHash,
    receiptFile,
  }, null, 2));
}

void main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
