import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pageAll } from "@/engine/pageAll";
import { requireDeskOperator } from "@/lib/auth/serverOperator";
import {
  deriveChannelManagerEvidenceBook,
  type ChannelManagerPositionRow,
  type ChannelManagerRunRow,
} from "@/lib/research/channelManagerEvidence";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COHORT_FROM = "2026-07-13";
const COHORT_ISO = "2026-07-13T04:00:00.000Z";
const READ_OPTIONS = { pageSize: 500, max: 10_000, attempts: 3, retryDelaysMs: [250, 750], timeoutMs: 10_000 } as const;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

/** Operator-authenticated, SELECT-only manager evidence. It intentionally
 * returns a derived compact book rather than raw position/account identities. */
export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) return json({ ok: false, error: "manager evidence is not configured" }, 503);
  try {
    const sb = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const [managerRuns, positions] = await Promise.all([
      pageAll<ChannelManagerRunRow>((from) => sb.from("manager_shadow_runs")
        .select([
          "id", "position_id", "channel_slug", "manager_id", "manager_policy_version",
          "shadow_book_version", "configuration_epoch_id", "status", "evidence_state",
          "entry_at", "entry_price", "original_qty", "economic_mode", "peak_return_pct",
          "terminal_at", "terminal_return_pct", "terminal_pnl", "censored_at", "censor_code",
        ].join(","))
        .gte("entry_at", COHORT_ISO)
        .order("entry_at", { ascending: true })
        .order("id", { ascending: true }), READ_OPTIONS),
      pageAll<ChannelManagerPositionRow>((from) => sb.from("positions")
        .select("id,runner_of,realized_pnl")
        .order("id", { ascending: true }), READ_OPTIONS),
    ]);
    const book = deriveChannelManagerEvidenceBook({
      managerRuns,
      positions,
      generatedAt: new Date().toISOString(),
      cohortFrom: COHORT_FROM,
    });
    return json({ ok: true, book });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "manager evidence read failed" }, 502);
  }
}
