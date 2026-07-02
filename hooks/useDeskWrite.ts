"use client";

import { useCallback } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelStatus, FundState, PmColor, StrategistConfig } from "@/lib/desk/types";
import type { StrategySpec } from "@/lib/desk/strategySpec";

// A new compiled channel to persist (strategists row + its strategist_config).
export interface NewChannelInput {
  slug: string;
  underlying: string; // the ticker this channel trades (SPY, QQQ, …)
  name: string;
  mandate: string;
  regime: string;
  accent: PmColor;
  sortOrder: number;
  status: ChannelStatus;
  spec: StrategySpec;
  thesisMd: string;
  config: StrategistConfig;
}

// Persists console changes to Supabase when the operator is signed in. Reads
// stay anon; these UPDATEs require the `authenticated` write policies
// (05_console_write_policies.sql). Fire-and-forget on the knob's onCommit (and
// pad/toggle clicks), so writes happen on release, not on every drag frame.
export function useDeskWrite() {
  const { session } = useAuth();
  const canWrite = !!session;

  const persistConfig = useCallback(
    async (strategistId: string, patch: Partial<StrategistConfig>) => {
      if (!session || !strategistId) return;
      try {
        await getSupabase()
          .from("strategist_config")
          .update(patch)
          .eq("strategist_id", strategistId);
      } catch {
        /* best-effort; local state already reflects the change */
      }
    },
    [session]
  );

  const persistFund = useCallback(
    async (patch: Partial<FundState>) => {
      if (!session) return;
      // `running` is a UI-only transport flag — never a DB column.
      const { running: _running, ...dbPatch } = patch;
      void _running;
      if (Object.keys(dbPatch).length === 0) return;
      try {
        await getSupabase().from("fund_state").update(dbPatch).eq("id", 1);
      } catch {
        /* best-effort */
      }
    },
    [session]
  );

  // Persist a newly-compiled channel: insert the strategists row, then its
  // config row. If the config insert fails, roll back the orphan strategists
  // row so a half-created channel never lingers. Returns the new id on success.
  const createChannel = useCallback(
    async (input: NewChannelInput): Promise<{ ok: boolean; id?: string; error?: string }> => {
      if (!session) return { ok: false, error: "sign in to add a channel" };
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from("strategists")
          .insert({
            slug: input.slug,
            underlying: input.underlying,
            name: input.name,
            mandate: input.mandate,
            regime: input.regime,
            accent: input.accent,
            sort_order: input.sortOrder,
            status: input.status,
            spec_json: input.spec,
            thesis_md: input.thesisMd,
            is_active: true,
          })
          .select("id")
          .single();
        if (error || !data) return { ok: false, error: error?.message ?? "channel insert failed" };

        const id = data.id as string;
        const { error: cfgErr } = await sb.from("strategist_config").insert({
          strategist_id: id,
          capital_pct: input.config.capital_pct,
          aggression: input.config.aggression,
          max_contracts: input.config.max_contracts,
          daily_stop_usd: input.config.daily_stop_usd,
          muted: input.config.muted,
          soloed: input.config.soloed,
        });
        if (cfgErr) {
          await sb.from("strategists").delete().eq("id", id); // roll back the orphan
          return { ok: false, error: `config insert failed: ${cfgErr.message}` };
        }
        return { ok: true, id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "create failed" };
      }
    },
    [session]
  );

  // DUPLICATE a channel — clone the strategists row + its config under a fresh numeric slug
  // (`<base>-2`, `-3`, … off the source's base, so siblings group), as a DRAFT so it never
  // trades until the operator arms it. The whole point: stand up an A/B variant (0DTE vs 1DTE,
  // a different u-stop) in two taps, tweak the copy, arm both. Built-in clones resolve to their
  // base strategy via the worker's `-N`-stripping base-slug resolver; compiled clones carry the
  // copied spec_json. The realtime sub re-hydrates the desk → the copy appears on the bench.
  const duplicateChannel = useCallback(
    async (sourceId: string): Promise<{ ok: boolean; slug?: string; name?: string; error?: string }> => {
      if (!session || !sourceId) return { ok: false, error: "sign in to duplicate" };
      try {
        const sb = getSupabase();
        const { data: src, error: e1 } = await sb
          .from("strategists")
          .select("slug,underlying,name,mandate,regime,accent,executor,account_id,spec_json,thesis_md,sort_order,strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,underlying_stop_pct,event_policy,entry_dte)")
          .eq("id", sourceId)
          .single();
        if (e1 || !src) return { ok: false, error: e1?.message ?? "source channel not found" };
        const s = src as Record<string, any>;
        const cfg = (Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config) ?? {};
        // next free `<base>-N` (base = source slug minus any trailing -N, so copies of copies group)
        const base = String(s.slug).replace(/-\d+$/, "");
        const { data: allRows } = await sb.from("strategists").select("slug");
        const taken = new Set(((allRows ?? []) as Array<{ slug: string }>).map((r) => r.slug));
        let n = 2; while (taken.has(`${base}-${n}`)) n++;
        const slug = `${base}-${n}`;
        const name = `${s.name} (copy)`;
        const { data: ins, error: e2 } = await sb
          .from("strategists")
          .insert({
            slug, underlying: s.underlying, name, mandate: s.mandate, regime: s.regime,
            accent: s.accent, executor: s.executor ?? "cron", account_id: s.account_id ?? null,
            spec_json: s.spec_json ?? null, thesis_md: s.thesis_md ?? null,
            sort_order: (Number(s.sort_order) || 0) + 1, status: "draft", is_active: true,
          })
          .select("id")
          .single();
        if (e2 || !ins) return { ok: false, error: e2?.message ?? "duplicate insert failed" };
        const newId = (ins as { id: string }).id;
        const { error: e3 } = await sb.from("strategist_config").insert({
          strategist_id: newId,
          // PAPER-LAB SIZING RULE (phase-4 A1, 2026-07-01): a clone starts at VALIDATION size —
          // RISK ≤ $500 / ≤6 contracts — regardless of the source's knobs. The 06-26 clones
          // inherited RISK $2,000 and owned the month's largest loss driver before earning any
          // forward evidence. Scale a clone UP only after it passes its pre-registered gate
          // (docs/pre-registered-tests-2026-07.md).
          capital_pct: Math.min(Number(cfg.capital_pct) || 200, 500), aggression: Number(cfg.aggression) || 0,
          max_contracts: Math.min(Number(cfg.max_contracts) || 6, 6), daily_stop_usd: Math.min(Number(cfg.daily_stop_usd) || 500, 1000),
          muted: false, soloed: false,
          underlying_stop_pct: cfg.underlying_stop_pct != null ? Number(cfg.underlying_stop_pct) : 0,
          event_policy: cfg.event_policy === "ignore" ? "ignore" : "standdown",
          entry_dte: cfg.entry_dte != null ? Number(cfg.entry_dte) : 0,
        });
        if (e3) { await sb.from("strategists").delete().eq("id", newId); return { ok: false, error: `config clone failed: ${e3.message}` }; }
        return { ok: true, slug, name };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "duplicate failed" };
      }
    },
    [session]
  );

  const renameChannel = useCallback(
    async (id: string, name: string): Promise<{ ok: boolean; error?: string }> => {
      if (!session || !id || !name.trim()) return { ok: false, error: "sign in / empty name" };
      try {
        const { error } = await getSupabase()
          .from("strategists")
          .update({ name: name.trim() })
          .eq("id", id);
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "rename failed" };
      }
    },
    [session]
  );

  // Recolor a channel (accent token). Free-text column, so any of the 12 palette
  // tokens is valid; the desk reducer updates the UI optimistically.
  const setChannelAccent = useCallback(
    async (id: string, accent: PmColor): Promise<{ ok: boolean; error?: string }> => {
      if (!session || !id) return { ok: false, error: "sign in to recolor" };
      try {
        const { error } = await getSupabase().from("strategists").update({ accent }).eq("id", id);
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "recolor failed" };
      }
    },
    [session]
  );

  // Bench ⇄ re-arm a channel (the 86'd shelf). status='draft' = no entries; the
  // workers still wind down any open position (exits/reconcile run for draft).
  // This is the UI form of the cull/rollback SQL — one tap, reversible.
  const setChannelStatus = useCallback(
    async (id: string, status: ChannelStatus): Promise<{ ok: boolean; error?: string }> => {
      if (!session || !id) return { ok: false, error: "sign in to change status" };
      try {
        const { error } = await getSupabase().from("strategists").update({ status }).eq("id", id);
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "status change failed" };
      }
    },
    [session]
  );

  // Flip a channel's EXECUTOR (cron ⇄ stream). The minute cron and the Railway stream
  // worker both read this flag every cycle (no deploy needed); rollback is the reverse
  // flip. This is the live migration control, now one auth-gated tap from the strip.
  const setChannelExecutor = useCallback(
    async (id: string, executor: "cron" | "stream"): Promise<{ ok: boolean; error?: string }> => {
      if (!session || !id) return { ok: false, error: "sign in to change executor" };
      try {
        const { error } = await getSupabase().from("strategists").update({ executor }).eq("id", id);
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "executor change failed" };
      }
    },
    [session]
  );

  // Delete a channel. A channel with trade history (signals/positions FK) can't
  // be hard-deleted without destroying that history, so we fall back to a soft
  // disable (status:'disabled' → hidden + skipped by the worker). Either way it
  // leaves the desk. Returns how it was removed.
  const deleteChannel = useCallback(
    async (id: string): Promise<{ ok: boolean; mode?: "deleted" | "disabled"; error?: string }> => {
      if (!session || !id) return { ok: false, error: "sign in to remove a channel" };
      try {
        const sb = getSupabase();
        const { error } = await sb.from("strategists").delete().eq("id", id);
        if (!error) return { ok: true, mode: "deleted" };
        // 23503 = FK violation (has signals/positions/orders history) → soft-disable
        if ((error as { code?: string }).code === "23503") {
          const { error: upErr } = await sb
            .from("strategists")
            .update({ status: "disabled", is_active: false })
            .eq("id", id);
          return upErr ? { ok: false, error: upErr.message } : { ok: true, mode: "disabled" };
        }
        return { ok: false, error: error.message };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "delete failed" };
      }
    },
    [session]
  );

  // Manual close: market-sell an open position via the server route (which holds
  // the Alpaca keys + service role). Sends the session token so the route can
  // verify the operator is signed in. Returns the booked realized P&L on success.
  const closePosition = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string; realized?: number }> => {
      if (!session) return { ok: false, error: "sign in to close" };
      try {
        const r = await fetch("/api/close-position", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ id }),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok && j.ok ? { ok: true, realized: j.realized } : { ok: false, error: j.error ?? `close failed (${r.status})` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "close failed" };
      }
    },
    [session]
  );

  // Post-close tag (close-reason chips, 31_close_reason.sql): refine an operator
  // close to 'manual:<tag>'. The close already booked — tagging is optional context,
  // so failures are soft (the row just stays 'manual').
  const tagClose = useCallback(
    async (id: string, tag: string): Promise<{ ok: boolean; error?: string }> => {
      if (!session) return { ok: false, error: "sign in to tag" };
      try {
        const r = await fetch("/api/close-position", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ id, tag }),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error ?? `tag failed (${r.status})` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "tag failed" };
      }
    },
    [session]
  );

  // Persist a new channel display order: write sort_order = position for each id.
  // The desk reducer already reordered optimistically; this makes it durable.
  const reorderChannels = useCallback(
    async (orderedIds: string[]): Promise<{ ok: boolean; error?: string }> => {
      if (!session) return { ok: false, error: "sign in to reorder" };
      try {
        const sb = getSupabase();
        const results = await Promise.all(
          orderedIds.map((id, i) => sb.from("strategists").update({ sort_order: i }).eq("id", id))
        );
        const err = results.find((r) => r.error)?.error;
        return err ? { ok: false, error: err.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "reorder failed" };
      }
    },
    [session]
  );

  return { canWrite, persistConfig, persistFund, createChannel, duplicateChannel, renameChannel, setChannelAccent, setChannelStatus, setChannelExecutor, deleteChannel, closePosition, tagClose, reorderChannels };
}
