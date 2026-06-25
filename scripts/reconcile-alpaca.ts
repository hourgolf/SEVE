// reconcile-alpaca — GROUND-TRUTH the desk's books against the broker. The shared-OCC booking bugs
// (the $0 phantoms, the over-books) mean the historical realized_pnl can't be trusted until it's tied
// out to what ACTUALLY traded. This reconstructs each OCC's TRUE realized from the default Alpaca
// account's real fills (Σ sell − Σ buy, for fully-closed OCCs) and diffs it against the desk's booked
// realized_pnl per OCC. The divergence IS the booking error. Read-only (GET account + orders).
//
//   npm run reconcile-alpaca
//
// Scope: the DEFAULT account (ALPACA_KEY) = every channel pre-06-24 + the 06-24 Bleeders bucket (the
// bulk). Cockpit Core/Resurrected (06-24 only) need ALPACA_KEY_2/3 in .env.local — flagged, not failed.

import { createClient } from "@supabase/supabase-js";

const PAPER = "https://paper-api.alpaca.markets";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const AK = process.env.ALPACA_KEY!, AS = process.env.ALPACA_SECRET!;
const hdr = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS } as Record<string, string>;
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString();

interface Order { id: string; symbol: string; side: "buy" | "sell"; status: string; filled_qty: string; filled_avg_price: string | null; submitted_at: string; }

async function allOrders(): Promise<Order[]> {
  const out = new Map<string, Order>();
  let after = "2026-05-31T00:00:00Z";
  for (let page = 0; page < 80; page++) {
    const r = await fetch(`${PAPER}/v2/orders?status=all&limit=500&direction=asc&nested=false&after=${after}`, { headers: hdr });
    if (!r.ok) { console.error(`alpaca orders ${r.status}: ${(await r.text()).slice(0, 200)}`); break; }
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
  // ---- broker truth: equity + per-OCC realized from real fills ----
  const acct = await fetch(`${PAPER}/v2/account`, { headers: hdr }).then((r) => r.json());
  const orders = await allOrders();
  const filled = orders.filter((o) => o.status === "filled" && Number(o.filled_qty) > 0 && Number(o.filled_avg_price) > 0);

  type Leg = { bq: number; bc: number; sq: number; sp: number };
  const byOcc = new Map<string, Leg>();
  for (const o of filled) {
    const q = Number(o.filled_qty), px = Number(o.filled_avg_price);
    const e = byOcc.get(o.symbol) ?? { bq: 0, bc: 0, sq: 0, sp: 0 };
    if (o.side === "buy") { e.bq += q; e.bc += q * px; } else { e.sq += q; e.sp += q * px; }
    byOcc.set(o.symbol, e);
  }
  const brokerRealized = new Map<string, { realized: number; closed: boolean }>();
  for (const [occ, e] of byOcc) {
    const closed = Math.abs(e.bq - e.sq) < 0.5; // fully round-tripped
    const realized = closed && e.sq > 0 ? (e.sp - e.bc) * 100 : 0;
    brokerRealized.set(occ, { realized, closed });
  }

  // ---- desk books: realized_pnl per OCC (default-account channels only) ----
  // Pre-06-24 every channel hit the default account; on 06-24 only the Bleeders (cred_ref null) did.
  // Match by OCC: an OCC the BROKER (default) traded is by definition a default-account OCC, so summing
  // ALL desk rows on that OCC is correct for pre-cockpit days; 06-24 split OCCs are flagged separately.
  const { data: rows } = await sb.from("positions").select("occ_symbol,realized_pnl,strategist_id").eq("status", "closed").gte("opened_at", "2026-06-01");
  const deskByOcc = new Map<string, number>();
  for (const r of rows ?? []) deskByOcc.set(r.occ_symbol, (deskByOcc.get(r.occ_symbol) ?? 0) + Number(r.realized_pnl ?? 0));

  // ---- compare ----
  const onlyDesk: { occ: string; desk: number }[] = []; // desk booked but broker(default) never traded → cockpit/other acct
  const onlyBroker: { occ: string; broker: number }[] = []; // broker traded but desk has no row → coverage gap
  const diffs: { occ: string; broker: number; desk: number; delta: number }[] = [];
  let brokerTot = 0, deskTot = 0, deltaTot = 0;

  const allOccs = new Set([...brokerRealized.keys(), ...deskByOcc.keys()]);
  for (const occ of allOccs) {
    const b = brokerRealized.get(occ), d = deskByOcc.get(occ);
    if (b && !b.closed) continue; // not fully closed on the broker → skip
    if (b && d == null) { onlyBroker.push({ occ, broker: b.realized }); continue; }
    if (!b && d != null) { onlyDesk.push({ occ, desk: d }); continue; }
    if (b && d != null) {
      const delta = d - b.realized; // desk-booked minus broker-truth: + = desk OVER-booked, − = UNDER (the $0 phantoms)
      brokerTot += b.realized; deskTot += d; deltaTot += delta;
      if (Math.abs(delta) >= 1) diffs.push({ occ, broker: b.realized, desk: d, delta });
    }
  }
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log(`\n  RECONCILE-ALPACA · DEFAULT account (paper-main + 06-24 Bleeders) · ${filled.length} filled orders / ${byOcc.size} OCCs since 06-01`);
  console.log(`  ─────────────────────────────────────────────────────────────────────────────`);
  console.log(`  BROKER (truth)   equity ${usd(Number(acct.equity))} · cash ${usd(Number(acct.cash))} · last_equity ${usd(Number(acct.last_equity))}`);
  console.log(`  Σ realized — broker fills:  ${usd(brokerTot)}`);
  console.log(`  Σ realized — desk booked:   ${usd(deskTot)}   (matched OCCs)`);
  console.log(`  ⇒ BOOKING ERROR (desk − broker): ${usd(deltaTot)}   ${Math.abs(deltaTot) < 200 ? "✓ books tie out" : "⚠ books DIVERGE"}`);
  console.log(`     (+ = desk over-reported · − = desk under-reported, the $0 phantoms)\n`);

  console.log(`  TOP PER-OCC DIVERGENCES (desk − broker):`);
  for (const d of diffs.slice(0, 14)) console.log(`    ${d.occ}  broker ${usd(d.broker).padStart(9)}  desk ${usd(d.desk).padStart(9)}  Δ ${usd(d.delta).padStart(9)}`);

  const odTot = onlyDesk.reduce((s, x) => s + x.desk, 0);
  const obTot = onlyBroker.reduce((s, x) => s + x.broker, 0);
  console.log(`\n  ONLY-DESK (booked, but NOT on the default account → cockpit Core/Resurrected, needs ALPACA_KEY_2/3): ${onlyDesk.length} OCCs, ${usd(odTot)} booked`);
  console.log(`  ONLY-BROKER (traded on default, NO desk row → coverage gap): ${onlyBroker.length} OCCs, ${usd(obTot)} broker realized`);
  if (onlyBroker.length) for (const x of onlyBroker.slice(0, 6)) console.log(`    ${x.occ}  broker ${usd(x.broker)}`);
  console.log(`\n  READ: the BOOKING ERROR is how far the historical per-OCC books are off the broker. Big − = the $0`);
  console.log(`  phantoms (movers booked $0). Correcting = re-book each matched OCC's desk rows to the broker truth.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
