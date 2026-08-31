import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { browserPublicationHash, stablePublicationJson, verifyAtlasPublication, type AtlasPublishedRow } from "./atlasPublication";

const hash = async (value: unknown) => `sha256:${createHash("sha256").update(stablePublicationJson(value)).digest("hex")}`;
const through = "2026-08-28";
const publication = { version: "atlas-publication-v1", throughSession: through,
  generatedAt: "2026-08-29T04:30:00.000Z", bundleSha256: `sha256:${"a".repeat(64)}`, channels: ["a", "b"] };
const row = async (channel: string, changes = {}, withReceipt = true): Promise<AtlasPublishedRow> => {
  const brief = { channel, throughSession: through, generatedAt: publication.generatedAt,
    ...(withReceipt ? { publication } : {}), ...changes };
  return { channel_slug: channel, brief, brief_sha256: await hash(brief) };
};

async function main() {
  const rows = await Promise.all([row("a"), row("b")]);
  assert.equal((await verifyAtlasPublication(rows, through, hash)).state, "verified");
  assert.equal((await verifyAtlasPublication([await row("a", {}, false)], through, hash)).state, "unverified");
  await assert.rejects(() => verifyAtlasPublication([], through, hash), /no channel/);
  await assert.rejects(() => verifyAtlasPublication([rows[0]], through, hash), /partial/);
  await assert.rejects(() => verifyAtlasPublication([rows[0], rows[0]], through, hash), /identity/);
  await assert.rejects(() => verifyAtlasPublication(rows, "2026-08-27", hash), /identity/);
  await assert.rejects(() => verifyAtlasPublication([{ ...rows[0], brief_sha256: "bad" }, rows[1]], through, hash), /hash/);
  await assert.rejects(() => verifyAtlasPublication([rows[0], { ...rows[1], channel_slug: "c" }], through, hash), /identity/);
  await assert.rejects(async () => verifyAtlasPublication([rows[0], await row("b", {}, false)], through, hash), /partial/);
  await assert.rejects(async () => verifyAtlasPublication([rows[0], await row("b", { publication: { ...publication, bundleSha256: `sha256:${"b".repeat(64)}` } })], through, hash), /partial/);
  await assert.rejects(async () => verifyAtlasPublication([rows[0], await row("b", { generatedAt: "2026-08-30T01:00:00Z" })], through, hash), /partial/);
  assert.equal(await browserPublicationHash({ z: 1, a: [1, null, "Δ"], b: { y: 2, a: 3 } }), await hash({ b: { a: 3, y: 2 }, a: [1, null, "Δ"], z: 1 }));
  const hook = readFileSync(new URL("../../hooks/useDecisionAtlasReports.ts", import.meta.url), "utf8");
  assert.match(hook, /reports.count !== \(reports.data \?\? \[\]\).length/);
  assert.match(hook, /verifyAtlasPublication\(reports.data/);
  for (const path of ["components/perform/DecisionHomeWorkspace.tsx", "components/mobile2/MobilePerform.tsx"]) {
    const ui = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.match(ui, /publication\?\.state === "verified"/);
    assert.match(ui, /RESEARCH NEEDS REVIEW/);
    assert.doesNotMatch(ui, /Nightly research evidence finished publishing/);
  }
  console.log("atlas-publication selftest: PASS · complete/legacy/partial/mixed/tampered/browser hashes");
}
void main();
