// Manual-exit twin helpers (man-vs-machine A/B). A `<base>-manual` channel takes the
// base strategy's programmed ENTRIES but the operator owns the EXITS (the worker drops
// programmed exits for these slugs; see paper-trader 2026-06-08b). Mirrors the worker's
// slug logic so the UI (badge + scorecard) and the worker agree on what "manual" means.

export const MANUAL_SUFFIX = "-manual";

export const isManualChannel = (slug: string | undefined | null): boolean =>
  !!slug && /-manual$/i.test(slug);

// The base (machine) channel a manual twin shadows — i.e. `power-manual` → `power`.
export const baseSlugOf = (slug: string): string => slug.replace(/-manual$/i, "");
