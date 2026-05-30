"use client";

import { useCallback } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import type { FundState, StrategistConfig } from "@/lib/desk/types";

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

  return { canWrite, persistConfig, persistFund };
}
