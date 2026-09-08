/** Concrete fixed execution driver: service-only durable storage, exact broker
 * transport, admission and lifecycle. The worker supplies fresh current native
 * authority and reporting; neither a stale cycle context nor this constructor
 * grants order authority. Construction performs no I/O and does not install it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixedEntryExecutionDriver } from "./fixedEntryExecutionDispatch.js";
import type { ExecCtx } from "./execute.js";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig, PositionRow } from "./store.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { makeFixedEntryBrokerTransport } from "./fixedEntryBrokerTransport.js";
import { fixedClaimStorage, applyFixedRowCas } from "./fixedEntryLedgerSupabase.js";
import { discoverFixedEntryIntents, readFixedIntentRecords, readFixedIntentPositions,
  readFixedPosition, readFixedAdmissionHistory, makeFixedSupabaseCoveragePorts } from "./fixedEntrySupabaseCoverage.js";
import { admitFixedEntryIntent, type FixedIntentSeed } from "./fixedEntryIntentAdmission.js";
import { parseFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { readFixedRowFence } from "./fixedEntryRowFence.js";
import { fixedPositionIdentityMatches } from "./fixedEntryCoverageMaterialization.js";
import { verifyFixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { reconcileFixedLifecycle, type FixedLifecyclePorts, type FixedLifecycleResult } from "./fixedEntryLifecycle.js";
import { observeFixedNativeManagement, type FixedManagementInput } from "./fixedEntryManagement.js";
import { evaluateFixedContinuationAffordability, type OptionsAffordabilitySnapshot } from "./fixedContractAffordability.js";
import { buildFixedEntryExecutionPlan, type FixedEntryExecutionPlan } from "./fixedEntryExecutionPlan.js";
import type { FixedCommandClaim } from "./fixedEntryCommandCoordinator.js";
import { observedOpportunityId } from "./planShadowModel.js";
type Source = "cycle" | "sweep";
type Client = Pick<SupabaseClient, "from">;
export interface FixedRuntimeEntryAuthority {
  allowed: boolean;
  /** Earliest expiry of current native gates and configuration authority. */
  validUntilMs: number;
  bid: number; ask: number; quoteAgeMs: number;
  account: OptionsAffordabilitySnapshot | null;
}
export interface FixedRuntimeBindings {
  now(): number;
  submissionEnabled(side:"buy"|"sell"|"cancel"):boolean;
  /** Resolve credentials from the ORIGINAL account; no default/current-channel
   * fallback. The transport validates the explicit paper host/account identity. */
  broker(intent: FixedEntryIntent): Promise<Parameters<typeof makeFixedEntryBrokerTransport>[1] | null>;
  /** Must independently establish complete desk/peer routing, and reject any
   * other owner's open row/working order on this original account/OCC. */
  exclusiveContract(intent: FixedEntryIntent): Promise<{ allowed: boolean; observedAtMs: number }>;
  /** Recheck all current native entry gates, active receipt/account congruence,
   * fresh executable quote and options buying power. No downsizing/cap fallback.
   * The original accepted signal itself is not reinterpreted after restarting. */
  entryAuthority(seed: FixedIntentSeed, command: FixedCommandClaim | null): Promise<FixedRuntimeEntryAuthority>;
  management(intent: FixedEntryIntent, source: Source, brokerMark: FixedManagementInput["brokerMark"]): Promise<{
    input: FixedManagementInput; allowed: boolean; validUntilMs: number;
  }>;
  executionSettings(): { spreadCapture: boolean; ladder: FixedEntryExecutionPlan["ladder"] };
  onCommand: NonNullable<FixedLifecyclePorts["onCommand"]>;
  onCoverage: NonNullable<FixedLifecyclePorts["onCoverage"]>;
  /** Replay terminal/lineage/manager reporting from complete durable evidence,
   * including already-settled intents; failures retry on subsequent passes. */
  onReporting(intent: FixedEntryIntent): Promise<void>;
  status(intentId: string | null, state: string, reasons: readonly string[]): Promise<void>;
}
export function makeFixedEntryRuntimeDriver(client: Client, bootId: string, bindings: FixedRuntimeBindings): FixedEntryExecutionDriver & {
  recoverAll(source: Source): Promise<{ complete: boolean; unresolved: { accountId: string; occ: string; intentId: string }[] }>;
  recover(intent: FixedEntryIntent, source: Source): Promise<FixedLifecycleResult>;
} {
  assertFixedEntryServiceClient(client);
  const storage = fixedClaimStorage(client, bootId);
  // Local overlap suppression only reduces redundant work. Durable claims/CAS,
  // not this map, own orders and booking across processes and restarts.
  const running = new Map<string, Promise<FixedLifecycleResult>>();
  const reporting = new Set<string>();
  const report = async (intentId: string | null, state: string, reasons: readonly string[]) => {
    try { await bindings.status(intentId, state, reasons); return true; } catch { return false; }
  };
  const fresh = (until: number) => Number.isFinite(bindings.now()) && Number.isFinite(until) && bindings.now() < until;
  const queueReporting = (intent: FixedEntryIntent) => {
    if (reporting.has(intent.id)) return;
    reporting.add(intent.id);
    // Reporting I/O must never hold the next native-management pass hostage.
    // No permanent process-local success cache: settled recovery retries too.
    void Promise.resolve().then(() => bindings.onReporting(structuredClone(intent)))
      .catch(() => report(intent.id, "reporting-unconfirmed", ["durable-reporting-replay-required"]))
      .finally(() => reporting.delete(intent.id));
  };
  const seedOf = (intent: FixedEntryIntent): FixedIntentSeed => {
    const { protocol: _protocol, id: _id, contentHash: _hash, sessionSlotId: _slot,
      attempt: _attempt, predecessorIntentId: _predecessor, predecessorSettlementHash: _proof, ...seed } = intent;
    return seed;
  };
  async function storedIntent(row: PositionRow): Promise<FixedEntryIntent> {
    const id = readFixedRowFence({ ...row, entry_features: row.entry_features ?? {} }).intentId;
    const intent = (await discoverFixedEntryIntents(client)).find(i => i.id === id);
    if (!intent) throw new Error("fixed_runtime:row_original_intent_unavailable");
    const persisted = await readFixedPosition(client, intent, row.id);
    if (!persisted || !fixedPositionIdentityMatches(intent, persisted)
        || persisted.strategist_id !== row.strategist_id || persisted.occ_symbol !== row.occ_symbol) {
      throw new Error("fixed_runtime:row_original_identity_mismatch");
    }
    return intent;
  }
  async function portsFor(intent: FixedEntryIntent, source: Source): Promise<FixedLifecyclePorts> {
    if (!parseFixedEntryIntent(intent)) throw new Error("fixed_runtime:original_intent_invalid");
    const account = await bindings.broker(structuredClone(intent));
    if (!account) throw new Error("fixed_runtime:original_broker_unavailable");
    const broker = makeFixedEntryBrokerTransport(intent, {...account,submissionEnabled:side=>bindings.submissionEnabled(side)===true});
    let brokerMark: FixedManagementInput["brokerMark"] = null;
    const coverage = makeFixedSupabaseCoveragePorts(client, bootId, { intent, now: bindings.now,
      async attributedHoldings() {
        const all = await discoverFixedEntryIntents(client);
        const original = all.find(i => i.id === intent.id);
        if (!original || original.contentHash !== intent.contentHash) throw new Error("fixed_runtime:original_intent_changed");
        const allowed: Parameters<typeof broker.readContractInventory>[0][number][] = [];
        for (const owner of all.filter(i => i.accountId === intent.accountId && i.occ === intent.occ)) {
          const records = await readFixedIntentRecords(client, owner);
          if (owner.id !== intent.id) {
            const positions = await readFixedIntentPositions(client, owner);
            if (owner.attempt >= intent.attempt || !verifyFixedIntentSettlement(owner, { records, positions })) {
              throw new Error("fixed_runtime:competing_contract_owner");
            }
          }
          for (const fact of inspectFixedEntryInventory(owner, records).facts) allowed.push({ intent: owner, command: fact.command });
        }
        const inventory = await broker.readContractInventory(allowed);
        const proof = await bindings.exclusiveContract(structuredClone(intent));
        if (!proof.allowed || !Number.isFinite(proof.observedAtMs)) throw new Error("fixed_runtime:peer_ownership_unproven");
        const age = bindings.now() - proof.observedAtMs;
        if (!Number.isFinite(age) || age < 0 || age > 2_000) throw new Error("fixed_runtime:peer_ownership_stale");
        brokerMark = inventory.brokerMark === null ? null : { price: inventory.brokerMark, observedAtMs: inventory.observedAtMs };
        return inventory;
      } });
    const management = () => bindings.management(structuredClone(intent), source, brokerMark);
    return { coverage,
      booking: { storage, now: bindings.now, readRow: id => readFixedPosition(client, intent, id), cas: change => applyFixedRowCas(client, change) },
      commands: { storage, now: bindings.now, reserveSell: change => applyFixedRowCas(client, change),
        canSubmitNow:side=>bindings.submissionEnabled(side)===true,
        submitOnce: broker.submitOnce, lookupExact: broker.lookupExact },
      async observeManagement(original, snapshot) {
        const state = await management();
        // Record known mandatory exits even if current management authority is
        // unavailable. Permission is checked independently before any broker POST.
        return observeFixedNativeManagement(original, snapshot, state.input);
      },
      async mayManage() { const state = await management(); return state.allowed && fresh(state.validUntilMs); },
      async authorizeSubmission(original, claim) {
        if (claim.command.side === "sell") {
          const state = await management();
          return { allowed: state.allowed && fresh(state.validUntilMs), validUntilMs: state.validUntilMs };
        }
        const authorityStarted = bindings.now();
        const current = await bindings.entryAuthority(seedOf(original), structuredClone(claim));
        const records = await readFixedIntentRecords(client, original);
        const bought = inspectFixedEntryInventory(original, records).facts.filter(f => f.command.side === "buy")
          .reduce((sum, f) => sum + (f.provenFill?.filledQty ?? 0), 0);
        const nowMs = bindings.now();
        const affordability = evaluateFixedContinuationAffordability({ policy: original.writeStamp.entry_policy.fixedContractAdmission,
          slug: original.slug, quantity: claim.command.quantity, provenBoughtQty: bought,
          bid: current.bid, ask: current.ask, quoteAgeMs: current.quoteAgeMs + nowMs - authorityStarted, account: current.account, nowMs });
        return { allowed: current.allowed && fresh(current.validUntilMs) && affordability.allowed,
          validUntilMs: Math.min(current.validUntilMs, (current.account?.observedAtMs ?? -Infinity) + 2_000) };
      },
      cancelExact: broker.cancelExact, onCommand: bindings.onCommand, onCoverage: bindings.onCoverage,
    };
  }
  async function recover(intent: FixedEntryIntent, source: Source): Promise<FixedLifecycleResult> {
    if (!parseFixedEntryIntent(intent)) throw new Error("fixed_runtime:original_intent_invalid");
    const existing = running.get(intent.id); if (existing) return existing;
    const operation = (async () => {
      let result: FixedLifecycleResult;
      try {
        result = await reconcileFixedLifecycle(await portsFor(intent, source), intent);
      } catch {
        result = { state: "unresolved", intentId: intent.id,
          reasons: ["runtime-evidence-unavailable"], postsAttempted: 0, coverage: null, settlement: null };
      }
      // A failed journal is not evidence that prior broker work never happened.
      if (!await report(intent.id, result.state, result.reasons)) result.reasons.push("runtime-status-unconfirmed");
      queueReporting(intent);
      return result;
    })();
    running.set(intent.id, operation);
    try { return await operation; } finally { if (running.get(intent.id) === operation) running.delete(intent.id); }
  }
  return {
    recover,
    async recoverAll(source) {
      const unresolved: { accountId: string; occ: string; intentId: string }[] = [];
      try {
        // No current-date, channel-enabled or open-row filter: unresolved old
        // intents survive rollback, a failed position insert, and midnight.
        const all = await discoverFixedEntryIntents(client);
        for (const intent of all) {
          const [records, positions] = await Promise.all([readFixedIntentRecords(client, intent), readFixedIntentPositions(client, intent)]);
          if (verifyFixedIntentSettlement(intent, { records, positions })) { queueReporting(intent); continue; }
          const result = await recover(intent, source);
          if (result.state !== "settled") unresolved.push({ accountId: intent.accountId, occ: intent.occ, intentId: intent.id });
        }
        return { complete: true, unresolved };
      } catch {
        await report(null, "unresolved", ["global-fixed-discovery-unavailable"]);
        return { complete: false, unresolved };
      }
    },
    async enter(d: ShadowDecision, ch: ChannelConfig, spotClose: number, ctx: ExecCtx) {
      if (d.blocked || d.action !== "enter" || d.qty !== 4 || ch.slug !== "vb-macd-state"
          || d.slug !== ch.slug || !d.occ || !d.direction || !ctx.paperMode || !ctx.configurationWriteStamp
          || ch.account_id !== ctx.accountId || !Number.isFinite(spotClose) || spotClose <= 0) {
        await report(null, "declined", [d.blocked ?? "fixed-entry-context-invalid"]); return;
      }
      const now = bindings.now(), quote = ctx.chain.quoteObservation(d.occ, now);
      const quoteAge = typeof quote.localAgeMs === "number" ? quote.localAgeMs : NaN;
      if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 120_000) {
        await report(null, "declined", ["fixed-entry-quote-stale"]); return;
      }
      const seed: FixedIntentSeed = { sessionDateEt: ctx.todayET, strategistId: ch.id,
        accountId: ctx.accountId, slug: "vb-macd-state", underlying: "SPY", occ: d.occ,
        optionSide: d.direction, quantity: 4, sourceBarAt: new Date(ctx.decisionAtMs).toISOString(),
        createdAt: new Date(now).toISOString(), reason: d.reason,
        // Use the SAME deterministic identity as the actual bar-loop decision
        // observation. Strategy detail does not supply authoritative lineage.
        opportunityId: observedOpportunityId({ strategistId: ch.id, accountId: ctx.accountId,
          occ: d.occ, direction: d.direction, reason: d.reason, decisionAtMs: ctx.decisionAtMs,
          configurationEpochId: ctx.configurationWriteStamp.configuration_epoch_id }),
        writeStamp: structuredClone(ctx.configurationWriteStamp),
        executionPlan: buildFixedEntryExecutionPlan({ ...bindings.executionSettings(), quote: {
          bid: Number(quote.bid), ask: Number(quote.ask), observedAt: new Date(now - quoteAge).toISOString() } }),
        evidence: { ...structuredClone(d.detail ?? {}), entry_underlying: spotClose } };
      const admitted = await admitFixedEntryIntent({ storage, now: bindings.now,
        history: original => readFixedAdmissionHistory(client, original, bindings.now),
        async authorizeCurrent(original) {
          const gate = await bindings.entryAuthority(original, null);
          const affordability = evaluateFixedContinuationAffordability({ policy: original.writeStamp.entry_policy.fixedContractAdmission,
            slug: original.slug, quantity: 4, provenBoughtQty: 0, bid: gate.bid, ask: gate.ask,
            quoteAgeMs: gate.quoteAgeMs, account: gate.account, nowMs: bindings.now() });
          return gate.allowed && fresh(gate.validUntilMs) && affordability.allowed;
        } }, seed);
      await report(admitted.intent?.id ?? null, admitted.state, [admitted.reason]);
      if (admitted.intent) await recover(admitted.intent, "cycle");
    },
    async exit(_d, row, ctx) {
      // Re-evaluate original native management; a current-roster exit decision
      // is not authority to alter the original intent's manager after rollback.
      await recover(await storedIntent(row), ctx.fixedManagementSource ?? "cycle");
    },
    async reconcile(row, _ctx) { await recover(await storedIntent(row), "cycle"); },
  };
}
