// SELECT-only pilot for the executable-shadow ledger.
//
// It never writes Supabase, never places an order, and never converts an
// exploratory virtual path into executable evidence. A channel may be scored
// locally from a frozen strategist snapshot when its research registration is
// incomplete, but that output is marked publication-ineligible and cannot be
// inserted into the durable executable-shadow ledger.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildExecutableShadowLedger,
  type ExecutableShadowManager,
  type ExecutableShadowOpportunity,
  type ExecutableShadowQuote,
  type ExecutableShadowRunPolicy,
} from "../lib/research/executableShadowLedger";
import { canonicalJson } from "../lib/channels/channelControlPlane";
import {
  selectExecutableShadowContract,
  type ExecutableShadowContractCandidate,
} from "../lib/research/executableShadowContractSelection";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence";
import {
  assertAfterCloseSessionReady,
  etDayRangeUtc,
  etSessionCloseUtc,
  etWallMinuteUtc,
  latestReadyAfterCloseSession,
} from "../lib/research/afterCloseResearch";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : null;
};
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const slug = String(arg("slug") ?? "").trim();
if (!slug) throw new Error("--slug is required");
const throughSession = arg("through") ?? latestReadyAfterCloseSession(Date.now());
const fromSession = arg("from") ?? throughSession;
for (const value of [fromSession, throughSession]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--from/--through must be YYYY-MM-DD");
  assertAfterCloseSessionReady(value, Date.now());
}
if (fromSession > throughSession) throw new Error("--from cannot follow --through");
const managerNames = (arg("managers") ?? "reference-s50,full-r20-k50")
  .split(",").map((value) => value.trim()).filter(Boolean);
const deltaTargets = (arg("delta-targets") ?? "").split(",")
  .map((value) => Number(value.trim())).filter((value) => value > 0 && value < 1);
const itmSteps = (arg("itm-steps") ?? "").split(",")
  .map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
const outputFile = resolve(arg("output")
  ?? `data/research/executable-shadow-${slug}-${fromSession}-through-${throughSession}.json`);

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(canonicalJson(value as never)).digest("hex")}`;
const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => typeof value === "string" && value.trim()
  ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object"
  && !Array.isArray(value) ? value as Record<string, unknown> : {};
const minuteOf = (clock: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`invalid ET clock: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
};
const sessionDateEt = (iso: string): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(iso));

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  const size = 1_000;
  for (let from = 0; ; from += size) {
    const read = await build(from, from + size - 1);
    if (read.error) throw new Error(read.error.message);
    const page = read.data ?? [];
    rows.push(...page);
    if (page.length < size) return rows;
    if (rows.length > 250_000) throw new Error("executable-shadow pilot exceeded its bounded read ceiling");
  }
}

function manager(name: string, session: string, forceExitEt: string): ExecutableShadowManager {
  const forceExitAt = etWallMinuteUtc(session, minuteOf(forceExitEt));
  const reference = /^reference-s(\d+(?:\.\d+)?)$/.exec(name);
  if (reference) return {
    kind: "all_out", id: `REFERENCE-NO-TP-S${reference[1]}`, version: "pilot-v1",
    stopLossPct: Number(reference[1]), takeProfitPct: null, forceExitAt,
  };
  if (name === "full-r20-k50") return {
    kind: "full_ratchet", id: "FULL-R20-K50", version: "pilot-v1",
    stopLossPct: 30, armPct: 20, keepFraction: 0.5, forceExitAt,
  };
  const allOut = /^allout-t(\d+(?:\.\d+)?)-s(\d+(?:\.\d+)?)$/.exec(name);
  if (allOut) return {
    kind: "all_out", id: name.toUpperCase(), version: "pilot-v1",
    takeProfitPct: Number(allOut[1]), stopLossPct: Number(allOut[2]), forceExitAt,
  };
  const ratchet = /^full-r(\d+(?:\.\d+)?)-k(\d+(?:\.\d+)?)(?:-s(\d+(?:\.\d+)?))?$/.exec(name);
  if (ratchet) return {
    kind: "full_ratchet", id: name.toUpperCase(), version: "pilot-v1",
    // Canonical FULL-R/K presets use the desk's -30% pre-arm stop. A
    // nonstandard stop must be named explicitly as `-sNN`.
    stopLossPct: ratchet[3] ? Number(ratchet[3]) : 30,
    armPct: Number(ratchet[1]), keepFraction: Number(ratchet[2]) / 100,
    forceExitAt,
  };
  throw new Error(`unsupported --managers value: ${name}`);
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
  delta: number | string | null;
  strike: number | string | null;
  underlying_price: number | string | null;
  opt_type: string | null;
  expiration: string | null;
  request_started_at: string | null;
  observed_at: string | null;
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("executable-shadow-pilot");
  const control = await loadStoredReceiptBoundControlPlane(sb);
  if (control.state === "failed") throw new Error(`active control-plane read failed: ${control.error}`);
  const activeSpec = control.compiled?.channelSpecs.find((row) => row.slug === slug) ?? null;
  const [strategistRead, registrationRead] = await Promise.all([
    sb.from("strategists").select("id,slug,underlying,account_id,status,is_active,spec_json,strategist_config(*)")
      .eq("slug", slug).single(),
    sb.from("research_channel_registration_current")
      .select("id,registration_key,channel_id,channel_slug,state,content_hash,candidate_spec,cartridge")
      .eq("channel_slug", slug).maybeSingle(),
  ]);
  if (strategistRead.error || !strategistRead.data) {
    throw new Error(`strategist read failed: ${strategistRead.error?.message ?? "missing"}`);
  }
  if (registrationRead.error) throw new Error(`research registration read failed: ${registrationRead.error.message}`);
  const strategist = strategistRead.data as unknown as Record<string, unknown>;
  const registration = registrationRead.data as unknown as Record<string, unknown> | null;
  const registeredSpec = registration?.state === "paper-eligible"
    ? object(registration.candidate_spec) : null;
  const configuration = activeSpec ?? registeredSpec ?? {
    slug,
    channelId: String(strategist.id),
    accountId: String(strategist.account_id),
    symbolScope: [String(strategist.underlying ?? "")],
    familyId: `unregistered:${slug}`,
    collisionDomain: `unregistered:${slug}`,
    quantity: numeric(object(strategist.strategist_config).max_contracts) ?? 1,
    priority: 9_999,
    entryParameters: {},
    sourceSpecJson: strategist.spec_json ?? null,
    sourceStrategistConfig: strategist.strategist_config ?? null,
  };
  const configurationHash = activeSpec?.contentHash
    ?? text(registration?.content_hash)
    ?? sha256(configuration);
  const publicationEligible = Boolean(activeSpec
    ? control.state === "receipt-bound" && control.activationReceipt && control.databaseIdentity
    : registeredSpec && registration?.state === "paper-eligible");
  const provenance = activeSpec ? {
    source: "activated_manifest",
    channelSpecVersionId: control.databaseIdentity?.channelSpecDatabaseIdsByVersionKey[activeSpec.id] ?? null,
    releaseManifestId: control.databaseIdentity?.releaseManifestDatabaseId ?? null,
    configurationEpochId: control.activationReceipt?.configurationEpochId ?? null,
    researchRegistrationId: null,
  } : registeredSpec ? {
    source: "research_registration",
    channelSpecVersionId: null,
    releaseManifestId: null,
    configurationEpochId: null,
    researchRegistrationId: String(registration?.id ?? ""),
  } : {
    source: "mutable_strategist_snapshot_local_only",
    channelSpecVersionId: null,
    releaseManifestId: null,
    configurationEpochId: null,
    researchRegistrationId: text(registration?.id),
  };

  const configObject = object(configuration);
  const entryParameters = object(configObject.entryParameters);
  const riskLimits = object(configObject.riskLimits);
  const sourceStrategistConfig = object(configObject.sourceStrategistConfig ?? strategist.strategist_config);
  const maxEntries = Math.max(1, Math.trunc(numeric(entryParameters.maxEntriesPerSession)
    ?? numeric(entryParameters.max_entries_per_session) ?? 6));
  const requestedQuantity = numeric(arg("quantity"));
  if (requestedQuantity != null && (!Number.isInteger(requestedQuantity) || requestedQuantity < 1)) {
    throw new Error("--quantity must be a positive integer");
  }
  const quantity = requestedQuantity ?? Math.max(1, Math.trunc(numeric(configObject.quantity) ?? 1));
  const maxDebitUsd = numeric(arg("max-debit-usd"))
    ?? numeric(configObject.maxDebitUsd) ?? numeric(riskLimits.maxDebitUsd)
    ?? Number.MAX_SAFE_INTEGER;
  const maxStopExposureUsd = numeric(arg("max-risk-usd"))
    ?? numeric(riskLimits.maxRiskUsd) ?? numeric(sourceStrategistConfig.capital_pct)
    ?? Number.MAX_SAFE_INTEGER;
  const priority = numeric(configObject.priority) ?? 9_999;
  const accountId = text(configObject.accountId) ?? String(strategist.account_id);
  const underlying = (text(configObject.symbolScope && Array.isArray(configObject.symbolScope)
    ? configObject.symbolScope[0] : null) ?? String(strategist.underlying ?? "SPY")).toUpperCase();
  const familyId = text(configObject.familyId);
  const collisionDomain = text(configObject.collisionDomain);
  const forceExitEt = arg("force-exit-et") ?? (slug === "fomc-follow" ? "15:25" : "15:55");
  const quotePolicy: ExecutableShadowRunPolicy = {
    maxEntryDelayMs: Number(arg("max-entry-delay-ms") ?? 75_000),
    maxQuoteAgeMs: Number(arg("max-quote-age-ms") ?? 15_000),
    maxForceExitQuoteGapMs: Number(arg("max-force-exit-gap-ms") ?? 90_000),
    maxSpreadShare: Number(arg("max-spread-share") ?? 0.25),
    requireProviderClock: true,
    requireDisplayedSize: true,
  };

  const fromUtc = etDayRangeUtc(fromSession).start;
  const throughUtc = etDayRangeUtc(throughSession).end;
  const signals = await pageAll<SignalRow>((from, to) => sb.from("signals")
    .select("id,strategist_id,created_at,direction,rationale")
    .eq("strategist_id", String(strategist.id))
    .gte("created_at", fromUtc).lt("created_at", throughUtc)
    .order("created_at").order("id").range(from, to));
  const occs = [...new Set(signals.map((row) => text(row.rationale?.occ)).filter(Boolean) as string[])];
  const quotes: QuoteRow[] = [];
  for (let index = 0; index < occs.length; index += 40) {
    const batch = occs.slice(index, index + 40);
    quotes.push(...await pageAll<QuoteRow>((from, to) => sb.from("option_quotes")
      .select("id,occ_symbol,captured_at,provider_quote_at,bid,ask,bid_size,ask_size,delta,strike,underlying_price,opt_type,expiration,request_started_at,observed_at")
      .in("occ_symbol", batch)
      .gte("captured_at", fromUtc).lt("captured_at", throughUtc)
      .order("captured_at").order("id").range(from, to)));
  }
  if (deltaTargets.length || itmSteps.length) {
    const sessions = [...new Set(signals.map((signal) => sessionDateEt(signal.created_at)))].sort();
    for (const session of sessions) {
      quotes.push(...await pageAll<QuoteRow>((from, to) => sb.from("option_quotes")
        .select("id,occ_symbol,captured_at,provider_quote_at,bid,ask,bid_size,ask_size,delta,strike,underlying_price,opt_type,expiration,request_started_at,observed_at")
        .eq("underlying", underlying).eq("expiration", session)
        .gte("captured_at", etDayRangeUtc(session).start)
        .lt("captured_at", etSessionCloseUtc(session))
        .order("captured_at").order("id").range(from, to)));
    }
  }
  const rawQuoteById = new Map(quotes.map((row) => [row.id, row]));
  const quoteByOcc = new Map<string, ExecutableShadowQuote[]>();
  for (const row of rawQuoteById.values()) {
    const converted: ExecutableShadowQuote = {
      id: row.id,
      capturedAt: row.captured_at,
      providerAt: row.provider_quote_at,
      bid: numeric(row.bid),
      ask: numeric(row.ask),
      bidSize: numeric(row.bid_size),
      askSize: numeric(row.ask_size),
    };
    quoteByOcc.set(row.occ_symbol, [...(quoteByOcc.get(row.occ_symbol) ?? []), converted]);
  }
  const contractArms = [
    { id: "signal-selected-contract", kind: "signal" as const, target: null },
    ...deltaTargets.map((targetDelta) => ({
      id: `same-expiry-abs-delta-${targetDelta.toFixed(2)}`,
      kind: "delta" as const,
      target: targetDelta,
    })),
    ...itmSteps.map((steps) => ({
      id: `same-expiry-${steps}-executable-strike${steps === 1 ? "" : "s"}-more-itm`,
      kind: "itm" as const,
      target: steps,
    })),
  ];
  const chainQuotes: ExecutableShadowContractCandidate[] = [...rawQuoteById.values()].map((quote) => ({
    id: quote.id,
    occSymbol: quote.occ_symbol,
    optionType: quote.opt_type,
    expiration: quote.expiration,
    strike: numeric(quote.strike),
    delta: numeric(quote.delta),
    underlyingPrice: numeric(quote.underlying_price),
    capturedAt: quote.captured_at,
    requestStartedAt: quote.request_started_at,
    observedAt: quote.observed_at,
    providerAt: quote.provider_quote_at,
    bid: numeric(quote.bid),
    ask: numeric(quote.ask),
    askSize: numeric(quote.ask_size),
  }));
  const contractFor = (signal: SignalRow, arm: typeof contractArms[number]) => {
    const rationale = object(signal.rationale);
    const baseOccSymbol = text(rationale.occ)?.toUpperCase() ?? null;
    if (arm.kind === "signal") return {
      occSymbol: baseOccSymbol,
      quoteId: null,
      snapshotKey: null,
      snapshotCapturedAt: null,
      strike: null,
      observedDelta: numeric(rationale.delta),
      underlyingPrice: numeric(rationale.spotClose),
      reason: baseOccSymbol ? "signal_selected_contract" : "signal_contract_missing",
    };
    const decisionAt = text(rationale.decision_observed_at) ?? signal.created_at;
    const session = sessionDateEt(signal.created_at);
    const side = (text(signal.direction) ?? text(rationale.candidate_side) ?? "").toLowerCase();
    if (!baseOccSymbol && arm.kind === "itm") return {
      occSymbol: null, quoteId: null, snapshotKey: null, snapshotCapturedAt: null,
      strike: null, observedDelta: null, underlyingPrice: null, reason: "signal_contract_missing",
    };
    return selectExecutableShadowContract({
      decisionAt,
      expiration: session,
      optionType: side,
      // Freeze the wrapper independently of the capacity arm. The engine
      // evaluates actual displayed-size admissibility for `quantity` later;
      // otherwise a larger size can silently become a different contract.
      quantity: 1,
      candidates: chainQuotes,
      arm: arm.kind === "delta"
        ? { kind: "abs_delta", target: arm.target! }
        : { kind: "itm_steps", steps: arm.target!, baseOccSymbol: baseOccSymbol! },
      policy: quotePolicy,
    });
  };
  const contractSelectionAudit: Array<Record<string, unknown>> = [];
  const runs = managerNames.flatMap((managerName) => contractArms.map((contractArm) => {
    const opportunities: ExecutableShadowOpportunity[] = signals.map((signal) => {
      const rationale = object(signal.rationale);
      const selection = contractFor(signal, contractArm);
      const occ = selection.occSymbol;
      const session = sessionDateEt(signal.created_at);
      const sourceBarAt = text(rationale.decision_source_bar_at) ?? signal.created_at;
      const decisionAt = text(rationale.decision_observed_at) ?? signal.created_at;
      return {
        id: `${signal.id}:${managerName}:${contractArm.id}`,
        signalId: signal.id,
        channelId: String(strategist.id),
        channelSlug: slug,
        sessionDateEt: session,
        accountId,
        underlying,
        occSymbol: occ,
        contractSelectionId: contractArm.id,
        contractSelectionSnapshot: {
          armKind: contractArm.kind,
          target: contractArm.target,
          selectionLiquidityFloorQuantity: contractArm.kind === "signal" ? null : 1,
          baseOccSymbol: text(rationale.occ)?.toUpperCase() ?? null,
          selectedOccSymbol: selection.occSymbol,
          selectionQuoteId: selection.quoteId,
          snapshotKey: selection.snapshotKey,
          snapshotCapturedAt: selection.snapshotCapturedAt,
          strike: selection.strike,
          observedDelta: selection.observedDelta,
          underlyingPrice: selection.underlyingPrice,
          reason: selection.reason,
        },
        familyId,
        collisionDomain,
        signalAt: Date.parse(sourceBarAt) <= Date.parse(decisionAt) ? sourceBarAt : signal.created_at,
        decisionAt,
        decisionClock: `${underlying}:${sourceBarAt}`,
        decisionClockAt: sourceBarAt,
        quantity,
        priority,
        maxEntriesPerSession: maxEntries,
        maxDebitUsd,
        maxStopExposureUsd,
        channelSpecVersionId: provenance.channelSpecVersionId ?? `local:${configurationHash}`,
        releaseManifestId: provenance.releaseManifestId ?? `local:${provenance.source}`,
        configurationEpochId: provenance.configurationEpochId ?? configurationHash,
        manager: manager(managerName, session, forceExitEt),
        quotes: occ ? quoteByOcc.get(occ) ?? [] : [],
        sourceRefs: [
          `supabase:signals:${signal.id}`,
          ...(occ ? [`supabase:option_quotes:${occ}:${session}`] : []),
          `contract_selection:${selection.reason}:${selection.snapshotKey ?? "signal"}`,
          `${provenance.source}:${configurationHash}`,
        ],
      };
    });
    for (const opportunity of opportunities) contractSelectionAudit.push({
      signalId: opportunity.signalId,
      manager: managerName,
      contractSelectionId: contractArm.id,
      occSymbol: opportunity.occSymbol,
      contractSelectionSnapshot: opportunity.contractSelectionSnapshot,
    });
    return {
      manager: managerName,
      contractSelectionId: contractArm.id,
      ledger: buildExecutableShadowLedger({
        generatedAt: new Date().toISOString(),
        opportunities,
        accountPolicies: [],
        policy: quotePolicy,
        modes: ["channel_isolated"],
      }),
    };
  }));
  const comparisons = runs.flatMap((left, leftIndex) => runs.slice(leftIndex + 1)
    .filter((right) => (left.contractSelectionId === right.contractSelectionId)
      !== (left.manager === right.manager))
    .map((right) => {
    const leftBySignal = new Map(left.ledger.receipts
      .filter((row) => row.resultPerContractUsd != null)
      .map((row) => [row.signalId, row]));
    const rightBySignal = new Map(right.ledger.receipts
      .filter((row) => row.resultPerContractUsd != null)
      .map((row) => [row.signalId, row]));
    const sharedSignalIds = [...leftBySignal.keys()].filter((id) => rightBySignal.has(id)).sort();
    const onlyLeft = [...leftBySignal.keys()].filter((id) => !rightBySignal.has(id)).sort();
    const onlyRight = [...rightBySignal.keys()].filter((id) => !leftBySignal.has(id)).sort();
    const pairs = sharedSignalIds.map((signalId) => {
      const leftReceipt = leftBySignal.get(signalId)!;
      const rightReceipt = rightBySignal.get(signalId)!;
      return {
        signalId,
        sessionDateEt: leftReceipt.sessionDateEt,
        leftResultPerContractUsd: leftReceipt.resultPerContractUsd!,
        rightResultPerContractUsd: rightReceipt.resultPerContractUsd!,
        rightMinusLeftPerContractUsd: Math.round(
          (rightReceipt.resultPerContractUsd! - leftReceipt.resultPerContractUsd!) * 100,
        ) / 100,
      };
    });
    return {
      comparisonAxis: left.contractSelectionId === right.contractSelectionId ? "manager" : "contract",
      leftManager: left.manager,
      rightManager: right.manager,
      leftContractSelectionId: left.contractSelectionId,
      rightContractSelectionId: right.contractSelectionId,
      sameOpportunity: {
        pairs: pairs.length,
        sessions: new Set(pairs.map((row) => row.sessionDateEt)).size,
        leftResultPerContractUsd: pairs.reduce((sum, row) => sum + row.leftResultPerContractUsd, 0),
        rightResultPerContractUsd: pairs.reduce((sum, row) => sum + row.rightResultPerContractUsd, 0),
        rightMinusLeftPerContractUsd: pairs.reduce((sum, row) => sum + row.rightMinusLeftPerContractUsd, 0),
        rightImproved: pairs.filter((row) => row.rightMinusLeftPerContractUsd > 0).length,
        pairedRows: pairs,
      },
      managerInducedAdmission: {
        onlyLeftSignals: onlyLeft,
        onlyRightSignals: onlyRight,
        warning: "Unmatched fills are caused by manager-specific exit timing changing later admission; they are not paired exit evidence.",
      },
    };
  }));
  const report = {
    schemaVersion: 1,
    kind: "executable-shadow-pilot",
    generatedAt: new Date().toISOString(),
    slug,
    fromSession,
    throughSession,
    provenance,
    configurationHash,
    configurationSnapshot: configuration,
    studiedQuantity: quantity,
    studiedChannelRiskEnvelope: {
      maxDebitUsd: maxDebitUsd === Number.MAX_SAFE_INTEGER ? null : maxDebitUsd,
      maxStopExposureUsd: maxStopExposureUsd === Number.MAX_SAFE_INTEGER ? null : maxStopExposureUsd,
      explicitOverride: arg("max-debit-usd") != null || arg("max-risk-usd") != null,
    },
    publicationEligible,
    publicationBlockers: publicationEligible ? [] : [
      activeSpec ? "active_manifest_is_not_exactly_receipt_bound" :
        registration ? `research_registration_${String(registration.state)}` : "research_registration_missing",
    ],
    evidenceContract: {
      entry: "first qualifying observed ask at/after decision",
      exit: "first triggering observed bid, or bid near frozen force-exit clock",
      chronology: "one open position per channel; filled-entry cap per session",
      providerClockRequired: true,
      displayedSizeRequired: true,
      exploratoryVirtualPathsIncluded: false,
      portfolioCollisionClaims: false,
      productionWrites: 0,
      executionAuthority: false,
      orderAuthority: false,
    },
    quotePolicy,
    contractSelectionAudit,
    sourceCounts: { signals: signals.length, contracts: quoteByOcc.size, quotes: rawQuoteById.size },
    runs,
    comparisons,
  };
  const output = { ...report, contentHash: sha256(report) };
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outputFile,
    slug,
    fromSession,
    throughSession,
    publicationEligible,
    blockers: output.publicationBlockers,
    sourceCounts: output.sourceCounts,
    summaries: runs.map((row) => ({ manager: row.manager,
      contractSelectionId: row.contractSelectionId, ...row.ledger.summaries[0] })),
    contentHash: output.contentHash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
