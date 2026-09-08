/** Global predecessor admission. A new session, contract, release or restart
 * cannot bypass an unfinished intent. This gate is separate from signal,
 * account and execution authority, all of which remain required at each POST.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { buildFixedEntryIntent, parseFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { verifyFixedIntentSettlement, type FixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { claimFixedProtocolRecord, fixedProtocolObservation, fixedProtocolRecord, parseFixedProtocolRecord,
  parseFixedStoredObservation, type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import type { FixedCoverageSnapshot } from "./fixedEntryCoverageMaterialization.js";
export interface FixedAdmissionHistory {
  /** Service-client discovery, without date/roster/open-position filters; each
   * member contains a complete paginated inventory and original position rows. */
  intents: { intent: FixedEntryIntent; snapshot: Pick<FixedCoverageSnapshot, "records" | "positions"> }[];
  observedAtMs: number;
  /** Complete positive-quantity legacy root-position count for this channel's ET
   * session. Excludes every fixed-protocol position generation. Never count
   * protocol observations or remainder rows as additional entries. This is a
   * conservative admission block, not independent verification of broker fills. */
  legacySessionEntries: number;
}
type Predecessor = Pick<FixedEntryIntent, "attempt" | "predecessorIntentId" | "predecessorSettlementHash">;
export type FixedAdmissionDecision = { allowed: true; predecessor: Predecessor }
  | { allowed: false; reason: string };
export function planFixedIntentAdmission(history: FixedAdmissionHistory, input: {
  accountId: string; strategistId: string; sessionDateEt: string; nowMs: number;
}): FixedAdmissionDecision {
  const deny = (reason: string): FixedAdmissionDecision => ({ allowed: false, reason });
  try {
    const age = input.nowMs - history.observedAtMs;
    if (!Number.isFinite(age) || age < 0 || age > 2_000) return deny("global-history-stale");
    if (!Number.isSafeInteger(history.legacySessionEntries) || history.legacySessionEntries < 0) return deny("legacy-session-count-unavailable");
    if (history.legacySessionEntries > 0) return deny("session-entry-already-consumed");
    const byId = new Map<string, typeof history.intents[number]>();
    const settled = new Map<string, FixedProtocolRecord>();
    for (const item of history.intents) {
      const i = parseFixedEntryIntent(item.intent);
      if (!i || byId.has(i.id) || i.accountId !== input.accountId) return deny("global-intent-identity-invalid");
      byId.set(i.id, item);
      inspectFixedEntryInventory(i, item.snapshot.records);
      const done = verifyFixedIntentSettlement(i, item.snapshot);
      if (!done) return deny("prior-intent-unsettled-or-unproven");
      if (Date.parse(done.recordedAt) > input.nowMs || i.sessionDateEt > input.sessionDateEt) return deny("global-history-from-future");
      const economics = done.body.intentSettlement as FixedIntentSettlement;
      if (i.sessionDateEt === input.sessionDateEt && economics.sessionEntryConsumed) return deny("session-entry-already-consumed");
      settled.set(i.id, done);
    }
    const children = new Map<string, string>();
    let genesisCount = 0;
    for (const { intent: i } of byId.values()) {
      if (i.predecessorIntentId === null) {
        if (i.attempt !== 0 || ++genesisCount > 1) return deny("global-chain-invalid");
      } else {
        const prior = byId.get(i.predecessorIntentId)?.intent, proof = settled.get(i.predecessorIntentId);
        if (!prior || !proof || prior.slug !== i.slug || prior.accountId !== i.accountId
            || i.attempt !== prior.attempt + 1 || i.predecessorSettlementHash !== proof.contentHash
            || i.sessionDateEt < prior.sessionDateEt || Date.parse(i.createdAt) < Date.parse(proof.recordedAt)
            || children.has(prior.id)) return deny("global-chain-invalid");
        children.set(prior.id, i.id);
      }
    }
    const own = [...byId.values()].map(x => x.intent);
    const heads = own.filter(i => !children.has(i.id));
    if (own.length && (heads.length !== 1 || genesisCount !== 1)) return deny("global-chain-invalid");
    const head = heads[0];
    return { allowed: true, predecessor: head ? { attempt: head.attempt + 1, predecessorIntentId: head.id,
      predecessorSettlementHash: settled.get(head.id)!.contentHash }
      : { attempt: 0, predecessorIntentId: null, predecessorSettlementHash: null } };
  } catch { return deny("global-history-invalid"); }
}
export type FixedIntentSeed = Omit<Parameters<typeof buildFixedEntryIntent>[0], keyof Predecessor>;
export interface FixedIntentAdmissionPorts {
  storage: ImmutableClaimStorage;
  now(): number;
  history(seed: FixedIntentSeed): Promise<FixedAdmissionHistory>;
  /** Current receipt-bound entry authority plus native entry/portfolio gates.
   * Persisting an intent is not broker authority; repeat gates at each POST. */
  authorizeCurrent(seed: FixedIntentSeed): Promise<boolean>;
}
export async function admitFixedEntryIntent(ports: FixedIntentAdmissionPorts, originalSeed: FixedIntentSeed): Promise<{
  state: "created" | "existing" | "declined" | "uncertain"; reason: string; intent: FixedEntryIntent | null;
}> {
  const seed = structuredClone(originalSeed);
  const decline = (reason: string) => ({ state: "declined" as const, reason, intent: null });
  try {
    const history = await ports.history(structuredClone(seed));
    const gate = planFixedIntentAdmission(history, { ...seed, nowMs: ports.now() });
    if (!gate.allowed) return decline(gate.reason);
    if (!await ports.authorizeCurrent(structuredClone(seed))) return decline("current-entry-authority-rejected");
    // Refresh complete history after the potentially expensive authority read.
    // Never lengthen its freshness limit, nor silently move to a newer chain
    // head under authority obtained for the earlier admission. The shared
    // next-slot UUID still fences a competing winner after this second read.
    const freshHistory = await ports.history(structuredClone(seed));
    const fresh = planFixedIntentAdmission(freshHistory, { ...seed, nowMs: ports.now() });
    if (!fresh.allowed) return decline(fresh.reason);
    if (canonicalJson(fresh.predecessor) !== canonicalJson(gate.predecessor)) return decline("global-history-head-changed");
    const intent = buildFixedEntryIntent({ ...seed, ...gate.predecessor });
    if (Date.parse(intent.createdAt) > ports.now()) return decline("intent-time-from-future");
    if (gate.predecessor.predecessorIntentId) {
      const previous = freshHistory.intents.find(i => i.intent.id === gate.predecessor.predecessorIntentId)!;
      const proof = verifyFixedIntentSettlement(previous.intent, previous.snapshot)!;
      if (Date.parse(intent.createdAt) < Date.parse(proof.recordedAt)) return decline("intent-created-before-predecessor-settlement");
    }
    const record = fixedProtocolRecord({ id: intent.id, intentId: intent.id, kind: "intent",
      recordedAt: intent.createdAt, body: { intent } });
    const claim = await claimFixedProtocolRecord(ports.storage, fixedProtocolObservation(intent, record));
    const stored = claim.record;
    const parsed = stored && parseFixedProtocolRecord(stored.payload.fixed_entry_record);
    const winner = parsed?.kind === "intent" ? parseFixedEntryIntent(parsed.body.intent) : null;
    if (!stored || !winner || winner.id !== intent.id) return { state: "uncertain", reason: "intent-readback-unproven", intent: null };
    parseFixedStoredObservation(winner, stored);
    const same = canonicalJson(winner) === canonicalJson(intent);
    return { state: claim.state === "fresh-winner" && same ? "created" : "existing",
      reason: same ? "durable-original-intent" : "concurrent-original-intent-won", intent: winner };
  } catch { return { state: "uncertain", reason: "intent-admission-evidence-unavailable", intent: null }; }
}
