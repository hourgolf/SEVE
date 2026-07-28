import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compileReleaseManifest } from "./channelControlPlane";
import { buildShadowRuntimeProjection } from "./channelActivation";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import {
  RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE,
  BASELINE_ADOPTION_PACKET_IDENTITY,
} from "./channelBaselineAdoption";
import {
  collectBaselineAdoptionServerEvidence,
} from "./channelBaselineAdoptionServerEvidence";

const NOW = "2026-07-28T12:00:20.000Z";
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const projection = buildShadowRuntimeProjection(compiled);
const accounts = [
  { id: "11111111-1111-4111-8111-111111111111", name: "A", mode: "paper", cred_ref: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "B", mode: "paper", cred_ref: "B" },
  { id: "33333333-3333-4333-8333-333333333333", name: "C", mode: "paper", cred_ref: "C" },
];
process.env.ALPACA_KEY = "fixture-key-a";
process.env.ALPACA_SECRET = "fixture-secret-a";
process.env.ALPACA_KEY_B = "fixture-key-b";
process.env.ALPACA_SECRET_B = "fixture-secret-b";
process.env.ALPACA_KEY_C = "fixture-key-c";
process.env.ALPACA_SECRET_C = "fixture-secret-c";

const startupReceipt = {
  releaseId: BASELINE_ADOPTION_PACKET_IDENTITY.releaseId,
  workerVersion: BASELINE_ADOPTION_PACKET_IDENTITY.workerCompatibilityVersion,
  releaseConfigurationSha256: BASELINE_ADOPTION_PACKET_IDENTITY.legacyConfigurationHash,
  fundMode: "paper",
  roots: compiled.channelSpecs.map((spec) => ({
    slug: spec.slug,
    accountId: spec.accountId,
    managerProfileId: spec.managerProfileId,
    quantity: spec.quantity,
  })),
  runtimeReadiness: {
    heldCaptureReady: true,
    heldCaptureStartedBeforeBootDecision: true,
    flatEraBoundaryProven: true,
  },
};
const acknowledgement = {
  protocolVersion: "channel-activation-protocol-v1",
  manifestId: projection.manifestId,
  manifestContentHash: projection.manifestContentHash,
  configurationEpochId: projection.configurationEpochId,
  workerCompatibilityVersion: projection.workerCompatibilityVersion,
  workerReleaseId: BASELINE_ADOPTION_PACKET_IDENTITY.releaseId,
  workerRuntimeVersion: "runtime:fixture:rc54",
  bootId: "boot:fixture:rc54",
  accountMode: "paper",
  posture: "baseline-observed-no-order-authority",
  acknowledgedAt: "2026-07-28T12:00:15.000Z",
  evidenceRef: "control-plane:fixture:draft",
};
const events = [
  {
    id: "101",
    level: "EXEC",
    strategist_id: null,
    message:
      `stream: rc54-release ACTIVE ${BASELINE_ADOPTION_PACKET_IDENTITY.releaseId} config=${BASELINE_ADOPTION_PACKET_IDENTITY.legacyConfigurationHash}`,
    meta: startupReceipt,
    created_at: "2026-07-28T12:00:05.000Z",
  },
  {
    id: "102",
    level: "EXEC",
    strategist_id: null,
    message:
      `stream: control-plane baseline shadow ACKNOWLEDGED ${projection.manifestId}`,
    meta: {
      observerMode: RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE,
      state: "acknowledged",
      blockers: [],
      manifestStatus: "draft",
      acknowledgement,
      runtimeMutation: false,
      databaseWriteAuthority: false,
      orderAuthority: false,
      activationAuthorized: false,
    },
    created_at: "2026-07-28T12:00:15.000Z",
  },
];
const workers = [{
  boot_id: "boot:fixture:rc54",
  version: acknowledgement.workerRuntimeVersion,
  started_at: "2026-07-28T12:00:00.000Z",
  last_heartbeat_at: "2026-07-28T12:00:19.000Z",
  last_phase: "afterhours",
  ended_at: null,
  last_error: null,
}];

class FakeQuery {
  constructor(private readonly result: { data: unknown; error: null | { message: string } }) {}
  select(): this { return this; }
  in(): this { return this; }
  is(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  eq(): this { return this; }
  then<TResult1 = { data: unknown; error: null | { message: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null | { message: string } }) =>
      TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(
  patch: Partial<Record<string, unknown>> = {},
  errors: Partial<Record<string, { message: string }>> = {},
): SupabaseClient {
  const tables: Record<string, unknown> = {
    events,
    worker_runs: workers,
    accounts,
    positions: [],
    ...patch,
  };
  return {
    from(table: string) {
      return new FakeQuery({
        data: tables[table] ?? [],
        error: errors[table] ?? null,
      });
    },
  } as unknown as SupabaseClient;
}

const refs = {
  startupReceiptEventId: "101",
  workerAcknowledgementEventId: "102",
};
const emptyBroker = async () => new Response(JSON.stringify([]), {
  status: 200,
  headers: { "content-type": "application/json" },
});

let checks = 0;
const check = async (name: string, run: () => void | Promise<void>): Promise<void> => {
  await run();
  checks++;
  void name;
};

async function main(): Promise<void> {
  await check("server resolves stored current-worker evidence and all-account broker flatness", async () => {
    const urls: string[] = [];
    const evidence = await collectBaselineAdoptionServerEvidence({
      sb: fakeSupabase(),
      refs,
      now: NOW,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return emptyBroker();
      },
    });
    assert.equal(evidence.workerAcknowledgement.bootId, "boot:fixture:rc54");
    assert.equal(
      evidence.startupReceipt.releaseId,
      BASELINE_ADOPTION_PACKET_IDENTITY.releaseId,
    );
    assert.equal(evidence.safeBoundaryProof.globalFlat, true);
    assert.equal(urls.length, 6);
    assert.equal(urls.filter((url) => url.endsWith("/v2/positions")).length, 3);
    assert.equal(urls.filter((url) => url.includes("/v2/orders?status=open")).length, 3);
  });

  await check("missing broker credentials fail closed", async () => {
    const secret = process.env.ALPACA_SECRET_C;
    delete process.env.ALPACA_SECRET_C;
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase(),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /query_failed/,
    );
    process.env.ALPACA_SECRET_C = secret;
  });

  await check("stored evidence read failure blocks before adoption", async () => {
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({}, { events: { message: "events unavailable" } }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /stored events evidence read failed/,
    );
  });

  await check("an open broker order fails closed", async () => {
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase(),
        refs,
        now: NOW,
        fetchImpl: async (input) => String(input).includes("/v2/orders?")
          ? new Response(JSON.stringify([{ id: "order-1" }]), { status: 200 })
          : emptyBroker(),
      }),
      /orders:not_flat:1/,
    );
  });

  await check("an open desk row fails closed even when every broker is flat", async () => {
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({ positions: [{ id: "position-1" }] }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /desk_positions:not_flat:1/,
    );
  });

  await check("multiple or stale workers fail closed", async () => {
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({ worker_runs: [...workers, { ...workers[0] }] }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /exactly one current worker/,
    );
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({
          worker_runs: [{ ...workers[0], last_heartbeat_at: "2026-07-28T11:00:00.000Z" }],
        }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /liveness/,
    );
  });

  await check("prior-worker, wrong-boot, or authorityful acknowledgement fails closed", async () => {
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({
          events: events.map((event) => event.id === "102"
            ? { ...event, created_at: "2026-07-28T11:59:59.000Z" }
            : event),
        }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /current ordered startup/,
    );
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({
          worker_runs: [{ ...workers[0], boot_id: "boot:different" }],
        }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /current worker boot/,
    );
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({
          worker_runs: [{ ...workers[0], version: "runtime:different" }],
        }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /runtime does not match/,
    );
    await assert.rejects(
      collectBaselineAdoptionServerEvidence({
        sb: fakeSupabase({
          events: events.map((event) => event.id === "102"
            ? { ...event, meta: { ...(event.meta as object), activationAuthorized: true } }
            : event),
        }),
        refs,
        now: NOW,
        fetchImpl: emptyBroker,
      }),
      /authority-free/,
    );
  });

  console.log(`channel-baseline-adoption-server-evidence-selftest: ${checks}/${checks} passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
