// Motion rule of the desk (GSAP micro-interactions, 2026-07-07): motion must
// CARRY INFORMATION — a flash marks "this just changed", FLIP preserves object
// permanence when panels re-arrange programmatically. Nothing decorative, and
// everything gates on the OS reduced-motion setting (degrades to instant state,
// never to missing state).
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
