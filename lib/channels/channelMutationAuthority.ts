export const CHANNEL_MUTATION_AUTHORITY_VERSION =
  "receipt-bound-channel-mutation-authority-v1" as const;

export const LEGACY_CONFIGURATION_WRITES_ENABLED = false as const;

export type ChannelMutationKind =
  | "configuration"
  | "execution-posture"
  | "executor-route"
  | "channel-create"
  | "channel-delete"
  | "presentation"
  | "manual-position-risk";

export interface ChannelMutationDecision {
  allowed: boolean;
  authority: "governed-proposal" | "operator-authentication";
  fact: string;
}

const PROPOSAL_REQUIRED =
  "Receipt-bound runtime: configuration, roster, and executor changes require a governed proposal.";

export function channelMutationDecision(kind: ChannelMutationKind): ChannelMutationDecision {
  if (kind === "presentation" || kind === "manual-position-risk") {
    return {
      allowed: true,
      authority: "operator-authentication",
      fact: "This action does not alter the receipt-bound channel execution contract.",
    };
  }
  return {
    allowed: LEGACY_CONFIGURATION_WRITES_ENABLED,
    authority: "governed-proposal",
    fact: PROPOSAL_REQUIRED,
  };
}

export function legacyConfigurationWriteFact(): string {
  return channelMutationDecision("configuration").fact;
}
