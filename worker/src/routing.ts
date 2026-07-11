// ============================================================================
//  routing — cockpit P3 account routing as PURE functions (no env, no Api
//  construction), so the fail-closed invariants are selftest-coverable
//  (runner-selftest.ts) without a Supabase client or Alpaca creds.
//
//  THE INVARIANT (audit 2026-07-10, critical finding): a channel with
//  account_id SET must NEVER fall back to the default account's credentials.
//  cfg.accounts can read empty two ways — a project genuinely without the
//  accounts table (single-account, correct fallback), or a TRANSIENT read
//  failure (store.loadConfig marks that accountsFresh=false and index.ts keeps
//  the prior routing table). If an account_id still can't resolve, the channel
//  routes to a synthetic UNRESOLVED account that is never armed → decided +
//  logged, but no orders — never traded through the wrong account's API, and
//  its open rows never grouped where a zero-held read would phantom-reconcile
//  them closed.
// ============================================================================

import type { AccountRow, ChannelConfig } from "./store.js";

export const SYNTH_DEFAULT: AccountRow = { id: "__default__", name: "default", cred_ref: null, is_armed: true, is_halted: false, master_daily_stop_usd: 0 };

/** The sentinel cred_ref of a fail-closed unresolved account — can never match
 *  env creds, and acctCanManage refuses it explicitly (belt-and-suspenders). */
export const UNRESOLVED_CRED_REF = "__unresolved__";

/** Fail-closed placeholder for an account_id that doesn't resolve: never armed,
 *  halted, and a cred_ref that can never match env creds (api resolves null). */
export function unresolvedAccount(accountId: string): AccountRow {
  return { id: accountId, name: `unresolved:${accountId.slice(0, 8)}`, cred_ref: UNRESOLVED_CRED_REF, is_armed: false, is_halted: true, master_daily_stop_usd: 0 };
}

// ---- is_armed split (audit 2026-07-11, 1b #1) --------------------------------
// OPERATOR DECISION (docs/mission-1b-status.md, resolved #1): is_armed gates
// ENTRIES ONLY. The old single acctLive predicate gated the WHOLE execute block
// (entries AND exits AND reconcile), so disarming an account STRANDED its open
// positions — no stops, no EOD flatten, no reconcile — until re-armed. Split:
//
//   acctCanEnter  — may this account OPEN new risk (entries + pyramid adds)?
//                   live + is_armed + !is_halted + creds resolve (as before).
//   acctCanManage — may this account MANAGE what it already holds (exits,
//                   reconcile, marks, orphan sweep)? live + creds resolve.
//                   Deliberately IGNORES is_armed and is_halted: a disarmed
//                   account keeps its stop/EOD/event protection, and a halted
//                   one must still reach the flatten path (KILL = FLATTEN).
//
// PRESERVED invariants: api==null → neither predicate passes (never a wrong-
// account order), and an UNRESOLVED account (cred_ref sentinel) never manages —
// reconciling its rows against another account's positions is exactly the 10b
// phantom-close class (its api is null anyway; the check is belt-and-suspenders).
// NOT implemented (operator's explicit call): flatten-on-disarm.

/** May this account OPEN new risk (entries + pyramid adds)? */
export function acctCanEnter(account: AccountRow, live: boolean, hasApi: boolean): boolean {
  return live && account.is_armed && !account.is_halted && hasApi;
}

/** May this account MANAGE what it holds (exits, reconcile, marks, orphan sweep)?
 *  Runs even when disarmed or halted — see the block comment above. */
export function acctCanManage(account: AccountRow, live: boolean, hasApi: boolean): boolean {
  return live && hasApi && account.cred_ref !== UNRESOLVED_CRED_REF;
}

export function resolveDefaultAccount(accounts: AccountRow[]): AccountRow {
  return accounts.find((a) => !a.cred_ref) ?? SYNTH_DEFAULT;
}

export interface ChannelGroup { account: AccountRow; channels: ChannelConfig[] }

/** Group channels by their effective account. account_id null → the default
 *  account (that IS the single-account contract); account_id set but unknown →
 *  the fail-closed unresolved account, NEVER the default (the wrong-account
 *  order class). */
export function groupChannelsByAccount(channels: ChannelConfig[], accounts: AccountRow[]): ChannelGroup[] {
  const def = resolveDefaultAccount(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, ChannelGroup>();
  for (const ch of channels) {
    const acct = ch.account_id ? (byId.get(ch.account_id) ?? unresolvedAccount(ch.account_id)) : def;
    let g = groups.get(acct.id);
    if (!g) { g = { account: acct, channels: [] }; groups.set(acct.id, g); }
    g.channels.push(ch);
  }
  return [...groups.values()];
}

/** The account id a position row belongs to (via its channel). An UNRESOLVED
 *  account_id keeps its own id — the row lands in the fail-closed group (where
 *  nothing executes), not the default's (where a zero-held Alpaca read would
 *  phantom-reconcile it closed while the real lot rides on). */
export function rowAccountIdOf(row: { strategist_id: string }, byChannelId: Map<string, ChannelConfig>, accounts: AccountRow[]): string {
  const ch = byChannelId.get(row.strategist_id);
  return ch?.account_id ? ch.account_id : resolveDefaultAccount(accounts).id;
}
