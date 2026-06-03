"use client";

import { useCallback } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelStatus, FundState, PmColor, StrategistConfig } from "@/lib/desk/types";
import type { StrategySpec } from "@/lib/desk/strategySpec";

// A new compiled channel to persist (strategists row + its strategist_config).
export interface NewChannelInput {
  slug: string;
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

  return { canWrite, persistConfig, persistFund, createChannel, renameChannel, setChannelAccent, deleteChannel, closePosition };
}
