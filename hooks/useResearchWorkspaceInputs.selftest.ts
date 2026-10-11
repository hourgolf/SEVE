import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement, Fragment, memo, useState } from "react";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { ResearchWorkspaceInputs } from "@/lib/research/researchWorkspaceInputs";
import type { WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { useResearchWorkspaceInputs } from "./useResearchWorkspaceInputs";
import { useShadowResearch, type ShadowResearch } from "./useShadowResearch";

const { act, create } = createRequire(import.meta.url)("react-test-renderer");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const base = {
    shadowResearch: { state: "ok", error: "", sessions: [] },
    managerEvidence: { state: "ok", book: null },
    decisionAtlas: { state: "ok", freshness: "current", bySlug: {} },
    setResearchDetailDemand: () => undefined,
    sentinel: { operatorPacket: null },
    allChannelWorkspace: { bySlug: { macd: { lifecycle: "active", rootPolicy: { managerLabel: "Native" } } } },
    channelControlPlane: { view: { configurationEpochId: "epoch-1" } },
    view: { desk: { strategists: [{ slug: "macd" }] } },
  } as unknown as SurfaceProps;
  let renders = 0;
  let controlRenders = 0;
  const ControlPanel = memo(({ surface }: { surface: SurfaceProps }) => {
    controlRenders++;
    return null;
  });
  let received: ResearchWorkspaceInputs | undefined;
  const Panel = memo(({ surface }: { surface: ResearchWorkspaceInputs; destination: WorkspaceDestination }) => {
    renders++;
    received = surface;
    const [selection, select] = useState(0);
    return createElement("button", { onClick: () => select((value) => value + 1) }, String(selection));
  });
  const destination: WorkspaceDestination = { section: "research", researchMode: "decisions" };
  const Adapter = ({ surface, target = destination }: { surface: SurfaceProps; target?: WorkspaceDestination }) =>
    createElement(Fragment, null,
      createElement(ControlPanel, { surface }),
      createElement(Panel, { surface: useResearchWorkspaceInputs(surface), destination: target }));
  let renderer: ReturnType<typeof create>;
  await act(() => { renderer = create(createElement(Adapter, { surface: base })); });
  const initial = received;
  // A polling parent changes marks, health, release timestamps and passport
  // objects. None of these are evidence or displayed channel posture changes.
  for (let poll = 0; poll < 100; poll++) {
    const livePoll = { ...base,
      data: { spot: poll }, incident: { now: poll }, livePnl: { pnl: poll },
      allChannelWorkspace: { ...base.allChannelWorkspace,
        bySlug: { macd: { ...base.allChannelWorkspace.bySlug.macd,
          rootPolicy: { ...base.allChannelWorkspace.bySlug.macd.rootPolicy }, live: { pnl: poll } } } },
      sentinel: { ...base.sentinel, asOf: String(poll) },
    } as unknown as SurfaceProps;
    await act(() => renderer.update(createElement(Adapter, { surface: livePoll })));
  }
  assert.equal(renders, 1, "100 unrelated desk polls must cause zero additional research renders");
  assert.equal(controlRenders, 101, "passing the whole live surface reproduces the former render churn");
  assert.equal(received, initial);
  await act(() => renderer.root.findByType("button").props.onClick());
  assert.equal(renderer.root.findByType("button").children[0], "1", "local selection must still update");
  assert.equal(renders, 2);

  const evidenceUpdates: SurfaceProps[] = [
    { ...base, decisionAtlas: { ...base.decisionAtlas, state: "error" } },
    { ...base, shadowResearch: { ...base.shadowResearch, error: "coverage unavailable" } },
    { ...base, managerEvidence: { ...base.managerEvidence, state: "error" } },
    { ...base, setResearchDetailDemand: () => undefined },
    { ...base, sentinel: { ...base.sentinel, operatorPacket: {} } },
    { ...base, channelControlPlane: { view: { configurationEpochId: "epoch-2" } } },
    { ...base, allChannelWorkspace: { bySlug: { macd: { lifecycle: "dark", rootPolicy: { managerLabel: "Native" } } } } },
    { ...base, allChannelWorkspace: { bySlug: { macd: { lifecycle: "active", rootPolicy: { managerLabel: "Ratchet" } } } } },
    { ...base, view: { desk: { strategists: [{ slug: "fomc" }] } } },
  ] as unknown as SurfaceProps[];
  for (const surface of evidenceUpdates) {
    const before: number = renders;
    await act(() => renderer.update(createElement(Adapter, { surface })));
    assert.equal(renders, before + 1, "evidence, errors and runtime posture must invalidate the panel");
  }
  const beforeNavigation = renders;
  await act(() => renderer.update(createElement(Adapter, {
    surface: evidenceUpdates.at(-1)!, target: { ...destination, channel: "fomc" },
  })));
  assert.equal(renders, beforeNavigation + 1, "navigation must reach the isolated panel");
  await act(() => renderer.unmount());

  let read: ShadowResearch | undefined;
  function DisabledResearch() {
    read = useShadowResearch(false, []);
    return null;
  }
  await act(() => { renderer = create(createElement(DisabledResearch)); });
  const originalRead = read!;
  await act(() => renderer.update(createElement(DisabledResearch)));
  assert.equal(read, originalRead, "disabled research must preserve its return object through parent renders");
  assert.throws(() => read!.setDateRange("2026-07-02", "2026-07-01"), "date validation must remain intact");
  await act(() => read!.setDateRange("2026-07-01", "2026-07-02"));
  assert.deepEqual(read!.dateRange, { from: "2026-07-01", through: "2026-07-02" });
  assert.equal(read!.setDateRange, originalRead.setDateRange);
  const changedRead = read;
  await act(() => read!.setDateRange("2026-07-01", "2026-07-02"));
  assert.equal(read, changedRead, "reapplying the same range must not invalidate evidence");
  await act(() => renderer.unmount());
  console.log("research render isolation: PASS · 100 unrelated polls: 101 whole-surface renders vs 1 isolated render; local selection, evidence/navigation invalidation and range validation");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
