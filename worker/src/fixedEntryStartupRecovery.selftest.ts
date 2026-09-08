import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";

// Launch the actual index, not a copied startup function. An empty nested cwd
// keeps config's dotenv probes away from developer credentials. Every network
// transport is either rejected or an in-memory response at one fake origin.
const directory = mkdtempSync(join(tmpdir(), "seve-astra-audit-startup-"));
const cwd = join(directory, "cwd"); mkdirSync(cwd);
const original = join(directory, "original.json");
writeFileSync(original, JSON.stringify([...fixedCoverageHarness().db.values()]));
const preload = join(directory, "transport.mjs");
writeFileSync(preload, `
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';import {appendFileSync,readFileSync} from 'node:fs';
const reject=()=>{throw new Error('external network prohibited by startup fixture');};
http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=reject;syncBuiltinESMExports();
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url??String(input));
 const method=String(init?.method??input?.method??'GET').toUpperCase();
 appendFileSync(process.env.FIXTURE_RECORD,JSON.stringify({host:url.hostname,path:url.pathname,method,body:init?.body??null})+'\\n');
 if(url.origin!=='https://fixed-startup.invalid')throw new Error('unexpected external origin');
 if(url.pathname.endsWith('/execution_observations')&&process.env.FIXTURE_HISTORY==='unknown')
  return new Response(JSON.stringify({message:'fixture inventory outage'}),{status:503,headers:{'content-type':'application/json'}});
 if(method==='GET'&&url.pathname.endsWith('/execution_observations')&&process.env.FIXTURE_HISTORY==='original')
  return new Response(readFileSync(process.env.FIXTURE_ORIGINAL,'utf8'),{status:200,headers:{'content-type':'application/json','content-range':'0-0/1'}});
 return new Response('[]',{status:200,headers:{'content-type':'application/json','content-range':'*/0'}});
};
`);

async function run(history: "empty" | "unknown" | "original") {
  const record = join(directory, history + ".jsonl");
  const child = spawn(process.execPath, ["--import", preload, "--import",
    fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url)),
    fileURLToPath(new URL("./index.ts", import.meta.url))], {
    cwd, env: {
      PATH: process.env.PATH ?? "",
      SUPABASE_URL: "https://fixed-startup.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture_only_not_a_real_credential_123456789",
      ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture", ALPACA_KEY_2: "fixture", ALPACA_SECRET_2: "fixture",
      DRY_RUN: "false", LIVE_TRADING: "true",
      DAY1_RELEASE_ENABLED: "true", RC54_RELEASE_ENABLED: "true",
      FIXTURE_HISTORY: history, FIXTURE_RECORD: record, FIXTURE_ORIGINAL: original,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", stopping = false;
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (history !== "empty" && output.includes("FIXED RECOVERY ONLY") && !stopping) {
      stopping = true; setTimeout(() => child.kill("SIGTERM"), 500);
    }
  };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);
  assert.equal(result.signal, null, output);
  assert.match(output, /worker_startup_validation_refused/, output);
  assert.equal(result.code, history !== "empty" ? 0 : 1, output);
  assert.equal(output.includes("FIXED RECOVERY ONLY"), history !== "empty", output);
  const calls = readFileSync(record, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(calls.filter(row => row.path.endsWith("/execution_observations")).length >= 2,
    "actual pre-validation clock and startup custody discovery both ran");
  assert.ok(calls.every(row => row.host === "fixed-startup.invalid"));
  assert.ok(calls.every(row => !row.path.includes("/orders")), "startup never sought broker order authority");
  if (history !== "empty") assert.ok(calls.some(row => String(row.body).includes("fixed-recovery-only")),
    "recovery-only heartbeat is emitted by the actual startup handler");
}
void (async () => {
  await run("empty"); await run("unknown"); await run("original");
  console.log("fixedEntryStartupRecovery: PASS · actual index exits on proven-empty history, survives unknown or known original custody, emits recovery heartbeat and shuts down without broker calls");
})().catch(error => { console.error(error); process.exitCode = 1; });
