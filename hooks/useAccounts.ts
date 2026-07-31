"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { paperAccountLabel, paperAccountSlot } from "@/lib/channels/paperAccountLabel";
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
        else setAccounts(((data ?? []) as Account[])
          .map((account) => ({
            ...account,
            name: account.mode === "paper"
              ? paperAccountLabel(account.id, "PAPER ACCOUNT")
              : account.name,
          }))
          .sort((left, right) => {
            const leftSlot = paperAccountSlot(left.id);
            const rightSlot = paperAccountSlot(right.id);
            if (leftSlot && rightSlot) return leftSlot - rightSlot;
            if (leftSlot) return -1;
            if (rightSlot) return 1;
            return left.sort_order - right.sort_order;
          }));
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
