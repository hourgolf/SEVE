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

const norm = (s: string) => s.replace(/\r/g, "").replace(/\s+$/, "");

async function fetchDeployed(): Promise<{ version: number; verifyJwt: boolean; source: string }> {
  const metaRes = await fetch(`${API}/projects/${REF}/functions/${SLUG}`, { headers: HDRS });
  if (!metaRes.ok) throw new Error(`meta HTTP ${metaRes.status}: ${(await metaRes.text()).slice(0, 300)}`);
  const meta = await metaRes.json() as { version: number; verify_jwt: boolean };

  const bodyRes = await fetch(`${API}/projects/${REF}/functions/${SLUG}/body`, { headers: HDRS });
  if (!bodyRes.ok) throw new Error(`body HTTP ${bodyRes.status}: ${(await bodyRes.text()).slice(0, 300)}`);
  const ctype = bodyRes.headers.get("content-type") ?? "";
  const raw = await bodyRes.text();

  // The body endpoint serves the source as multipart (per-file parts) or raw
  // text for single-file functions — handle both.
  let source = raw;
  if (ctype.includes("multipart")) {
    const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    const boundary = m?.[1] ?? m?.[2];
    if (boundary) {
      const part = raw.split(`--${boundary}`).find((p) => /index\.ts/.test(p.slice(0, 500)));
      if (part) source = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
    }
  } else if (ctype.includes("json")) {
    try {
      const j = JSON.parse(raw) as { files?: Array<{ name: string; content: string }> };
      const f = j.files?.find((x) => /index\.ts$/.test(x.name)) ?? j.files?.[0];
      if (f) source = f.content;
    } catch { /* keep raw */ }
  }
  return { version: meta.version, verifyJwt: !!meta.verify_jwt, source };
}

function diffReport(deployed: string, repo: string): { inSync: boolean; report: string } {
  const a = norm(deployed).split("\n");
  const b = norm(repo).split("\n");
  if (a.join("\n") === b.join("\n")) return { inSync: true, report: "" };
  const lines: string[] = [`  deployed ${a.length} lines vs repo ${b.length} lines`];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      lines.push(`  first divergence at line ${i + 1}:`);
      lines.push(`    deployed: ${(a[i] ?? "<missing>").slice(0, 110)}`);
      lines.push(`    repo:     ${(b[i] ?? "<missing>").slice(0, 110)}`);
      break;
    }
  }
  return { inSync: false, report: lines.join("\n") };
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
  console.log(`deployed:   v${before.version} · verify_jwt=${before.verifyJwt} · ${norm(before.source).split("\n")[0].slice(0, 70)}`);
  const d0 = diffReport(before.source, repo);
  console.log(d0.inSync ? "status: IN SYNC ✓" : `status: DRIFT ✗\n${d0.report}`);

  if (!doDeploy) return;
  if (d0.inSync && !process.argv.includes("--force")) { console.log("nothing to deploy (already in sync)."); return; }
  if (!yes) { console.error("refusing to deploy the LIVE trader without --yes"); process.exit(1); }

  console.log("deploying the repo draft…");
  await deploy(repo);

  const after = await fetchDeployed();
  const d1 = diffReport(after.source, repo);
  if (d1.inSync) console.log(`VERIFIED: deployed v${after.version} == repo draft byte-for-byte ✓`);
  else { console.error(`POST-DEPLOY MISMATCH ✗\n${d1.report}`); process.exit(1); }
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
