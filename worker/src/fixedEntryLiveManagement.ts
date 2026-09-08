/** Read-only live bindings for original-account fixed management. This module
 * does not install a driver or grant fresh-entry authority. All clients and
 * credential resolution are explicit; current strategist routing is irrelevant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow } from "./store.js";
import type { Api } from "./alpaca.js";
import type { FixedRuntimeBindings } from "./fixedEntryRuntimeDriver.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { fixedEtClock } from "./fixedEntryManagement.js";
import { isTradingDay, sessionCloseMin } from "../../engine/market-calendar.js";
import { inEventWindow } from "../../engine/market-events.js";
import { parseFixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { FIXED_ORIGINAL_ACCOUNT_ID } from "./fixedEntryLegacyOwnership.js";
type Client = Pick<SupabaseClient, "from">;
const ACCOUNT_COLUMNS = "id,name,mode,cred_ref,is_armed,is_halted,master_daily_stop_usd";
export function makeFixedEntryLiveManagement(client: Client, input: {
  now(): number;
  liveMode(): boolean;
  apiForAccount(account: AccountRow): Api | null;
  quote(occ: string, atMs: number): { bid: number; ask: number; observedAtMs: number } | null;
  eventPolicy: { enabled: boolean; beforeMinutes: number; afterMinutes: number };
}): Pick<FixedRuntimeBindings, "broker" | "management"> {
  assertFixedEntryServiceClient(client);
  const paperApi = (account: AccountRow): Api | null => {
    // No synthetic/default account or missing credential reference can stand in
    // for the original MACD account. The explicit resolver must return paper.
    // This change is approved only for the existing second paper route. A
    // mutable account-row reassignment cannot silently redirect old intents.
    if (account.id !== FIXED_ORIGINAL_ACCOUNT_ID || account.mode !== "paper" || account.cred_ref !== "2") return null;
    const api = input.apiForAccount(account);
    return api?.paperHost.replace(/\/$/, "") === "https://paper-api.alpaca.markets" ? api : null;
  };
  async function account(id: string): Promise<AccountRow | null> {
    try {
      const r = await client.from("accounts").select(ACCOUNT_COLUMNS).eq("id", id).maybeSingle();
      if (r.error || !r.data || r.data.id !== id || typeof r.data.mode !== "string"
          || !(r.data.cred_ref === null || typeof r.data.cred_ref === "string")) return null;
      return r.data as AccountRow;
    } catch { return null; }
  }
  return {
    async broker(intent) {
      if (!parseFixedEntryIntent(intent)) return null;
      const original = await account(intent.accountId), api = original && paperApi(original);
      return api ? { accountId: intent.accountId, paperHost: api.paperHost, headers: { ...api.headers } } : null;
    },
    async management(intent, source, brokerMark) {
      const started = input.now();
      if (!parseFixedEntryIntent(intent) || !Number.isFinite(started)) throw new Error("fixed_live:invalid_original_or_clock");
      const [original, fund] = await Promise.all([
        account(intent.accountId),
        (async () => {
          try {
            const r = await client.from("fund_state").select("id,mode,is_halted").eq("id", 1).maybeSingle();
            return !r.error && r.data?.id === 1 ? r.data : null;
          } catch { return null; }
        })(),
      ]);
      const now = input.now(), clock = fixedEtClock(now), close = sessionCloseMin(clock.date);
      let quote: ReturnType<typeof input.quote> = null;
      try { quote = input.quote(intent.occ, now); } catch { /* A quote outage cannot erase a halt/manual/EOD exit. */ }
      const ep = input.eventPolicy;
      const validEventPolicy = typeof ep.enabled === "boolean" && Number.isFinite(ep.beforeMinutes)
        && ep.beforeMinutes >= 0 && Number.isFinite(ep.afterMinutes) && ep.afterMinutes >= 0;
      const validUntilMs = started + 2_000;
      // Arm/halt are not management permissions. A disarmed/ halted original
      // paper account still manages its original lots. A non-paper mode freezes
      // submission while independently observed required exits remain durable.
      return { validUntilMs,
        allowed: input.liveMode() && now >= started && now < validUntilMs
          && fund?.mode === "paper" && !!original && !!paperApi(original)
          && isTradingDay(clock.date) && clock.minute >= 570 && clock.minute < close,
        input: { nowMs: now, source, brokerMark, quote,
          fundHalted: typeof fund?.is_halted === "boolean" ? fund.is_halted : null,
          accountHalted: typeof original?.is_halted === "boolean" ? original.is_halted : null,
          // Fixed intent validation requires the original standdown policy.
          eventWindow: !validEventPolicy ? null : ep.enabled
            && inEventWindow(clock.date, clock.minute, ep.beforeMinutes, ep.afterMinutes, intent.underlying),
        } };
    },
  };
}
