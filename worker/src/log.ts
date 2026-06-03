// ============================================================================
//  Tiny structured logger. Railway captures stdout, so plain timestamped lines
//  are the operational record. `journal()` additionally writes the `events`
//  table when a service role is present (so the dashboard event log sees the
//  worker's lifecycle), mirroring the cron worker's journal().
// ============================================================================

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

type Level = "INFO" | "WARN" | "ERROR" | "EXEC" | "SHADOW";

export function log(level: Level, msg: string, meta?: unknown): void {
  const line = `${ts()} [${level}] ${msg}`;
  if (level === "ERROR" || level === "WARN") console.error(line);
  else console.log(line);
  if (meta !== undefined) {
    const s = typeof meta === "string" ? meta : JSON.stringify(meta);
    console.log(`${ts()}        ↳ ${s}`);
  }
}

export const info = (m: string, meta?: unknown) => log("INFO", m, meta);
export const warn = (m: string, meta?: unknown) => log("WARN", m, meta);
export const error = (m: string, meta?: unknown) => log("ERROR", m, meta);
export const shadow = (m: string, meta?: unknown) => log("SHADOW", m, meta);
