// import-ledgers-to-cloud — one-time (idempotent) migration of the local JSON ledgers
// (data/override-ledger.json + data/foulout-ledger.json) into the Supabase tables, so the
// accumulated "did the human beat the ride" tally carries over now that the ledger moved
// cloud-durable (53_forensics_ledgers.sql). Safe to re-run (upsert keyed by id / date|slug).
//   npm run import-ledgers     (needs SUPABASE_SERVICE_ROLE_KEY + URL in .env.local)
import { readFileSync, existsSync } from "fs";
import { upsertLedger, upsertFoulout, LEDGER_PATH, FOULOUT_PATH, type LedgerEntry, type FouloutEntry } from "./override-ledger";

async function main() {
  const led = existsSync(LEDGER_PATH) ? (JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Record<string, LedgerEntry>) : {};
  const foul = existsSync(FOULOUT_PATH) ? (JSON.parse(readFileSync(FOULOUT_PATH, "utf8")) as Record<string, FouloutEntry>) : {};
  const r1 = await upsertLedger(Object.values(led));
  const r2 = await upsertFoulout(Object.values(foul));
  console.log(`imported → override_ledger: +${r1.added} new / ${r1.updated} refreshed (${Object.keys(led).length} local) · foulout_ledger: +${r2.added} / ${r2.updated} (${Object.keys(foul).length} local)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
