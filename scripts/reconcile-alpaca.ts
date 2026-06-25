// reconcile-alpaca — GROUND-TRUTH the desk's books against the broker, then optionally CORRECT them.
// The shared-OCC booking bugs (the $0 phantoms, the multi-channel over-books) mean historical
// realized_pnl can't be trusted until tied out to what ACTUALLY traded. This reconstructs each OCC's
// TRUE realized from the real Alpaca fills across ALL cockpit accounts (Σ sell − Σ buy, fully-closed),
// diffs vs the desk's booked realized_pnl, and — with --fix — re-books each row to the broker truth via
// the row-primary formula (broker avg-sell − row entry)×row.qty, the SAME math now live in the worker.
//
//   npm run reconcile-alpaca                 # read-only diagnosis (all accounts with keys)
//   npm run reconcile-alpaca -- --fix        # + dry-run preview of the per-row correction
//   npm run reconcile-alpaca -- --fix --write  # APPLY the correction (service role; idempotent)
//
// An account whose ALPACA_KEY_<ref> isn't in .env.local is SKIPPED (its OCCs flagged, not corrected).

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const PAPER = "https://paper-api.alpaca.markets";
const FIX = process.argv.includes("--fix");
const WRITE = process.argv.includes("--write");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const sbW = WRITE && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString();
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Order { id: string; symbol: string; side: "buy" | "sell"; status: string; filled_qty: string; filled_avg_price: string | null; submitted_at: string; }
interface Leg { bq: number; bc: number; sq: number; sp: number; accts: Set<string>; }

async function accountFills(hdr: Record<string, string>): Promise<Order[]> {
  const out = new Map<string, Order>();
  let after = "2026-05-31T00:00:00Z";
  for (let page = 0; page < 80; page++) {
    const r = await fetch(`${PAPER}/v2/orders?status=all&limit=500&direction=asc&nested=false&after=${after}`, { headers: hdr });
    if (!r.ok) { console.error(`  alpaca orders ${r.status}: ${(await r.text()).slice(0, 160)}`); break; }
    const batch = (await r.json()) as Order[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    let added = 0;
    for (const o of batch) if (!out.has(o.id)) { out.set(o.id, o); added++; }
    after = batch[batch.length - 1].submitted_at;
    if (batch.length < 500 || added === 0) break;
  }
  return [...out.values()];
}

async function main() {
  // ---- which accounts to reconcile (cred_ref → keys) ----
  const { data: accts } = await sb.from("accounts").select("name,cred_ref");
  const targets = [{ name: "paper-main (default)", ref: "" }, ...(accts ?? []).filter((a) => a.cred_ref).map((a) => ({ name: a.name as string, ref: String(a.cred_ref) }))];
  // de-dup (paper-main may also appear with null cred_ref)
  const seen = new Set<string>();
  const accountList = targets.filter((t) => !seen.has(t.ref) && (seen.add(t.ref), true));

  // ---- broker truth: merge fills across every reachable account, by OCC ----
  const byOcc = new Map<string, Leg>();
  const equities: { name: string; equity: number; reachable: boolean }[] = [];
  for (const a of accountList) {
    const AK = a.ref ? process.env[`ALPACA_KEY_${a.ref}`] : process.env.ALPACA_KEY;
    const AS = a.ref ? process.env[`ALPACA_SECRET_${a.ref}`] : process.env.ALPACA_SECRET;
    if (!AK || !AS) { equities.push({ name: a.name, equity: NaN, reachable: false }); console.log(`  ⚠ ${a.name}: no ALPACA_KEY_${a.ref || "(default)"} in .env.local — SKIPPED`); continue; }
    const hdr = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };
    const acct = await fetch(`${PAPER}/v2/account`, { headers: hdr }).then((r) => r.json());
    equities.push({ name: a.name, equity: Number(acct.equity), reachable: true });
    const fills = (await accountFills(hdr)).filter((o) => o.status === "filled" && Number(o.filled_qty) > 0 && Number(o.filled_avg_price) > 0);
    for (const o of fills) {
      const q = Number(o.filled_qty), px = Number(o.filled_avg_price);
      const e = byOcc.get(o.symbol) ?? { bq: 0, bc: 0, sq: 0, sp: 0, accts: new Set() };
      if (o.side === "buy") { e.bq += q; e.bc += q * px; } else { e.sq += q; e.sp += q * px; }
      e.accts.add(a.name);
      byOcc.set(o.symbol, e);
    }
  }
  // per-OCC broker realized + avg sell (the row-primary exit for the correction)
  const truth = new Map<string, { realized: number; avgSell: number; closed: boolean }>();
  for (const [occ, e] of byOcc) {
    const closed = Math.abs(e.bq - e.sq) < 0.5 && e.sq > 0;
    truth.set(occ, { realized: closed ? (e.sp - e.bc) * 100 : 0, avgSell: e.sq > 0 ? e.sp / e.sq : 0, closed });
  }

  // ---- desk rows (per OCC) ----
  const { data: rows } = await sb.from("positions").select("id,occ_symbol,realized_pnl,avg_entry_price,qty,strategist_id").eq("status", "closed").gte("opened_at", "2026-06-01");
  const deskByOcc = new Map<string, number>();
  for (const r of rows ?? []) deskByOcc.set(r.occ_symbol, (deskByOcc.get(r.occ_symbol) ?? 0) + Number(r.realized_pnl ?? 0));

  // ---- diagnose ----
  const diffs: { occ: string; broker: number; desk: number; delta: number }[] = [];
  let brokerTot = 0, deskTot = 0, deltaTot = 0;
  const onlyDesk: string[] = [];
  for (const occ of new Set([...truth.keys(), ...deskByOcc.keys()])) {
    const t = truth.get(occ), d = deskByOcc.get(occ);
    if (t && !t.closed) continue;
    if (!t && d != null) { onlyDesk.push(occ); continue; }
    if (t && d != null) { brokerTot += t.realized; deskTot += d; deltaTot += d - t.realized; if (Math.abs(d - t.realized) >= 1) diffs.push({ occ, broker: t.realized, desk: d, delta: d - t.realized }); }
  }
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const reachable = equities.filter((e) => e.reachable);
  console.log(`\n  RECONCILE-ALPACA · ${reachable.length}/${equities.length} accounts reached · ${byOcc.size} broker OCCs since 06-01`);
  for (const e of equities) console.log(`    ${e.reachable ? "✓" : "—"} ${e.name.padEnd(22)} ${e.reachable ? "equity " + usd(e.equity) : "(skipped — add keys)"}`);
  console.log(`\n  Σ realized — broker fills:  ${usd(brokerTot)}`);
  console.log(`  Σ realized — desk booked:   ${usd(deskTot)}   (matched OCCs)`);
  console.log(`  ⇒ BOOKING ERROR (desk − broker): ${usd(deltaTot)}   ${Math.abs(deltaTot) < 200 ? "✓ books tie out" : "⚠ books DIVERGE"}  (+ over-reported · − under, the $0 phantoms)`);
  console.log(`\n  TOP PER-OCC DIVERGENCES:`);
  for (const d of diffs.slice(0, 12)) console.log(`    ${d.occ}  broker ${usd(d.broker).padStart(9)}  desk ${usd(d.desk).padStart(9)}  Δ ${usd(d.delta).padStart(9)}`);
  if (onlyDesk.length) console.log(`\n  ⚠ ${onlyDesk.length} OCC(s) booked by the desk but NOT in any reached broker account — add the missing account keys (not corrected).`);

  // ---- correct (--fix) ----
  if (!FIX) { console.log(`\n  (read-only. add --fix for the per-row correction preview, --fix --write to apply.)\n`); return; }
  // DISTRIBUTE each OCC's TRUE broker realized across its desk rows by qty share → the books tie out to
  // the broker EXACTLY per OCC. Robust to the corrupted per-row entry/qty the (avg_sell−entry)×qty
  // formula can't reconcile (it left ~$3k off). Fair split on a shared lot (same strike, same-time
  // entries). The last row absorbs the rounding remainder so the OCC sums exactly.
  type Row = NonNullable<typeof rows>[number];
  const corrections: { id: string; occ: string; old: number; neu: number }[] = [];
  const occRows = new Map<string, Row[]>();
  for (const r of rows ?? []) { const t = truth.get(r.occ_symbol); if (t?.closed) { const a = occRows.get(r.occ_symbol) ?? []; a.push(r); occRows.set(r.occ_symbol, a); } }
  for (const [occ, rs] of occRows) {
    const t = truth.get(occ)!;
    const totQty = rs.reduce((s, r) => s + Math.abs(Number(r.qty)), 0);
    if (totQty <= 0) continue;
    let assigned = 0;
    rs.forEach((r, i) => {
      const neu = i === rs.length - 1 ? r2(t.realized - assigned) : r2((t.realized * Math.abs(Number(r.qty))) / totQty);
      assigned += neu;
      if (Math.abs(neu - Number(r.realized_pnl ?? 0)) >= 0.5) corrections.push({ id: r.id, occ, old: Number(r.realized_pnl ?? 0), neu });
    });
  }
  const oldSum = corrections.reduce((s, c) => s + c.old, 0), newSum = corrections.reduce((s, c) => s + c.neu, 0);
  console.log(`\n  CORRECTION (row-primary re-book to broker avg-sell) · ${corrections.length} rows change`);
  console.log(`    Σ booked (old): ${usd(oldSum)}  →  Σ corrected: ${usd(newSum)}   (net ${usd(newSum - oldSum)})`);
  for (const c of corrections.slice(0, 10)) console.log(`      ${c.occ}  ${usd(c.old).padStart(9)} → ${usd(c.neu).padStart(9)}`);

  if (!WRITE) { console.log(`\n  DRY-RUN. Re-run with --fix --write to apply (service role).\n`); return; }
  if (!sbW) { console.error(`\n  --write needs SUPABASE_SERVICE_ROLE_KEY in .env.local.\n`); process.exit(1); }
  // audit trail / reversibility: dump every {id, old, new} BEFORE applying (gitignored data/).
  writeFileSync("data/reconcile-applied.json", JSON.stringify({ applied: new Date().toISOString(), brokerTot: r2(brokerTot), corrections }, null, 1));
  console.log(`  audit → data/reconcile-applied.json (${corrections.length} rows, restorable from the 'old' field)`);
  let ok = 0;
  for (const c of corrections) { const { error } = await sbW.from("positions").update({ realized_pnl: c.neu }).eq("id", c.id).eq("status", "closed"); if (!error) ok++; else console.error(`    ${c.occ}: ${error.message}`); }
  console.log(`\n  ✓ APPLIED ${ok}/${corrections.length} corrections to the books (matched OCCs re-booked to broker truth).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
