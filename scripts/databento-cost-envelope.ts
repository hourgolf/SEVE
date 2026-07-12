// Cost-only Databento preflight. This file intentionally contains no time-series
// or batch-submit endpoint and therefore cannot order or download market data.
import { readFileSync } from "node:fs";

function loadLocalEnv(): void {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

loadLocalEnv();
const key = process.env.DATABENTO_API_KEY;
if (!key) throw new Error("Set DATABENTO_API_KEY in .env.local");

const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
const ranges = [
  ["2022", "2022-01-03", "2023-01-01"],
  ["2023", "2023-01-01", "2024-01-01"],
  ["2024", "2024-01-01", "2025-01-01"],
  ["2025", "2025-01-01", "2026-01-01"],
  ["2026 YTD", "2026-01-01", "2026-07-11"],
] as const;

async function getCost(start: string, end: string, schema: string): Promise<number> {
  const query = new URLSearchParams({
    dataset: "OPRA.PILLAR",
    symbols: "SPY.OPT,QQQ.OPT,IWM.OPT",
    schema,
    stype_in: "parent",
    start,
    end,
  });
  const response = await fetch(`https://hist.databento.com/v0/metadata.get_cost?${query}`, {
    headers: { Authorization: auth },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Databento ${response.status}: ${body.slice(0, 300)}`);
  const cost = Number(JSON.parse(body));
  if (!Number.isFinite(cost)) throw new Error(`Unexpected cost response: ${body.slice(0, 300)}`);
  return cost;
}

async function main(): Promise<void> {
  console.log("Databento full-chain cost envelope (NO DATA ORDERED)");
  console.log("SPY.OPT + QQQ.OPT + IWM.OPT · OPRA.PILLAR · parent symbology");
  let total = 0;
  for (const [label, start, end] of ranges) {
    const cost = await getCost(start, end, "cbbo-1m");
    total += cost;
    console.log(`${label.padEnd(9)} $${cost.toFixed(2)}`);
  }
  const definitions = await getCost("2022-01-03", "2026-07-11", "definition");
  console.log(`Definitions $${definitions.toFixed(2)}`);
  console.log(`Upper bound $${total.toFixed(2)} cbbo-1m + $${definitions.toFixed(2)} definitions`);
  console.log("This is an intentionally broad full-chain ceiling, not the final filtered order.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
