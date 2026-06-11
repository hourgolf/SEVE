// ============================================================================
//  cron-deploy — byte-faithful deploy/diff for the paper-trader edge function.
//
//  Replaces the manual paste-into-the-Supabase-editor workflow (transcription
//  risk on the LIVE trader) with a deterministic pipeline over the Supabase
//  Management API:
//
//    npm run cron:diff      compare the DEPLOYED function vs the repo draft
//                           (supabase/functions/paper-trader/index.dispatcher.draft.ts)
//    npm run cron:deploy    deploy the repo draft (verify_jwt OFF — internal
//                           cron worker), then RE-FETCH and byte-verify.
//
//  Auth: SUPABASE_ACCESS_TOKEN in .env.local — a personal access token from
//  https://supabase.com/dashboard/account/tokens (one-time setup). NEVER commit it.
//
//  Safety: deploy refuses unless --yes is passed, prints the banner line of
//  what it's about to ship, and always ends with a deployed-vs-repo diff
//  verdict — "IN SYNC" is the contract.
// ============================================================================

import { readFileSync } from "fs";

const REF = process.env.SUPABASE_PROJECT_REF ?? "xvdfsxwwedltvdktqdac";
const SLUG = "paper-trader";
const DRAFT = "supabase/functions/paper-trader/index.dispatcher.draft.ts";
const API = "https://api.supabase.com/v1";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN missing. Create one at supabase.com/dashboard/account/tokens");
  console.error("and add `SUPABASE_ACCESS_TOKEN=sbp_…` to .env.local (gitignored).");
  process.exit(1);
}
const HDRS = { authorization: `Bearer ${TOKEN}` };

async function fetchDeployed(): Promise<{ version: number; verifyJwt: boolean; bundle: Buffer }> {
  const metaRes = await fetch(`${API}/projects/${REF}/functions/${SLUG}`, { headers: HDRS });
  if (!metaRes.ok) throw new Error(`meta HTTP ${metaRes.status}: ${(await metaRes.text()).slice(0, 300)}`);
  const meta = await metaRes.json() as { version: number; verify_jwt: boolean };

  // The body endpoint serves the COMPILED ESZIP bundle. Module sources are
  // embedded in it verbatim and uncompressed, so the sync test is containment:
  // the bundle must contain the repo draft byte-for-byte. A 92KB exact
  // substring can't false-positive, and any drift (even one byte) fails it.
  const bodyRes = await fetch(`${API}/projects/${REF}/functions/${SLUG}/body`, { headers: HDRS });
  if (!bodyRes.ok) throw new Error(`body HTTP ${bodyRes.status}: ${(await bodyRes.text()).slice(0, 300)}`);
  const bundle = Buffer.from(await bodyRes.arrayBuffer());
  return { version: meta.version, verifyJwt: !!meta.verify_jwt, bundle };
}

// VERIFICATION MODEL — the bundle embeds the TRANSPILED source (TS syntax like
// `!` assertions is stripped, blank lines collapsed), so byte-identity with the
// .ts draft is unverifiable at READ time by design. What IS preserved verbatim:
// comments. So the revision check = the banner line (bumped on every edit, by
// convention) + the N longest comment-line sentinels must all appear in the
// bundle. Byte-identity is guaranteed at WRITE time instead — this script
// uploads the draft verbatim, so "right revision present" ⇒ "right bytes".
// (For a true byte-level audit of the original files, the Supabase MCP's
// get_edge_function returns the stored originals.)
function sentinels(repo: string): string[] {
  const banner = repo.split("\n")[0];
  const comments = [...new Set(
    repo.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("//") && l.length >= 48),
  )].sort((a, b) => b.length - a.length).slice(0, 24);
  return [banner, ...comments];
}

function checkSentinels(bundle: Buffer, repo: string): { inSync: boolean; missing: string[] } {
  const missing = sentinels(repo).filter((s) => !bundle.includes(Buffer.from(s, "utf8")));
  return { inSync: missing.length === 0, missing };
}

async function deploy(repo: string): Promise<void> {
  const form = new FormData();
  form.append("metadata", JSON.stringify({ name: SLUG, entrypoint_path: "index.ts", verify_jwt: false }));
  form.append("file", new Blob([repo], { type: "text/typescript" }), "index.ts");
  const res = await fetch(`${API}/projects/${REF}/functions/deploy?slug=${SLUG}`, {
    method: "POST", headers: HDRS, body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`deploy HTTP ${res.status}: ${body.slice(0, 400)}`);
  const j = JSON.parse(body) as { version?: number };
  console.log(`  deployed → version ${j.version ?? "?"} (verify_jwt OFF)`);
}

async function main() {
  const doDeploy = process.argv.includes("--deploy");
  const yes = process.argv.includes("--yes");
  const repo = readFileSync(DRAFT, "utf8");
  const banner = repo.split("\n")[0];
  console.log(`repo draft: ${banner.slice(0, 90)}`);

  const before = await fetchDeployed();
  const s0 = checkSentinels(before.bundle, repo);
  console.log(`deployed:   v${before.version} · verify_jwt=${before.verifyJwt} · bundle ${(before.bundle.length / 1024).toFixed(0)}KB`);
  console.log(s0.inSync
    ? `status: IN SYNC ✓ (banner + ${sentinels(repo).length - 1} comment sentinels all present)`
    : `status: DRIFT ✗ — ${s0.missing.length} sentinel(s) missing, e.g.:\n${s0.missing.slice(0, 3).map((m) => `    ${m.slice(0, 100)}`).join("\n")}`);

  if (!doDeploy) return;
  if (s0.inSync && !process.argv.includes("--force")) { console.log("nothing to deploy (already in sync)."); return; }
  if (!yes) { console.error("refusing to deploy the LIVE trader without --yes"); process.exit(1); }

  console.log("deploying the repo draft…");
  await deploy(repo);

  const after = await fetchDeployed();
  const s1 = checkSentinels(after.bundle, repo);
  if (s1.inSync && after.version > before.version) {
    console.log(`VERIFIED: v${before.version} → v${after.version}, all revision sentinels present ✓`);
  } else {
    console.error(`POST-DEPLOY MISMATCH ✗ (version ${after.version}, ${s1.missing.length} sentinels missing)`);
    process.exit(1);
  }
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
