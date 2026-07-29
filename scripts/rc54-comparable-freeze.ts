// SELECT-only candidate-clock freeze for an RC5.4-comparable all-channel
// replay. It deliberately ignores virtual_trades' historical outcome and
// parameter fields and writes local artifacts only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import {
  RC54_COMPARABLE_START_ET,
  freezeRc54ComparableClocks,
  type Rc54ComparableVirtualClock,
} from "../lib/research/rc54ComparableFreeze";
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

const END_ET = arg("through") ?? "2026-07-28";
const SNAPSHOT_FILE = arg("snapshot-file");
const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc54-comparable");
const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface Snapshot {
  virtualCandidateClocks: Rc54ComparableVirtualClock[];
}

async function collect(): Promise<Snapshot> {
  const sb = createServerSupabaseClient("rc54-comparable-freeze");
  const virtualCandidateClocks = await pageAll<Rc54ComparableVirtualClock>((from) => sb
    .from("virtual_trades")
    .select("signal_id,slug,occ,signal_at")
    .gte("signal_at", `${RC54_COMPARABLE_START_ET}T04:00:00.000Z`)
    .lte("signal_at", `${END_ET}T23:59:59.999-04:00`)
    .order("signal_at", { ascending: true })
    .order("signal_id", { ascending: true }), {
    pageSize: 250,
    attempts: 3,
    retryDelaysMs: [250, 750],
    timeoutMs: 15_000,
    max: 10_000,
  });
  return { virtualCandidateClocks };
}

async function main(): Promise<void> {
  const posture = SNAPSHOT_FILE ? "local_snapshot_replay" : "supabase_select_only";
  const snapshot = SNAPSHOT_FILE
    ? JSON.parse(readFileSync(resolve(SNAPSHOT_FILE), "utf8")) as Snapshot
    : await collect();
  const freeze = freezeRc54ComparableClocks({
    rows: snapshot.virtualCandidateClocks,
    evidenceEndEt: END_ET,
  });
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const freezeText = `${JSON.stringify(freeze, null, 2)}\n`;
  const report = [
    `# RC5.4-comparable all-channel freeze — through ${END_ET}`,
    "",
    "Status: candidate clocks frozen; historical virtual outcomes ignored; no exact TP result exists until every included contract has checksum-verified Databento CBBO-1s evidence.",
    "",
    "## Coverage",
    "",
    `- source candidate clocks: ${freeze.summary.sourceRows}`,
    `- frozen candidate clocks: ${freeze.summary.frozenCandidateClocks}`,
    `- censored source rows: ${freeze.summary.censoredRows}`,
    `- sessions: ${freeze.summary.sessions}`,
    `- channels: ${freeze.summary.channels}`,
    `- session-contract requests: ${freeze.summary.exactSessionContracts}`,
    `- maximum one-second rows: ${freeze.summary.estimatedMaximumOneSecondRows}`,
    `- active release roots: ${freeze.summary.byChannelClass.active_release_root}`,
    `- dark/VB clocks: ${freeze.summary.byChannelClass.dark_vb}`,
    `- other dark clocks: ${freeze.summary.byChannelClass.dark_other}`,
    "",
    "## Economic contract",
    "",
    "- two contracts",
    "- entry at the last exact CBBO ask at or before the frozen decision clock",
    "- exits on executable CBBO bids",
    "- -30% catastrophe stop, evaluated before reward",
    "- 15:25 ET flatten",
    "- no adds and no re-entry while the same channel/manager path is active",
    "- target grid is injected only at replay time; this freeze selects no TP",
    "",
    "## Authority",
    "",
    "- local artifacts only",
    "- production writes: 0",
    "- order authority: false",
    "- policy/configuration authority: false",
    "",
  ].join("\n");
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    posture,
    evidenceStartEt: freeze.evidenceStartEt,
    evidenceEndEt: freeze.evidenceEndEt,
    snapshotSha256: sha256(snapshotText),
    freezeCanonicalSha256: freeze.canonicalSha256,
    freezeFileSha256: sha256(freezeText),
    reportSha256: sha256(report),
    sourceTables: ["virtual_trades"],
    excludedSources: ["option_quotes", "positions", "orders", "fills"],
    productionWrites: 0,
    historicalDownloads: 0,
    providerCostEstimateUsd: null,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    orderAuthority: false,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "snapshot.json"), snapshotText);
  writeFileSync(resolve(OUTPUT_DIR, "freeze.json"), freezeText);
  writeFileSync(resolve(OUTPUT_DIR, "report.md"), report);
  writeFileSync(resolve(OUTPUT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`rc54-comparable-freeze: ${posture}`);
  console.log(`  ${freeze.summary.frozenCandidateClocks} candidate clocks · ${freeze.summary.sessions} sessions · ${freeze.summary.channels} channels`);
  console.log(`  ${freeze.summary.exactSessionContracts} exact session-contract requests · ≤${freeze.summary.estimatedMaximumOneSecondRows} one-second rows`);
  console.log(`  active ${freeze.summary.byChannelClass.active_release_root} · dark/VB ${freeze.summary.byChannelClass.dark_vb} · other dark ${freeze.summary.byChannelClass.dark_other}`);
  console.log(`  freeze ${freeze.canonicalSha256}`);
  console.log(`  output ${OUTPUT_DIR}`);
  console.log("rc54-comparable-freeze: PASS · no outcome fields used · no production writes");
}

void main().catch((error) => {
  console.error(`rc54-comparable-freeze failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
