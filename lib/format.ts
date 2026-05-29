// Formatting helpers — mirror the reference HTML's money() / t2() / fmt() / d2().

export const money = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + Number(v).toFixed(2);

// 24-hour local clock, e.g. "14:32:05"
export const timeOfDay = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour12: false });

// Price/greek cell value; "·" placeholder when the contract leg is missing.
export const num2 = (v: number | null | undefined): string =>
  v == null ? "·" : Number(v).toFixed(2);
