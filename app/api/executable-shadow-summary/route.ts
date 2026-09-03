import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLUG = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

interface ReceiptRow {
  session_date_et: string;
  disposition: string;
  result_per_contract_usd: number | string | null;
  manager_id: string;
  contract_selection_id: string;
}
export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) return json({ ok: false, error: "executable-shadow evidence is not configured" }, 503);
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!SLUG.test(slug)) return json({ ok: false, error: "invalid channel slug" }, 400);
  try {
    const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const [registration, receiptRead] = await Promise.all([
      sb.from("research_channel_registration_current").select("state,candidate_spec,registered_at")
        .eq("channel_slug", slug).maybeSingle(),
      sb.from("executable_shadow_receipts")
        .select("session_date_et,disposition,result_per_contract_usd,manager_id,contract_selection_id")
        .eq("channel_slug", slug).eq("mode", "channel_isolated")
        .order("session_date_et", { ascending: false }).limit(2_000),
    ]);
    if (registration.error) throw new Error(registration.error.message);
    if (receiptRead.error) throw new Error(receiptRead.error.message);
    if (!registration.data?.candidate_spec) return json({ ok: true, summary: null });
    const candidate = registration.data.candidate_spec as Record<string, unknown>;
    const exitParameters = candidate.exitParameters as Record<string, unknown> | undefined;
    const managerControls = Array.isArray(exitParameters?.executableShadowManagerControls)
      ? exitParameters.executableShadowManagerControls.map(String) : [];
    const primaryManager = managerControls[0] ?? String(candidate.managerProfileId ?? "");
    const rows = (receiptRead.data ?? []) as ReceiptRow[];
    if (!rows.length && slug !== "pm-momentum-follow" && slug !== "fomc-event-follow") {
      return json({ ok: true, summary: null });
    }
    const byArm = new Map<string, { manager: string; wrapper: string; scored: number; result: number; sessions: Set<string> }>();
    for (const row of rows) {
      const key = `${row.manager_id}\0${row.contract_selection_id}`;
      const arm = byArm.get(key) ?? { manager: row.manager_id, wrapper: row.contract_selection_id, scored: 0, result: 0, sessions: new Set<string>() };
      arm.sessions.add(row.session_date_et);
      const result = Number(row.result_per_contract_usd);
      if (row.result_per_contract_usd != null && Number.isFinite(result)) { arm.scored += 1; arm.result += result; }
      byArm.set(key, arm);
    }
    const arms = [...byArm.values()].map((arm) => ({
      manager: arm.manager,
      wrapper: arm.wrapper,
      sessions: arm.sessions.size,
      scored: arm.scored,
      averagePerContractUsd: arm.scored ? Math.round((arm.result / arm.scored) * 100) / 100 : null,
    })).sort((left, right) => Number(right.manager === primaryManager) - Number(left.manager === primaryManager)
      || right.sessions - left.sessions || left.manager.localeCompare(right.manager));
    const sessions = new Set(rows.map((row) => row.session_date_et));
    return json({
      ok: true,
      summary: {
        slug,
        posture: "OBSERVING",
        evidenceLayer: "EXECUTABLE SHADOW",
        sessions: sessions.size,
        opportunities: rows.length,
        scored: rows.filter((row) => row.result_per_contract_usd != null).length,
        censored: rows.filter((row) => row.disposition.includes("censored")).length,
        blocked: rows.filter((row) => row.disposition.startsWith("blocked_")).length,
        primaryManager,
        arms: arms.slice(0, 4),
        nextGate: slug === "fomc-event-follow" ? "10 event sessions" : "10 recent independent sessions",
        registeredAt: registration.data.registered_at,
      },
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "executable-shadow summary failed" }, 502);
  }
}
