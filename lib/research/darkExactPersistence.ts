import { deterministicEvidenceUuid } from "../evidence/identity.js";
import type { DarkManagerPath } from "./darkExactReplay.js";
import type { VbExactPathDbPayload } from "./vbCandidateEvidence.js";

export const DARK_EXACT_MANAGER_PATH_RECEIPT_SCHEMA_VERSION = 1 as const;

export const DARK_EXACT_MANAGER_PATH_SQL_FIELDS = [
  "id",
  "schema_version",
  "candidate_id",
  "opportunity_id",
  "exact_path_receipt_id",
  "session_date_et",
  "channel_slug",
  "channel_version",
  "configuration_epoch_id",
  "candidate_manager_version",
  "manager_id",
  "manager_policy_version",
  "source_bar_at",
  "decision_observed_at",
  "entry_ask",
  "exit_at",
  "exit_bid",
  "exit_reason",
  "return_pct",
  "pnl_per_contract",
  "basis",
  "independent_opportunity",
  "replay_version",
] as const;

export type DarkExactManagerPathDbPayload = Record<
  typeof DARK_EXACT_MANAGER_PATH_SQL_FIELDS[number],
  string | number | boolean
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^(?:sha256:)?[0-9a-f]{64}$/;

export function darkExactManagerPathDbPayload(input: {
  path: DarkManagerPath;
  exactPath: VbExactPathDbPayload;
  replayVersion: string;
}): DarkExactManagerPathDbPayload | null {
  const { path, exactPath } = input;
  if (exactPath.candidate_id !== path.candidateId
      || exactPath.opportunity_id !== path.opportunityId
      || !UUID.test(String(exactPath.id))
      || !SHA.test(path.channelVersion)
      || !SHA.test(path.configurationEpochId)
      || !SHA.test(path.candidateManagerVersion)
      || !path.managerId
      || !path.managerPolicyVersion
      || !input.replayVersion
      || path.basis !== "databento_entry_ask_to_executable_bid"
      || !path.independentOpportunity
      || !Number.isFinite(path.entryAsk)
      || path.entryAsk <= 0
      || !Number.isFinite(path.exitBid)
      || path.exitBid <= 0
      || !Number.isFinite(path.returnPct)
      || !Number.isFinite(path.pnlPerContract)
      || !Number.isFinite(Date.parse(path.sourceBarAt))
      || !Number.isFinite(Date.parse(path.decisionObservedAt))
      || !Number.isFinite(Date.parse(path.exitAt))) {
    return null;
  }
  return {
    id: deterministicEvidenceUuid("seve-dark-exact-manager-path-v1", {
      candidateId: path.candidateId,
      managerId: path.managerId,
      managerPolicyVersion: path.managerPolicyVersion,
      replayVersion: input.replayVersion,
    }),
    schema_version: DARK_EXACT_MANAGER_PATH_RECEIPT_SCHEMA_VERSION,
    candidate_id: path.candidateId,
    opportunity_id: path.opportunityId,
    exact_path_receipt_id: String(exactPath.id),
    session_date_et: path.sessionDateEt,
    channel_slug: path.channelSlug,
    channel_version: path.channelVersion,
    configuration_epoch_id: path.configurationEpochId,
    candidate_manager_version: path.candidateManagerVersion,
    manager_id: path.managerId,
    manager_policy_version: path.managerPolicyVersion,
    source_bar_at: path.sourceBarAt,
    decision_observed_at: path.decisionObservedAt,
    entry_ask: path.entryAsk,
    exit_at: path.exitAt,
    exit_bid: path.exitBid,
    exit_reason: path.exitReason,
    return_pct: path.returnPct,
    pnl_per_contract: path.pnlPerContract,
    basis: path.basis,
    independent_opportunity: true,
    replay_version: input.replayVersion,
  };
}
