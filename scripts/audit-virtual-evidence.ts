// SELECT-only audit. Saves local evidence; cannot repair/publish production rows.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import { etDayRangeUtc, etSessionCloseUtc } from "../lib/research/afterCloseResearch";
import { auditGateShadowPath, type GateShadowAuditQuote } from "../lib/research/gateShadowPathAudit";
import { readAtlasEvidenceRows } from "../lib/research/decisionAtlasRead";
import { compareGateShadowRows, type LocalGateShadowRow, type RemoteGateShadowRow } from "../lib/research/gateShadowVerification";
import { deriveVirtualTradeProvenance, type VirtualTradeSourceSignal } from "../lib/research/virtualTradeProvenance";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const session = arg("session");
const ledgerPath = arg("ledger-file");
const outPath = arg("out-dir");
if (!session || !ledgerPath || !outPath) throw new Error("--session, --ledger-file and --out-dir required");
const env = process.env.SEVE_ENV_FILE ?? ".env.local";
if (existsSync(env)) process.loadEnvFile(env);

async function main() {
  const range = etDayRangeUtc(session!);
  const ledgerBytes = readFileSync(resolve(ledgerPath!));
  const local = (JSON.parse(ledgerBytes.toString()) as LocalGateShadowRow[])
    .filter((r) => r.createdAt >= range.start && r.createdAt < range.end);
  const sb = createServerSupabaseClient("virtual-evidence-audit-select-only");
  const remote = await pageAll<RemoteGateShadowRow & Record<string, unknown>>(() => sb.from("virtual_trades")
    .select("*").gte("signal_at", range.start).lt("signal_at", range.end).order("signal_at").order("signal_id"));
  const ids = [...new Set([...local.map((r) => r.signalId), ...remote.map((r) => r.signal_id)])].sort();
  const signals: Array<VirtualTradeSourceSignal & { id: string; created_at: string; strategist_id: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const result = await sb.from("signals")
      .select("id,created_at,strategist_id,rationale,channel_spec_version_id,release_manifest_id,configuration_epoch_id")
      .in("id", ids.slice(i, i + 200)).order("id");
    if (result.error) throw result.error;
    signals.push(...result.data);
  }
  const comparison = compareGateShadowRows(local, remote);
  const sourceById = new Map(signals.map((r) => [r.id, r]));
  const canonicalLocal = new Map(comparison.local.map((r) => [r.signalId, r]));
  const canonicalRemote = new Map(comparison.remote.map((r) => [r.signalId, r]));
  const mismatches = comparison.payloadMismatches.map(({ signalId, fields }) => {
    const before = canonicalRemote.get(signalId)!;
    const rebuilt = canonicalLocal.get(signalId)!;
    const stored = remote.find((r) => r.signal_id === signalId)!;
    const source = sourceById.get(signalId);
    let policy: ReturnType<typeof deriveVirtualTradeProvenance> | null = null;
    let policyError: string | null = null;
    try { if (!source) throw new Error("source signal missing"); policy = deriveVirtualTradeProvenance(source); }
    catch (e) { policyError = e instanceof Error ? e.message : String(e); }
    const provenance = Object.fromEntries(["channel_spec_version_id", "release_manifest_id", "configuration_epoch_id",
      "native_manager_policy_version", "research_publisher_version"].map((key) => [key, stored[key] ?? null]));
    return { signalId, slug: before.slug, fields, before, rebuilt,
      storedInsertedAt: stored.inserted_at ?? null, sourcePolicy: policy?.policy ?? null, policyError,
      sourceProvenance: policy?.columns ?? null, storedProvenance: provenance,
      strictlyLegacy: Object.values(provenance).every((v) => v == null),
      localMatchesSourcePolicy: policy != null && rebuilt.stopPct === policy.policy.scoredStopPct && rebuilt.tpPct === policy.policy.takeProfitPct,
      remoteMatchesSourcePolicy: policy != null && before.stopPct === policy.policy.scoredStopPct && before.tpPct === policy.policy.takeProfitPct,
    };
  });
  const symbols = [...new Set(mismatches.map((r) => r.before.occ))].sort();
  const quoteRead = symbols.length ? await readAtlasEvidenceRows<GateShadowAuditQuote>({
    label: "audit option quotes", key: (r) => r.id,
    query: (head) => sb.from("option_quotes")
      .select("id,occ_symbol,ask,mid,captured_at", head ? { head, count: "exact" } : { head })
      .in("occ_symbol", symbols).gte("captured_at", range.start).lt("captured_at", etSessionCloseUtc(session!))
      .order("captured_at").order("id"),
  }) : { rows: [], coverage: null };
  const quoteVerification = mismatches.map((r) => {
    if (!r.sourcePolicy || !sourceById.has(r.signalId)) return { signalId: r.signalId,
      sourceReplay: null, storedReplay: null,
      sourceReplayDifferences: ["source_policy_unavailable"], storedReplayDifferences: ["source_policy_unavailable"] };
    const source = sourceById.get(r.signalId)!;
    const common = { occ: r.before.occ, signalAt: source.created_at,
      decisionAsk: Number(source.rationale?.ask ?? 0), sessionClose: etSessionCloseUtc(session!), quotes: quoteRead.rows };
    const sourceReplay = auditGateShadowPath({ ...common,
      targetPct: r.sourcePolicy!.takeProfitPct, stopPct: r.sourcePolicy!.scoredStopPct });
    const storedReplay = auditGateShadowPath({ ...common, targetPct: r.before.tpPct!, stopPct: r.before.stopPct! });
    const differences = (replayed: typeof sourceReplay, observed: typeof r.before) => Object.entries(replayed)
      .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(observed[key as keyof typeof observed])).map(([key]) => key);
    return { signalId: r.signalId, sourceReplay, storedReplay,
      sourceReplayDifferences: differences(sourceReplay, r.rebuilt),
      storedReplayDifferences: differences(storedReplay, r.before) };
  });
  const snapshot = { session, range, local, remote, signals, quoteCoverage: quoteRead.coverage, quotes: quoteRead.rows };
  const payload = JSON.stringify(snapshot, null, 2) + "\n";
  const hash = (b: string | Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
  const report = { version: "virtual-evidence-audit-v1", generatedAt: new Date().toISOString(), session,
    localRows: local.length, remoteRows: remote.length, scopedRemoteRows: comparison.scopedRemote.length,
    missingRemoteIds: comparison.missingRemoteIds, unscopedRemoteIds: comparison.unscopedRemoteIds,
    duplicateLocalIds: comparison.duplicateLocalIds, duplicateRemoteIds: comparison.duplicateRemoteIds,
    mismatches, quoteVerification, sourceSnapshotSha256: hash(payload), reconstructionSha256: hash(ledgerBytes),
    productionWrites: 0, allowedMethods: ["SELECT", "GET"],
    repairAuthorized: false, limitations: ["This verifies the legacy minute-mid shadow contract, not native managers or executable fills.",
      "Policy and quote agreement does not identify the process that wrote an unstamped row."] };
  const out = resolve(outPath!);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "snapshot.json"), payload);
  writeFileSync(resolve(out, "audit.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ session, local: local.length, remote: remote.length, mismatches: mismatches.length,
    unscoped: comparison.unscopedRemoteIds.length, localPolicyMatches: mismatches.filter((r) => r.localMatchesSourcePolicy).length,
    remotePolicyMatches: mismatches.filter((r) => r.remoteMatchesSourcePolicy).length,
    strictlyLegacy: mismatches.filter((r) => r.strictlyLegacy).length, snapshotHash: report.sourceSnapshotSha256,
    quoteSourceMatches: quoteVerification.filter((r) => !r.sourceReplayDifferences.length).length,
    quoteStoredMatches: quoteVerification.filter((r) => !r.storedReplayDifferences.length).length,
    productionWrites: 0 }));
  console.log(JSON.stringify(mismatches.map((r) => ({ slug: r.slug, fields: r.fields,
    localTarget: r.rebuilt.tpPct, sourceTarget: r.sourcePolicy?.takeProfitPct, storedTarget: r.before.tpPct,
    localStop: r.rebuilt.stopPct, sourceStop: r.sourcePolicy?.scoredStopPct, storedStop: r.before.stopPct,
    localPnl: r.rebuilt.pnlPerContract, storedPnl: r.before.pnlPerContract, storedInsertedAt: r.storedInsertedAt,
  })), null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
