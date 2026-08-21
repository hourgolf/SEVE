import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(new URL("./ChannelResearchBooks.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../studio/ChannelInspector.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../mobile2/MobileRackRow.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../perform/ShadowResearchWorkspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/research-books.css", import.meta.url), "utf8");

assert.match(board, /WHAT ARE WE DOING WITH EACH CHANNEL\?/);
assert.match(board, /OPERATOR INBOX/);
assert.match(board, /MAXIMUM 3/);
assert.match(board, /\.slice\(0, 3\)/);
assert.match(board, /RESEARCH ONLY · NO RUNTIME AUTHORITY/);
assert.match(workspace, /<ResearchBookBoard/);
assert.match(inspector, /<ChannelResearchProgramCard/);
assert.match(mobile, /m2-rr-book/);
assert.match(css, /data-skin="blackout"/);
assert.match(css, /@media\(max-width:760px\)/);
console.log("ChannelResearchBooks-selftest: PASS");
