// Free symbology discovery only. Calls symbology.resolve and writes its response
// to the gitignored v2 manifest area. It cannot request time-series market data.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function loadLocalEnv(): void {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

loadLocalEnv();
const key = process.env.DATABENTO_API_KEY;
if (!key) throw new Error("Set DATABENTO_API_KEY in .env.local");
const from = arg("from", "2026-07-10");
const to = arg("to", "2026-07-11");
const parents = arg("parents", "SPY.OPT,QQQ.OPT,IWM.OPT").split(",").map((value) => value.trim()).filter(Boolean);
const outputDir = "data/databento-v2/manifests/symbology";

async function main(): Promise<void> {
  const body = new URLSearchParams({
    dataset: "OPRA.PILLAR",
    symbols: parents.join(","),
    stype_in: "parent",
    stype_out: "instrument_id",
    start_date: from,
    end_date: to,
  });
  const response = await fetch("https://hist.databento.com/v0/symbology.resolve", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Databento ${response.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text) as { result?: Record<string, unknown>; partial?: unknown; not_found?: unknown };
  mkdirSync(outputDir, { recursive: true });
  const parentLabel = parents.map((parent) => parent.split(".")[0].toLowerCase()).join("-");
  const path = `${outputDir}/${from}_${to}-${parentLabel}.json`;
  writeFileSync(path, JSON.stringify({
    requestedAt: new Date().toISOString(),
    request: { dataset: "OPRA.PILLAR", parents, from, to },
    response: parsed,
  }));
  const result = parsed.result ?? {};
  console.log("Databento symbology resolution (FREE · NO DATA ORDERED)");
  console.log(`${from} → ${to} · ${Object.keys(result).length} result keys · ${Buffer.byteLength(text).toLocaleString()} response bytes`);
  console.log(`Saved ${path}`);
  const mappingCount = Object.values(result).reduce((sum, mappings) =>
    sum + (Array.isArray(mappings) ? mappings.length : Object.keys((mappings ?? {}) as object).length), 0);
  console.log(`${mappingCount.toLocaleString()} dated instrument mappings`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
