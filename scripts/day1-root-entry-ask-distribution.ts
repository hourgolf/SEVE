// SELECT-only July 15-17 entry-decision ask distribution for proposed roots.
// No strategy, roster, configuration, Supabase, or R2 write path is imported.
import { createClient } from "@supabase/supabase-js";

const ROOTS = [
  "pb-ride", "orb-ustop-ctl", "grind-v3", "momo-shape", "orb-qqq-trail", "breakout-alt-v3-iwm",
] as const;
const START_ISO = "2026-07-15T04:00:00.000Z";
const END_ISO = "2026-07-18T04:00:00.000Z";
const QUOTE_MAX_AGE_MS = 15_000;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) throw new Error("Supabase backend credentials missing");
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

interface PositionRow {
  id: string; runner_of: string | null;
  strategists: { slug?: string } | Array<{ slug?: string }> | null;
}
interface OutcomeRow { position_id: string; opportunity_id: string | null; }
interface ExecutionRow {
  position_id: string | null; opportunity_id: string | null; event_kind: string; action: string;
  event_at: string; ask: number | string | null; quote_age_ms: number | string | null;
}

async function page<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} SELECT failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

async function main(): Promise<void> {
const [positions, outcomes, executions] = await Promise.all([
  page<PositionRow>((from, to) => sb.from("positions")
    .select("id,runner_of,strategists(slug)").gte("opened_at", START_ISO).lt("opened_at", END_ISO)
    .order("opened_at").order("id").range(from, to).abortSignal(AbortSignal.timeout(15_000)), "positions"),
  page<OutcomeRow>((from, to) => sb.from("position_outcome_events")
    .select("position_id,opportunity_id").gte("event_at", START_ISO).lt("event_at", END_ISO)
    .order("event_at").order("id").range(from, to).abortSignal(AbortSignal.timeout(15_000)), "outcomes"),
  page<ExecutionRow>((from, to) => sb.from("execution_observations")
    .select("position_id,opportunity_id,event_kind,action,event_at,ask,quote_age_ms")
    .gte("event_at", START_ISO).lt("event_at", END_ISO).order("event_at").order("id").range(from, to)
    .abortSignal(AbortSignal.timeout(15_000)), "execution observations"),
]);

const opportunityByPosition = new Map<string, string>();
for (const row of outcomes) if (row.opportunity_id && !opportunityByPosition.has(row.position_id)) {
  opportunityByPosition.set(row.position_id, row.opportunity_id);
}
const byOpportunity = new Map<string, ExecutionRow[]>();
const byPosition = new Map<string, ExecutionRow[]>();
for (const row of executions) {
  if (row.opportunity_id) byOpportunity.set(row.opportunity_id, [...(byOpportunity.get(row.opportunity_id) ?? []), row]);
  if (row.position_id) byPosition.set(row.position_id, [...(byPosition.get(row.position_id) ?? []), row]);
}
const slug = (row: PositionRow): string => (Array.isArray(row.strategists) ? row.strategists[0]?.slug : row.strategists?.slug) ?? "";
const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return value != null && Number.isFinite(parsed) ? parsed : null;
};
const percentile = (values: readonly number[], p: number): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)];
};
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const result = ROOTS.map((channel) => {
  const rows = positions.filter((position) => !position.runner_of && slug(position) === channel);
  const asks: number[] = [];
  let censored = 0;
  for (const position of rows) {
    const opportunityId = opportunityByPosition.get(position.id);
    const observations = opportunityId ? byOpportunity.get(opportunityId) ?? [] : byPosition.get(position.id) ?? [];
    const entry = observations.filter((row) => row.event_kind === "decision" && ["enter", "add"].includes(row.action))
      .sort((a, b) => a.event_at.localeCompare(b.event_at))[0];
    const ask = numeric(entry?.ask);
    const age = numeric(entry?.quote_age_ms);
    if (!entry || ask == null || ask <= 0 || age == null || age < 0 || age > QUOTE_MAX_AGE_MS) censored++;
    else asks.push(ask);
  }
  return {
    channel,
    observedPositions: rows.length,
    validEntryAsks: asks.length,
    median: median(asks),
    p75: percentile(asks, 0.75),
    p90: percentile(asks, 0.90),
    p95: percentile(asks, 0.95),
    maximum: asks.length ? Math.max(...asks) : null,
    censored,
  };
});
console.log(JSON.stringify({
  window: { fromEt: "2026-07-15", throughEt: "2026-07-17" },
  basis: "fresh execution decision ask (quote age <= 15 seconds), one root position per entry",
  result,
  externalWrites: false,
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
