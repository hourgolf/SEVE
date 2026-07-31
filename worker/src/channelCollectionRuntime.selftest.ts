import assert from "node:assert/strict";
import {
  applyChannelCollectionRuntime,
  type StoredChannelCollectionState,
} from "./channelCollectionRuntime";
import type { ChannelConfig } from "./store";

const channel = (id: string, slug: string): ChannelConfig => ({
  id,
  slug,
  name: slug,
  status: "draft",
  spec_json: null,
  underlying: "SPY",
  executor: "stream",
  account_id: null,
  is_active: true,
  capital_pct: 100,
  aggression: 0,
  max_contracts: 1,
  daily_stop_usd: 100,
  daily_target_usd: 0,
  underlying_stop_pct: 0,
  muted: false,
  soloed: false,
  boosted: false,
  event_policy: "standdown",
  entry_dte: 0,
  strike_offset: 0,
  premium_stop_pct: 50,
  take_profit_pct: 0,
  pyramid_adds: 0,
  stall_minutes: 0,
  stall_max_favor_pct: 0,
  gap_min: 0,
  runner_frac: 0,
  runner_giveback_pct: 0,
});
const channels = [
  channel("11111111-1111-4111-8111-111111111111", "root"),
  channel("22222222-2222-4222-8222-222222222222", "shadow"),
];
const rows: StoredChannelCollectionState[] = [
  {
    channelId: channels[0].id,
    channelSlug: channels[0].slug,
    state: "active",
    receiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  },
  {
    channelId: channels[1].id,
    channelSlug: channels[1].slug,
    state: "paused",
    receiptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
];

const ready = applyChannelCollectionRuntime({
  channels,
  collection: rows,
  executingSlugs: ["root"],
});
assert.equal(ready.state, "ready");
assert.equal(ready.channels.find((item) => item.slug === "root")?.is_active, true);
assert.equal(ready.channels.find((item) => item.slug === "shadow")?.is_active, false);
assert.equal(ready.executionAuthority, false);
assert.equal(ready.orderAuthority, false);

const blocked = applyChannelCollectionRuntime({
  channels,
  collection: rows.map((row) => row.channelSlug === "root"
    ? { ...row, state: "paused" as const }
    : row),
  executingSlugs: ["root"],
});
assert.equal(blocked.state, "blocked");
assert.ok(blocked.blockers.includes(
  "collection_runtime:executing_collection_not_active:root",
));
assert.equal(blocked.channels.find((item) => item.slug === "shadow")?.is_active, true);

console.log("channel-collection-runtime-selftest: 2/2 passed");
