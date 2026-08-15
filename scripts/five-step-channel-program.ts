// SELECT-only preparation and verification for the five approved channel workstreams.
// It freezes working native controls, preregisters one paired QQQ exit comparison,
// audits the exact ORB manager-era break, and verifies the already-live IWM and
// Grind bounded paper experiments. It never writes production data.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { buildOperatorProposal } from "../lib/channels/channelProposalWrite";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { buildFiveStepChannelProgram, type OrbSpecHistoryRow,
  type WeeklyExecutedEra } from "../lib/research/fiveStepChannelProgram";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import { createServerSupabaseClient } from "./serverSupabase";

const value = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const atlasFile = resolve(value("atlas-file",
  "data/weekend-evidence/2026-08-14/nightly/atlas/atlas.json"));
const weeklyFile = resolve(value("weekly-file",
  "data/weekend-evidence/2026-08-14/nightly/weekly/weekly.json"));
const outputDir = resolve(value("out-dir", "data/next-week-experiments/2026-08-17/five-step"));
for (const file of [envFile, atlasFile, weeklyFile]) {
  if (!existsSync(file)) throw new Error(`required file not found: ${file}`);
}
process.loadEnvFile(envFile);

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function exactOperator(sb: ReturnType<typeof createServerSupabaseClient>): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator read failed: ${read.error.message}`);
  const rows = read.data.users.filter(isDeskOperator);
  if (rows.length !== 1) throw new Error(`expected one desk operator, observed ${rows.length}`);
  return rows[0];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function orbRow(row: Record<string, unknown>): OrbSpecHistoryRow {
  return {
    id: String(row.id),
    managerProfileId: String(row.manager_profile_id),
    managerVersion: String(row.manager_version),
    quantity: Number(row.quantity),
    entryParameters: asRecord(row.entry_parameters),
    exitParameters: asRecord(row.exit_parameters),
    takeProfit: asRecord(row.take_profit),
    stopLoss: asRecord(row.stop_loss),
    ratchetParameters: asRecord(row.ratchet_parameters),
    reentryPolicy: String(row.reentry_policy),
    priority: Number(row.priority),
    contentHash: String(row.content_hash),
  };
}

function render(packet: any): string {
  const money = (value: number | null) => value == null ? "—"
    : `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value))}`;
  return [
    "# Five channel workstreams · 2026-08-17",
    "",
    "**Paper-only · channel-specific · SELECT-only preparation**",
    "",
    "## At a glance",
    "",
    "| Workstream | State | What changes |",
    "|---|---|---|",
    `| Proven native controls | ${packet.program.protectedChannels.every((row: any) => row.state === "frozen") ? "FROZEN" : "BLOCKED"} | Nothing; four exact specification hashes are pinned. |`,
    `| qqq-thrust-trail-wd exit | ${packet.program.qqqExit.state.toUpperCase()} | LOCK20/30 is the paper native; compare the former +50/-50 exit on identical opportunities. |`,
    `| vb-ribbon-cross-iwm entry cap | ${packet.program.liveExperiments[1].state.toUpperCase()} | Already live: two contracts, first entry only. |`,
    `| orb-ustop-ctl autopsy | ${packet.program.orbAutopsy.state.toUpperCase()} | B30/A13 is restored as the paper native; ALL-OUT-50 remains the paired shadow control. |`,
    `| grind-v3 governor | ${packet.program.liveExperiments[0].state.toUpperCase()} | Already live: at most two executed entries; later signals remain research. |`,
    "",
    "## Preserved native controls",
    "",
    "| Channel | Manager | Contracts | Typical result | State |",
    "|---|---|---:|---:|---|",
    ...packet.program.protectedChannels.map((row: any) =>
      `| ${row.channel} | ${row.managerProfileId} | ${row.contracts} | ${row.typicalResult ?? "—"} | ${row.state} |`),
    "",
    "## QQQ exit comparison",
    "",
    `- Paper native: ${packet.program.qqqExit.activeNative}`,
    `- Paired shadow control: ${packet.program.qqqExit.formerNativeControl}`,
    `- Current paired evidence: ${packet.program.qqqExit.currentEvidence.independentSessions ?? packet.program.qqqExit.currentEvidence.sessions} sessions / ${packet.program.qqqExit.currentEvidence.pairedOpportunities} opportunities; typical lift ${packet.program.qqqExit.currentEvidence.typicalBenefitPct == null ? "—" : `${packet.program.qqqExit.currentEvidence.typicalBenefitPct >= 0 ? "+" : ""}${packet.program.qqqExit.currentEvidence.typicalBenefitPct}%`}.`,
    "- Entry, size, route, and priority remain unchanged. Only the paper-native exit changed; the displaced exit remains the paired shadow control.",
    "",
    "## ORB configuration-era autopsy",
    "",
    "| Era | Sessions | Trades | Positive | Typical | Total |",
    "|---|---:|---:|---:|---:|---:|",
    `| B30/A13 | ${packet.program.orbAutopsy.priorEra?.sessions ?? 0} | ${packet.program.orbAutopsy.priorEra?.logicalTrades ?? 0} | ${packet.program.orbAutopsy.priorEra?.positive ?? 0} | ${money(packet.program.orbAutopsy.priorEra?.typicalResultUsd ?? null)} | ${money(packet.program.orbAutopsy.priorEra?.totalResultUsd ?? null)} |`,
    `| ALL-OUT-50 | ${packet.program.orbAutopsy.changedEra?.sessions ?? 0} | ${packet.program.orbAutopsy.changedEra?.logicalTrades ?? 0} | ${packet.program.orbAutopsy.changedEra?.positive ?? 0} | ${money(packet.program.orbAutopsy.changedEra?.typicalResultUsd ?? null)} | ${money(packet.program.orbAutopsy.changedEra?.totalResultUsd ?? null)} |`,
    "",
    packet.program.orbAutopsy.conclusion,
    "",
    packet.orbRollbackProposal
      ? `Prepared proposal: ${packet.orbRollbackProposal.proposal.id}. It restores B30/A13 while preserving the current entry, four-contract size, Account 3 priority 1, route, and collision policy.`
      : "B30/A13 is active. Its exact rollback target is the prior ALL-OUT-50 manifest; no redundant proposal was generated.",
    "",
    "## Authority",
    "",
    "This runner is SELECT-only. It observes the already-activated paper experiments but cannot write orders, roster, managers, or configuration.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const atlas = JSON.parse(readFileSync(atlasFile, "utf8")) as DecisionAtlas;
  const weekly = JSON.parse(readFileSync(weeklyFile, "utf8")) as { executed: WeeklyExecutedEra[] };
  const sb = createServerSupabaseClient("five-step-channel-program-readonly");
  const [activeRead, operator, orbRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    exactOperator(sb),
    sb.from("channel_spec_versions").select([
      "id", "manager_profile_id", "manager_version", "quantity", "entry_parameters",
      "exit_parameters", "take_profit", "stop_loss", "ratchet_parameters",
      "reentry_policy", "priority", "content_hash",
    ].join(",")).eq("channel_slug", "orb-ustop-ctl").order("created_at", { ascending: true }),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error(`active control plane unavailable: ${activeRead.error ?? activeRead.state}`);
  }
  if (orbRead.error) throw new Error(`ORB specification history failed: ${orbRead.error.message}`);
  const program = buildFiveStepChannelProgram({ generatedAt, active: activeRead.compiled, atlas,
    weeklyExecuted: weekly.executed, orbSpecs: (orbRead.data ?? []).map((row) => orbRow(row as Record<string, unknown>)) });
  if (!program.ready) throw new Error(`program blocked: ${program.blockers.join("; ")}`);

  const orb = activeRead.compiled.channelSpecs.find((row) => row.slug === "orb-ustop-ctl");
  if (!orb) throw new Error("active ORB specification missing");
  const orbRollbackProposal = orb.managerProfileId === "ORB54-B30-A13" ? null
    : buildOperatorProposal(activeRead.compiled, {
    baseSpecVersionId: orb.id,
    baseSpecContentHash: orb.contentHash,
    proposedPatch: { managerPolicy: {
      managerProfileId: "ORB54-B30-A13",
      managerLabel: "BANK 1 @ +30% · RUN 1 ON A13",
      takeProfit: { kind: "bank", targetPct: 30, fraction: .5 },
      stopLoss: orb.stopLoss,
      ratchetParameters: { kind: "a13", engageReturnPct: 50, givebackPct: 33,
        retainGainPct: 67, fixedTargetPct: null },
    } },
    reason: "Reversible one-axis paper rollback experiment after the exact manager-only era break: restore B30/A13 while preserving entry, four-contract size, Account 3 priority 1, route, and collision policy. Keep ALL-OUT-50 as the paired shadow control.",
    evidenceRefs: [
      "decision-atlas:orb-ustop-ctl:manager-era-autopsy:through-2026-08-14",
      `active-manifest:${activeRead.compiled.manifest.contentHash}`,
    ],
    changeClass: "bounded-parameter",
  }, operator.id, deterministicUuid(`${activeRead.compiled.manifest.contentHash}:orb-ustop-ctl:rollback-b30-a13`), generatedAt);
  const packet = { schemaVersion: 1, generatedAt, program,
    orbRollbackProposal: orbRollbackProposal
      ? { ...orbRollbackProposal, activationAuthorized: false }
      : null,
    source: { atlasFile, weeklyFile, methods: ["SELECT", "GET"] },
    productionWrites: 0, orderAuthority: false, configurationAuthority: false };
  const body = `${JSON.stringify(packet, null, 2)}\n`;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "program.json"), body);
  writeFileSync(resolve(outputDir, "program.md"), `${render(packet)}\n`);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify({
    generatedAt,
    throughSession: atlas.throughSession,
    activeManifestContentHash: activeRead.compiled.manifest.contentHash,
    packetSha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    orbRollbackDraftSpecHash: orbRollbackProposal?.draftSpec.contentHash ?? null,
    orbPaperNativeActive: orb.managerProfileId === "ORB54-B30-A13",
    protectedSpecHashes: program.protectedChannels.map((row) => ({ channel: row.channel,
      contentHash: row.observedSpecHash })),
    productionWrites: 0,
    orderAuthority: false,
    activation: false,
  }, null, 2)}\n`);
  console.log("five-step-channel-program: PASS · five workstreams verified");
  console.log(`  protected native: ${program.protectedChannels.length}`);
  console.log(`  QQQ exit: ${program.qqqExit.state} · ${program.qqqExit.currentEvidence.sessions}s/${program.qqqExit.currentEvidence.pairedOpportunities} paired`);
  console.log(`  ORB: ${program.orbAutopsy.state} · ${orbRollbackProposal ? `rollback proposal ${orbRollbackProposal.proposal.id}` : "B30/A13 active"}`);
  console.log(`  live bounded experiments: ${program.liveExperiments.map((row) => `${row.channel}:${row.state}`).join(" · ")}`);
  console.log(`  output: ${outputDir}`);
  console.log("  production writes: 0 · activation: false · order authority: false");
}

main().catch((error) => {
  console.error(`five-step-channel-program: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
