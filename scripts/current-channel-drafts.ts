// Read-only materialization of evidence-only draft cartridges. Supabase calls
// are SELECT-only; the sole write is a gitignored local JSON receipt.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { familyForChannel } from "../worker/src/familyAdmissionModel.js";
import {
  buildCurrentChannelDraftFleet,
  type DecisionTimingReceipt,
  type FamilyObservationReceipt,
} from "../lib/strategy/currentChannelDrafts.js";
import type { CurrentFleetInventory } from "../lib/strategy/currentChannelInventory.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const todayEt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const INPUT = arg("inventory", `data/channel-cartridge-inventories/${todayEt}.json`);
const OUT = arg("out", `data/channel-cartridge-drafts/${todayEt}.json`);
const END_ISO = arg("end", new Date().toISOString());
const START_ISO = arg("start", new Date(Date.parse(END_ISO) - 7 * 86_400_000).toISOString());

async function page<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

interface InventoryReceipt { inventory: CurrentFleetInventory }
interface TimingRow { channel_slug: string; source_bar_at: string; event_at: string; action: string; blocked_reason: string | null }
interface FamilyRow { family_id: string; source_bar_at: string; candidates: unknown }

function candidateSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => row && typeof row === "object" ? String((row as Record<string, unknown>).channelSlug ?? "") : "")
    .filter(Boolean).sort();
}

async function readEvidence(sb: SupabaseClient, slugs: string[]): Promise<{ timings: DecisionTimingReceipt[]; nonAdmissionDecisionRowsExcluded: number; families: FamilyObservationReceipt[] }> {
  const [timingRows, familyRows] = await Promise.all([
    slugs.length ? page<TimingRow>((from, to) => sb.from("execution_observations")
      .select("channel_slug,source_bar_at,event_at,action,blocked_reason")
      .eq("event_kind", "decision")
      .in("channel_slug", slugs)
      .gte("event_at", START_ISO).lt("event_at", END_ISO)
      .order("event_at").range(from, to), "execution_observations") : Promise.resolve([]),
    page<FamilyRow>((from, to) => sb.from("family_admission_observations")
      .select("family_id,source_bar_at,candidates")
      .gte("source_bar_at", START_ISO).lt("source_bar_at", END_ISO)
      .order("source_bar_at").range(from, to), "family_admission_observations"),
  ]);
  const liveTimingRows = timingRows.filter((row) => row.action === "enter" && row.blocked_reason !== "observation_only");
  return {
    timings: liveTimingRows.map((row) => ({ channelSlug: row.channel_slug, sourceBarAt: row.source_bar_at, eventAt: row.event_at })),
    nonAdmissionDecisionRowsExcluded: timingRows.length - liveTimingRows.length,
    families: familyRows.map((row) => ({ familyId: row.family_id, sourceBarAt: row.source_bar_at, candidateSlugs: candidateSlugs(row.candidates) })),
  };
}

async function main(): Promise<void> {
  const rawInventory = readFileSync(INPUT);
  const input = JSON.parse(rawInventory.toString("utf8")) as InventoryReceipt;
  if (!input.inventory?.channels) throw new Error(`invalid inventory receipt: ${INPUT}`);
  const preselection = buildCurrentChannelDraftFleet(input.inventory.channels, [], [], { requested: 14 });
  const slugs = preselection.drafts.map((draft) => draft.identity.slug);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const evidence = await readEvidence(sb, slugs);
  const collisionFamilyBySlug = Object.fromEntries(slugs.flatMap((slug) => {
    const family = familyForChannel(slug);
    return family ? [[slug, family]] : [];
  }));
  const fleet = buildCurrentChannelDraftFleet(input.inventory.channels, evidence.timings, evidence.families, {
    requested: 14, targetSlugs: slugs, collisionFamilyBySlug,
  });
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "read_only_current_channel_draft_materialization",
    queryWindow: { start: START_ISO, end: END_ISO },
    input: { path: INPUT, sha256: createHash("sha256").update(rawInventory).digest("hex") },
    sourceRows: { admissionDecisionTimings: evidence.timings.length, nonAdmissionDecisionRowsExcluded: evidence.nonAdmissionDecisionRowsExcluded, familyAdmissionObservations: evidence.families.length },
    fleet,
    caveats: [
      "Draft fields distinguish measured, observed-runtime, proposed, and unresolved facts.",
      "No draft is a sealed StrategyCartridgeV1, no proposal is promotion-eligible, and no field changes paper execution.",
      "Admission latency uses entry decisions only and is measured after the expected one-minute bar close; source bars aged three minutes or more are censored from the fresh distribution.",
      "Fast exits and shadow-manager rows share the evidence table but use different clocks; non-entry and observation_only rows are excluded from admission latency.",
      "The one-open-row gate lacks a matching database uniqueness invariant and must not be described as enforced safety.",
      "Phase 1I family groups are dark observers today; a proposed concurrency of one is not an active admission cap.",
      "Legacy take-profit/runner settings are observations only; harvest managers remain unresolved pending exact path and holdout evidence.",
      "Railway market-feed variables remain unresolved until the deployed inputs and freshness profile are durably stamped.",
    ],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`current-channel-drafts: ${fleet.summary.drafts} drafts · ${fleet.summary.latencyMeasured} with measured latency · ${fleet.summary.latencyCeilingProposed} latency proposals · ${fleet.summary.collisionFamilyProposed} collision proposals`);
  console.log(`  evidence: ${evidence.timings.length} admission decisions · ${evidence.nonAdmissionDecisionRowsExcluded} non-admission rows excluded · ${evidence.families.length} family observations`);
  console.log(`  receipt: ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
