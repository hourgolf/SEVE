"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Account } from "@/lib/desk/types";

// Reads the `accounts` table (multi-account cockpit, 36_accounts_foundation). Anon read;
// one-shot on mount (accounts change rarely). Returns the active accounts sorted, plus a
// loading flag. Degrades to an empty list if the table doesn't exist yet (pre-migration),
// so the desk renders single-account exactly as before.
export function useAccounts(): { accounts: Account[]; loading: boolean } {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await getSupabase()
          .from("accounts")
          .select("id,name,mode,is_active,accent,sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });
        if (!alive) return;
        if (error) setAccounts([]);
        else setAccounts((data ?? []) as Account[]);
      } catch {
        if (alive) setAccounts([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { accounts, loading };
}
