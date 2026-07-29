import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(ROOT, "market-ingest.ts");
const ARTIFACT = resolve(ROOT, "supabase/functions/market-ingest/index.ts");
const BANNER = [
  "// GENERATED DEPLOYMENT ARTIFACT — DO NOT EDIT.",
  "// Source: market-ingest.ts + its local dependency graph.",
  "// Regenerate: npm run market-ingest-edge:build",
].join("\n");

async function bundle() {
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    outfile: ARTIFACT,
    bundle: true,
    external: ["jsr:*"],
    format: "esm",
    legalComments: "none",
    metafile: true,
    platform: "neutral",
    target: "es2022",
    write: false,
    banner: { js: BANNER },
  });
  assert.equal(result.outputFiles.length, 1, "expected one self-contained Edge Function artifact");
  return {
    text: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs).sort(),
  };
}

const generated = await bundle();
assert.deepEqual(
  generated.inputs,
  [
    "engine/market-calendar.ts",
    "lib/market/marketIngestWindow.ts",
    "market-ingest.ts",
  ],
  "the deployable artifact must be built only from the reviewed ingest source graph",
);

const imports = [...generated.text.matchAll(/^\s*import .*? from ["']([^"']+)["'];?$/gm)]
  .map((match) => match[1]);
assert.deepEqual(
  imports,
  ["jsr:@supabase/supabase-js@2"],
  "the deployable artifact may retain only the Supabase JSR import",
);
assert.match(generated.text, /function marketIngestWindow\(/);
assert.match(generated.text, /skipReason: "calendar_unknown"/);
assert.match(generated.text, /skipReason: "after_capture_tail"/);
assert.match(generated.text, /nextSessionDateEt: nextTradingDay\(dateEt\)/);

if (process.argv.includes("--write")) {
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, generated.text);
  console.log(`market-ingest-edge: wrote ${generated.text.length} bytes to ${ARTIFACT}`);
} else {
  let checkedIn = "";
  try {
    checkedIn = readFileSync(ARTIFACT, "utf8");
  } catch {
    assert.fail("deployable market-ingest artifact is missing; run npm run market-ingest-edge:build");
  }
  assert.equal(
    checkedIn,
    generated.text,
    "deployable market-ingest artifact is stale; run npm run market-ingest-edge:build",
  );
  console.log("market-ingest-edge selftest: generated artifact is current and self-contained");
}
