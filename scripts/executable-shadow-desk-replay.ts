// SELECT-only incident/desk replay for the exact active paper roster. It uses
// observed asks for entries, observed bids for exits, immutable active manager
// specs, and chronological account/family/OCC occupancy. It never writes to
// Supabase, changes a manifest, or places an order.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChannelSpecVersion } from "../lib/channels/channelControlPlane";
import { canonicalJson } from "../lib/channels/channelControlPlane";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  buildExecutableShadowLedger,
  type ExecutableShadowAccountPolicy,
  type ExecutableShadowOpportunity,
  type ExecutableShadowQuote,
} from "../lib/research/executableShadowLedger";
import {
  executableForceExitClockFromChannelSpec,
  executableManagerFromChannelSpec,
  executableMaxEntriesFromChannelSpec,
} from "../lib/research/executableShadowManager";
import {
  assertAfterCloseSessionReady,
  etDayRangeUtc,
  etWallMinuteUtc,
} from "../lib/research/afterCloseResearch";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const session = arg("session") ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new Error("--session YYYY-MM-DD is required");
assertAfterCloseSessionReady(session, Date.now());
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputFile = resolve(arg("output")
  ?? `data/research/executable-shadow-desk-${session}.json`);

const numeric = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => typeof value === "string"
  && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value
  && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const minuteOf = (clock: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`invalid ET clock: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
};
const hash = (value: unknown): string => `sha256:${createHash("sha256")
  .update(canonicalJson(value as never)).digest("hex")}`;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const read = await build(from, from + 999);
    if (read.error) throw new Error(read.error.message);
    const page = read.data ?? [];
    rows.push(...page);
    if (page.length < 1_000) return rows;
    if (rows.length > 250_000) throw new Error("desk replay exceeded bounded read ceiling");
  }
}

interface SignalRow {
  id: string;
  strategist_id: string;
  created_at: string;
  direction: string | null;
  rationale: Record<string, unknown> | null;
}
interface QuoteRow {
  id: string;
  occ_symbol: string;
  captured_at: string;
  provider_quote_at: string | null;
  bid: number | string | null;
  ask: number | string | null;
  bid_size: number | string | null;
  ask_size: number | string | null;
}

function accountPolicies(input: {
  specs: readonly ChannelSpecVersion[];
  policies: readonly {
    id: string;
    maxOpenPerFamily: number;
    maxOpenByUnderlying: Record<string, number>;
    maxOpenGlobal: number;
  }[];
  capacityOverride?: number;
  sameOccProtection?: boolean;
  familyProtection?: boolean;
}): ExecutableShadowAccountPolicy[] {
  return input.policies.flatMap((policy) => {
    const specs = input.specs.filter((spec) => spec.collisionDomain === policy.id);
    const accountIds = [...new Set(specs.map((spec) => spec.accountId))];
    if (!specs.length) return [];
    if (accountIds.length !== 1) throw new Error(`${policy.id}: collision domain spans accounts`);
    const cap = input.capacityOverride;
    const byUnderlying = Object.fromEntries(Object.entries(policy.maxOpenByUnderlying)
      .map(([underlying, value]) => [underlying, cap ?? value]));
    return [{
      accountId: accountIds[0]!,
      buyingPowerUsd: Number.MAX_SAFE_INTEGER,
      maxConcurrentDebitUsd: Number.MAX_SAFE_INTEGER,
      maxConcurrentStopExposureUsd: Number.MAX_SAFE_INTEGER,
      maxOpenPositions: cap ?? policy.maxOpenGlobal,
      maxOpenByUnderlying: byUnderlying,
      sameOccProtection: input.sameOccProtection ?? true,
      familyProtection: input.familyProtection ?? policy.maxOpenPerFamily <= 1,
      // A collision domain identifies an account arbitration policy. Treating
      // it as a per-position family would incorrectly cap every account at one.
      collisionDomainProtection: false,
    }];
  });
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("executable-shadow-desk-replay");
  const control = await loadStoredReceiptBoundControlPlane(sb);
  if (control.state !== "receipt-bound" || !control.compiled
      || !control.activationReceipt || !control.databaseIdentity) {
    throw new Error(`active receipt-bound control plane required; got ${control.state}`);
  }
  const specs = control.compiled.channelSpecs.filter((spec) =>
    spec.executionPosture !== "observe-only");
  const specByChannel = new Map(specs.map((spec) => [spec.channelId, spec]));
  const range = etDayRangeUtc(session);
  const signals = await pageAll<SignalRow>((from, to) => sb.from("signals")
    .select("id,strategist_id,created_at,direction,rationale")
    .in("strategist_id", [...specByChannel.keys()])
    .gte("created_at", range.start).lt("created_at", range.end)
    .order("created_at").order("id").range(from, to));
  const occs = [...new Set(signals.map((row) => text(row.rationale?.occ)?.toUpperCase())
    .filter(Boolean) as string[])];
  const quotes: QuoteRow[] = [];
  for (let index = 0; index < occs.length; index += 40) {
    const batch = occs.slice(index, index + 40);
    quotes.push(...await pageAll<QuoteRow>((from, to) => sb.from("option_quotes")
      .select("id,occ_symbol,captured_at,provider_quote_at,bid,ask,bid_size,ask_size")
      .in("occ_symbol", batch).gte("captured_at", range.start).lt("captured_at", range.end)
      .order("captured_at").order("id").range(from, to)));
  }
  const quoteByOcc = new Map<string, ExecutableShadowQuote[]>();
  for (const row of new Map(quotes.map((quote) => [quote.id, quote])).values()) {
    quoteByOcc.set(row.occ_symbol, [...(quoteByOcc.get(row.occ_symbol) ?? []), {
      id: row.id,
      capturedAt: row.captured_at,
      providerAt: row.provider_quote_at,
      bid: numeric(row.bid),
      ask: numeric(row.ask),
      bidSize: numeric(row.bid_size),
      askSize: numeric(row.ask_size),
    }]);
  }
  const opportunities = signals.map((signal): ExecutableShadowOpportunity => {
    const spec = specByChannel.get(signal.strategist_id);
    if (!spec) throw new Error(`${signal.id}: active channel spec is missing`);
    const rationale = object(signal.rationale);
    const occ = text(rationale.occ)?.toUpperCase() ?? null;
    const sourceBarAt = text(rationale.decision_source_bar_at) ?? signal.created_at;
    const decisionAt = text(rationale.decision_observed_at) ?? signal.created_at;
    const eodEt = executableForceExitClockFromChannelSpec(spec, "15:25");
    return {
      id: `${signal.id}:active-native`,
      signalId: signal.id,
      channelId: spec.channelId,
      channelSlug: spec.slug,
      sessionDateEt: session,
      accountId: spec.accountId,
      underlying: spec.symbolScope[0]!.toUpperCase(),
      occSymbol: occ,
      contractSelectionId: "signal-selected-contract",
      contractSelectionSnapshot: {
        armKind: "signal",
        selectedOccSymbol: occ,
        reason: occ ? "signal_selected_contract" : "signal_contract_missing",
      },
      familyId: spec.familyId,
      collisionDomain: spec.collisionDomain,
      signalAt: Date.parse(sourceBarAt) <= Date.parse(decisionAt)
        ? sourceBarAt : signal.created_at,
      decisionAt,
      decisionClock: `${spec.symbolScope[0]!.toUpperCase()}:${sourceBarAt}`,
      decisionClockAt: sourceBarAt,
      quantity: spec.quantity,
      priority: spec.priority,
      maxEntriesPerSession: executableMaxEntriesFromChannelSpec(spec),
      maxDebitUsd: spec.maxDebitUsd,
      maxStopExposureUsd: spec.riskLimits.maxRiskUsd,
      channelSpecVersionId: control.databaseIdentity!
        .channelSpecDatabaseIdsByVersionKey[spec.id]!,
      releaseManifestId: control.databaseIdentity!.releaseManifestDatabaseId!,
      configurationEpochId: control.activationReceipt!.configurationEpochId,
      manager: executableManagerFromChannelSpec(
        spec,
        etWallMinuteUtc(session, minuteOf(eodEt)),
      ),
      quotes: occ ? quoteByOcc.get(occ) ?? [] : [],
      sourceRefs: [`supabase:signals:${signal.id}`,
        ...(occ ? [`supabase:option_quotes:${occ}:${session}`] : []),
        `active-manifest:${control.compiled!.manifest.contentHash}`],
    };
  });
  const quotePolicy = {
    maxEntryDelayMs: 75_000,
    maxQuoteAgeMs: 15_000,
    maxForceExitQuoteGapMs: 90_000,
    maxSpreadShare: 0.25,
    requireProviderClock: true,
    requireDisplayedSize: true,
  } as const;
  const policies = control.compiled.manifest.admissionPolicies;
  const variants = [
    { id: "current", accounts: accountPolicies({ specs, policies }) },
    ...[1, 2, 3, 4, 5, 6].map((capacity) => ({
      id: `capacity-${capacity}`,
      accounts: accountPolicies({ specs, policies, capacityOverride: capacity }),
    })),
    { id: "diagnostic-no-same-occ", accounts: accountPolicies({ specs, policies,
      sameOccProtection: false }) },
    { id: "diagnostic-no-family", accounts: accountPolicies({ specs, policies,
      familyProtection: false }) },
  ];
  const ledgers = variants.map((variant) => ({
    id: variant.id,
    ledger: buildExecutableShadowLedger({
      generatedAt: new Date().toISOString(),
      opportunities,
      accountPolicies: variant.accounts,
      policy: quotePolicy,
      modes: variant.id === "current" ? ["channel_isolated", "portfolio"] : ["portfolio"],
    }),
  }));
  const current = ledgers[0]!.ledger.receipts.filter((row) => row.mode === "portfolio");
  const currentFilled = new Set(current.filter((row) => row.disposition === "filled")
    .map((row) => row.signalId));
  const comparisons = ledgers.map(({ id, ledger }) => {
    const rows = ledger.receipts.filter((row) => row.mode === "portfolio");
    const filled = rows.filter((row) => row.disposition === "filled");
    const ids = new Set(filled.map((row) => row.signalId));
    return {
      id,
      summary: ledger.summaries.find((row) => row.mode === "portfolio"),
      added: filled.filter((row) => !currentFilled.has(row.signalId)).map((row) => ({
        signalId: row.signalId, channel: row.channelSlug, resultUsd: row.totalResultUsd,
      })),
      displaced: current.filter((row) => row.disposition === "filled" && !ids.has(row.signalId))
        .map((row) => ({ signalId: row.signalId, channel: row.channelSlug,
          resultUsd: row.totalResultUsd })),
      rejectedByReason: Object.fromEntries([...rows.reduce((map, row) => {
        if (row.disposition !== "filled") map.set(row.disposition,
          (map.get(row.disposition) ?? 0) + 1);
        return map;
      }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right))),
    };
  });
  const report = {
    schemaVersion: 1,
    kind: "executable-shadow-desk-replay",
    generatedAt: new Date().toISOString(),
    session,
    activeManifest: {
      id: control.compiled.manifest.id,
      releaseId: control.compiled.manifest.releaseId,
      contentHash: control.compiled.manifest.contentHash,
      configurationEpochId: control.activationReceipt.configurationEpochId,
    },
    evidence: {
      activePaperChannels: specs.map((spec) => spec.slug),
      signals: signals.length,
      contracts: occs.length,
      quotes: quotes.length,
      entryBasis: "observed executable ask",
      exitBasis: "observed executable bid",
      repeatedSignalTreatment: "one open channel position plus immutable filled-entry cap",
    },
    quotePolicy,
    comparisons,
    currentLedger: ledgers[0]!.ledger,
    diagnosticsAreNotRecommendations: true,
    productionWrites: 0,
    executionAuthority: false,
    orderAuthority: false,
  };
  const output = { ...report, contentHash: hash(report) };
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ outputFile, evidence: output.evidence,
    comparisons: output.comparisons.map((row) => ({ id: row.id,
      summary: row.summary, added: row.added, displaced: row.displaced,
      rejectedByReason: row.rejectedByReason })), contentHash: output.contentHash }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
