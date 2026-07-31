import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeskOperator } from "@/lib/auth/serverOperator";

export const dynamic = "force-dynamic";

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;
  if (!SB_URL || !SB_SERVICE) {
    return json({ ok: false, error: "activation storage is not configured" }, 503);
  }
  const sb = createClient(SB_URL, SB_SERVICE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const proposalRead = await sb.from("channel_change_proposals")
    .select(
      "id,reason,evidence_refs,proposed_patch,approval_state,created_at,base:base_spec_version_id(version_key,channel_slug),proposed:proposed_spec_version_id(version_key,content_hash,execution_posture)",
    )
    .in("approval_state", ["draft", "validated"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (proposalRead.error) {
    return json({
      ok: false,
      error: "activation proposal inventory is unavailable",
    }, 503);
  }
  const proposals = (proposalRead.data ?? []) as unknown as Array<
    Record<string, unknown>
  >;
  const proposalIds = proposals.map((proposal) => String(proposal.id ?? ""));
  if (!proposalIds.length) return json({ ok: true, proposals: [] });
  const [previewRead, acknowledgementRead] = await Promise.all([
    sb.from("channel_activation_previews")
      .select(
        "id,proposal_id,candidate_manifest_hash,configuration_epoch_id,prepared_at,runtime_mutation,order_authority",
      )
      .in("proposal_id", proposalIds),
    sb.from("channel_activation_worker_acknowledgements")
      .select(
        "id,proposal_id,preview_id,source_boot_id,acknowledged_at,runtime_mutation,order_authority",
      )
      .in("proposal_id", proposalIds)
      .order("acknowledged_at", { ascending: false }),
  ]);
  if (previewRead.error || acknowledgementRead.error) {
    return json({
      ok: false,
      error: "activation preview or worker acknowledgement is unavailable",
    }, 503);
  }
  const previews = new Map(
    ((previewRead.data ?? []) as Array<Record<string, unknown>>)
      .map((preview) => [String(preview.proposal_id ?? ""), preview]),
  );
  const acknowledgements = new Map<string, Record<string, unknown>>();
  for (const acknowledgement of
    (acknowledgementRead.data ?? []) as Array<Record<string, unknown>>) {
    const proposalId = String(acknowledgement.proposal_id ?? "");
    if (!acknowledgements.has(proposalId)) {
      acknowledgements.set(proposalId, acknowledgement);
    }
  }
  return json({
    ok: true,
    proposals: proposals.map((proposal) => {
      const proposalId = String(proposal.id ?? "");
      return {
        ...proposal,
        preview: previews.get(proposalId) ?? null,
        latestWorkerAcknowledgement:
          acknowledgements.get(proposalId) ?? null,
      };
    }),
  });
}
