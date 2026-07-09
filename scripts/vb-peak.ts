// ---------------------------------------------------------------------------
//  vb-peak — read-only: reconstruct MFE (peak) + giveback for recent VB virtual
//  trades from option_quotes, using the SAME mid basis + occ_symbol keying as
//  scripts/gate-shadow.ts reconstruct(). Applies the avg-peak harvest lens
//  (memory/avg-peak-harvest-lens) to the virtual bench, which virtual_trades does
//  NOT yet store a peak for. Bounded to the last N days (option_quotes prune 7d).
//  NO writes — pure analysis.
//
//    tsx --env-file=.env.local scripts/vb-peak.ts [days=7]
// ---------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
);

const DAYS = Number(process.argv[2] || 7);
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

type VT = {
  slug: string; occ: string; signal_at: string; exit_at: string | null;
  entry_px: number; exit_px: number | null; pnl_per_contract: number | null;
};

// MFE + giveback for one virtual trade: max mid over [signal_at, exit_at] vs entry.
async function peakOf(t: VT): Promise<{ mfePct: number; giveback: number | null } | null> {
  const entry = Number(t.entry_px);
  if (!(entry > 0) || !t.occ) return null;
  const end = t.exit_at ?? `${t.signal_at.slice(0, 10)}T23:59:59Z`;
  const { data: qs } = await sb
    .from("option_quotes").select("mid")
    .eq("occ_symbol", t.occ)
    .gte("captured_at", t.signal_at).lte("captured_at", end)
    .limit(5000);
  const mids = ((qs ?? []) as any[]).map((q) => Number(q.mid)).filter((m) => m > 0);
  if (!mids.length) return null;
  const peak = Math.max(...mids);
  const mfePct = (peak - entry) / entry * 100;
  const realizedPct = t.exit_px != null ? (Number(t.exit_px) - entry) / entry * 100 : 0;
  const giveback = mfePct > 0.01 ? (mfePct - realizedPct) / mfePct * 100 : null;
  return { mfePct, giveback };
}

async function main() {
  const { data: vts, error } = await sb
    .from("virtual_trades")
    .select("slug,occ,signal_at,exit_at,entry_px,exit_px,pnl_per_contract")
    .like("slug", "vb-%")
    .gte("signal_at", since)
    .limit(5000);
  if (error) { console.error(error); process.exit(1); }
  const rows = (vts ?? []) as VT[];
  console.error(`vb virtual trades in last ${DAYS}d: ${rows.length} — reconstructing peaks from option_quotes...`);

  const peaks = new Map<string, { mfe: number; give: number | null }[]>();
  const BATCH = 16;
  let done = 0, withQuotes = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await Promise.all(chunk.map((t) => peakOf(t).then((p) => ({ slug: t.slug, p }))));
    for (const r of res) {
      if (!r.p) continue;
      withQuotes++;
      const arr = peaks.get(r.slug) ?? [];
      arr.push({ mfe: r.p.mfePct, give: r.p.giveback });
      peaks.set(r.slug, arr);
    }
    done += chunk.length;
    if (done % 96 === 0) console.error(`  ...${done}/${rows.length}`);
  }
  console.error(`reconstructed ${withQuotes} trades with live quotes (rest pruned/older than 7d)\n`);

  const pnlBySlug = new Map<string, number[]>();
  for (const t of rows) {
    const a = pnlBySlug.get(t.slug) ?? [];
    if (t.pnl_per_contract != null) a.push(Number(t.pnl_per_contract));
    pnlBySlug.set(t.slug, a);
  }

  const out = [...peaks.entries()].map(([slug, arr]) => {
    const mfes = arr.map((x) => x.mfe);
    const gives = arr.map((x) => x.give).filter((g): g is number => g != null);
    const pnls = pnlBySlug.get(slug) ?? [];
    return {
      slug, n: arr.length,
      avgPeak: mfes.reduce((s, x) => s + x, 0) / mfes.length,
      maxPeak: Math.max(...mfes),
      avgGive: gives.length ? gives.reduce((s, x) => s + x, 0) / gives.length : null,
      avgPnl: pnls.length ? pnls.reduce((s, x) => s + x, 0) / pnls.length : null,
    };
  }).sort((a, b) => b.avgPeak - a.avgPeak);

  const f = (x: number | null, d = 1) => x == null ? "-" : (Math.round(x * 10 ** d) / 10 ** d).toString();
  console.log(`VB BENCH — avg PEAK (MFE) reconstructed, last ${DAYS}d · mid-basis · read-only\n`);
  console.log("channel".padEnd(30) + "avgPeak%".padStart(9) + "maxPeak%".padStart(10) + "giveback%".padStart(11) + "n".padStart(5) + "avgPnl/ct".padStart(11));
  for (const c of out) {
    console.log(
      c.slug.padEnd(30) + f(c.avgPeak).padStart(9) + f(c.maxPeak).padStart(10) +
      f(c.avgGive, 0).padStart(11) + String(c.n).padStart(5) + f(c.avgPnl, 0).padStart(11),
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
