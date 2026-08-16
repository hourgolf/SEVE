export const ENTRY_QUALIFICATION_POLICY_VERSION =
  "entry-qualification-policy-v1" as const;

export interface EntryQualificationInput {
  channelSlug: string;
  currentEtMinute: number;
  eventDay: unknown;
  entryQualificationVersion?: string;
  entryStartEtMinute?: number;
  standDownDayTags?: readonly string[];
}

export interface EntryQualificationDecision {
  allowed: boolean;
  blockedReason: "orb_cpi_opex_standdown" | "orb_before_1030" | null;
  facts: Record<string, unknown>;
}

function eventTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.toLowerCase());
  }
  if (value && typeof value === "object") {
    const tags = (value as Record<string, unknown>).tags;
    return eventTags(tags);
  }
  return [];
}

/**
 * Receipt-bound and channel-specific. An absent qualification preserves the
 * raw strategy. This policy can suppress an executable entry, but it cannot
 * mutate an order, manager, account, size, or any other channel.
 */
export function evaluateEntryQualification(
  input: EntryQualificationInput,
): EntryQualificationDecision {
  const configured = input.entryQualificationVersion ===
    "orb-entry-qualification-v1";
  const facts = {
    entryQualificationPolicyVersion: ENTRY_QUALIFICATION_POLICY_VERSION,
    entryQualificationVersion: input.entryQualificationVersion ?? null,
    entryQualificationChannel: input.channelSlug,
    entryQualificationStartEtMinute: input.entryStartEtMinute ?? null,
    entryQualificationStandDownDayTags: [...(input.standDownDayTags ?? [])],
    entryQualificationObservedDayTags: eventTags(input.eventDay),
    entryQualificationCurrentEtMinute: input.currentEtMinute,
  };
  if (!configured) return { allowed: true, blockedReason: null, facts };

  const blockedTags = new Set((input.standDownDayTags ?? [])
    .map((tag) => tag.toLowerCase()));
  if (eventTags(input.eventDay).some((tag) => blockedTags.has(tag))) {
    return { allowed: false, blockedReason: "orb_cpi_opex_standdown", facts };
  }
  if (Number.isInteger(input.entryStartEtMinute)
      && input.currentEtMinute < Number(input.entryStartEtMinute)) {
    return { allowed: false, blockedReason: "orb_before_1030", facts };
  }
  return { allowed: true, blockedReason: null, facts };
}
