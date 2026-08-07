export interface ChannelVariantFamily {
  id: string;
  members: readonly string[];
  authority: "reviewed_code_registry";
  note: string;
}

/**
 * Reviewed channel identities that are intentionally eligible for paired-clock
 * comparison. Name similarity is not evidence of comparable entry semantics,
 * so undeclared channels never pair automatically.
 */
export const CHANNEL_VARIANT_FAMILIES: readonly ChannelVariantFamily[] = Object.freeze([
  Object.freeze({
    id: "pb-ride",
    members: Object.freeze(["pb-ride", "pb-ride-2", "pb-ride-itm"]),
    authority: "reviewed_code_registry" as const,
    note: "Pullback-ride entry variants retained for same-clock comparison.",
  }),
  Object.freeze({
    id: "momo-shape",
    members: Object.freeze(["momo-shape", "momo-shape-2"]),
    authority: "reviewed_code_registry" as const,
    note: "Momentum-shape entry variants retained for same-clock comparison.",
  }),
  Object.freeze({
    id: "grind",
    members: Object.freeze(["grind", "grind-v3", "grind-v3-2", "grind-smart-entries"]),
    authority: "reviewed_code_registry" as const,
    note: "Grind variants retained for same-clock comparison.",
  }),
]);

const FAMILY_BY_SLUG = new Map(
  CHANNEL_VARIANT_FAMILIES.flatMap((family) => family.members.map((slug) => [slug, family.id] as const)),
);

export const channelVariantFamilyId = (slug: string): string | null => FAMILY_BY_SLUG.get(slug) ?? null;

export const areReviewedChannelVariants = (left: string, right: string): boolean => {
  const family = channelVariantFamilyId(left);
  return left !== right && family != null && family === channelVariantFamilyId(right);
};
