/** Recovery protocol records describe custody/reconciliation, not an ordinary
 * signal, execution result or route receipt. Presence of a protocol marker is
 * sufficient to quarantine malformed/future records from performance totals. */
export function isFixedEntryProtocolObservation(row: { reason?: unknown; payload?: unknown }): boolean {
  const payload = row.payload;
  return (payload !== null && typeof payload === "object" && !Array.isArray(payload)
    && (Object.prototype.hasOwnProperty.call(payload, "fixed_entry_protocol")
      || Object.prototype.hasOwnProperty.call(payload, "fixed_entry_admission")))
    || (typeof row.reason === "string" && /^(fixed_entry_protocol|fixed_entry_admission):/.test(row.reason));
}
