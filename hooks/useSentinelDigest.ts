"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import {
  operatorPacketToJudge,
  readSentinelOperatorPacket,
  type SentinelOperatorPacket,
} from "@/lib/sentinel/operatorPacket";

// One read for the whole §04 sentinel pair — the nightly digest event (published by
// scripts/sentinel.ts to the `events` table). The Brief panel renders `brief` (forward
// terrain: levels/events/dealer/priors); the Sentinel panel renders `judge` + `scan`
// (backward opportunity/drift + the LLM verdict). `digest` is the durable markdown kept
// for the legacy-fallback path. Latest-only and read-only — the durable copy lives in
// data/sentinel/<date>.md. The page-owned hook is passed through SurfaceProps to the active
// shells; isolated legacy panels retain their transitional reads until that surface retires.

const SENTINEL_LOOKBACK_DAYS = 14;
const SENTINEL_REFRESH_MS = 5 * 60_000;
const SENTINEL_RETRY_MS = 15_000;

export interface BriefStat { n: number; perT: number; win: number }
export interface BriefLevel { px: number; label: string }
export interface BriefBookPnl { book: string; pnl: number; channels: { slug: string; pnl: number; muted: boolean }[] }
export interface BriefDealer { sym: string; atmIv: number; impliedMove: number | null; gexShort: boolean; walls: number[] }
export interface BriefPrior { book: string; gap: BriefStat | null; flat: BriefStat | null }
export interface BriefTrap { label: string; n: number; perTrade: number | null; win: number | null; warn: boolean }
export interface Brief {
  asOf: string; forDate: string; gapMin: number;
  gap: { spy: number; iwm: number | null; qqq: number | null; cleared: boolean };
  rth: { o: number; h: number; l: number; c: number } | null;
  compile: { dayPnl: number; nTrades: number; books: BriefBookPnl[]; flags: string[] };
  update: { tests: { px: number; label: string; held: boolean }[]; near: BriefLevel | null; gapRegime: { cleared: number; total: number } };
  carry: { band: number | null; bandLo: number | null; bandHi: number | null; above: BriefLevel[]; below: BriefLevel[]; watch: string[] };
  events: string[]; dealer: BriefDealer[]; priors: BriefPrior[]; trap: BriefTrap[]; accrual: string[];
  sentLevels?: Record<string, { close: number | null; armLo: number | null; armHi: number | null; above: BriefLevel[]; below: BriefLevel[] }>;
}

export interface ScanRow { slug: string; peak: number; win: number; net?: number; give: number | null; pnl?: number; n: number }
export interface Scan {
  benchDays: number;
  promote: ScanRow[]; fixable: ScanRow[]; leaks: ScanRow[];
  drift: string[]; scalps: string[]; craters: string[];
  patterns?: string[]; // trigger-pattern flags (median-split entry features — descriptive, absent pre-07-10)
}
export interface Judge { verdict: "HOLD" | "QUEUE" | "WATCH" | string; opportunities: string[]; drift: string[]; soWhat: string }
/** Per-channel avg-peak/win map (era-4, real fills) — the harvest lens the P&L panel columns read. */
export type Lens = Record<string, { p: number; w: number; n: number }>;

export type DigestState = "loading" | "ok" | "empty" | "error";

export function useSentinelDigest(): {
  brief: Brief | null; scan: Scan | null; judge: Judge | null; lens: Lens | null;
  digest: string | null; date: string; forDate: string; session: string;
  createdAt: string; publishedAt: string; message: string; schemaVersion: number | null;
  publisherVersion: string; state: DigestState; err: string;
  interpretiveProvider: string; operatorPacket: SentinelOperatorPacket | null;
  publisherEvidenceState: "complete" | "partial" | "error" | "";
  publisherEvidenceDetail: string;
} {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [judge, setJudge] = useState<Judge | null>(null);
  const [lens, setLens] = useState<Lens | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [forDate, setForDate] = useState("");
  const [session, setSession] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [message, setMessage] = useState("");
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [publisherVersion, setPublisherVersion] = useState("");
  const [interpretiveProvider, setInterpretiveProvider] = useState("");
  const [operatorPacket, setOperatorPacket] = useState<SentinelOperatorPacket | null>(null);
  const [publisherEvidenceState, setPublisherEvidenceState] = useState<"complete" | "partial" | "error" | "">("");
  const [publisherEvidenceDetail, setPublisherEvidenceDetail] = useState("");
  const [state, setState] = useState<DigestState>("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearReceipt = () => {
      setBrief(null);
      setScan(null);
      setJudge(null);
      setLens(null);
      setDigest(null);
      setDate("");
      setForDate("");
      setSession("");
      setCreatedAt("");
      setPublishedAt("");
      setMessage("");
      setSchemaVersion(null);
      setPublisherVersion("");
      setInterpretiveProvider("");
      setOperatorPacket(null);
      setPublisherEvidenceState("");
      setPublisherEvidenceDetail("");
    };

    const schedule = (delayMs: number) => {
      if (!alive) return;
      timer = setTimeout(() => { void poll(); }, delayMs);
    };

    async function poll() {
      if (!alive || inFlight) return;
      inFlight = true;
      let nextDelay = SENTINEL_REFRESH_MS;
      try {
        const cutoff = new Date(Date.now() - SENTINEL_LOOKBACK_DAYS * 24 * 60 * 60_000).toISOString();
        const { data, error } = await getSupabase()
          .from("events").select("message,created_at,meta")
          .gte("created_at", cutoff)
          .like("message", "sentinel:%").order("created_at", { ascending: false }).limit(1);
        if (!alive) return;
        if (error) {
          setState("error");
          setErr(error.message);
          nextDelay = SENTINEL_RETRY_MS;
          return;
        }
        const row = (data ?? [])[0] as { message?: string; created_at?: string; meta?: Record<string, unknown> } | undefined;
        const meta = row?.meta;
        if (!meta) {
          clearReceipt();
          setErr("");
          setState("empty");
          return;
        }
        setBrief((meta.brief as Brief) ?? null);
        setScan((meta.scan as Scan) ?? null);
        const packet = readSentinelOperatorPacket(meta.operatorPacket);
        setJudge(packet ? operatorPacketToJudge(packet) : (meta.judge as Judge) ?? null);
        setLens((meta.lens as Lens) ?? null);
        setDigest((meta.digest as string) ?? null);
        setDate((meta.date as string) ?? row?.created_at?.slice(0, 10) ?? "");
        setForDate((meta.forDate as string) ?? "");
        setSession((meta.session as string) ?? "");
        setCreatedAt(row?.created_at ?? "");
        setPublishedAt((meta.publishedAt as string) ?? row?.created_at ?? "");
        setMessage(row?.message ?? "");
        setSchemaVersion(typeof meta.schemaVersion === "number" ? meta.schemaVersion : null);
        setPublisherVersion((meta.publisherVersion as string) ?? "");
        setInterpretiveProvider((meta.interpretiveProvider as string) ?? "");
        setOperatorPacket(packet);
        const evidenceState = meta.publisherEvidenceState;
        setPublisherEvidenceState(evidenceState === "complete" || evidenceState === "partial" || evidenceState === "error" ? evidenceState : "");
        setPublisherEvidenceDetail((meta.publisherEvidenceDetail as string) ?? "");
        setErr("");
        setState("ok");
      } catch (e) {
        if (alive) {
          setState("error");
          setErr((e as Error).message);
          nextDelay = SENTINEL_RETRY_MS;
        }
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    }

    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { brief, scan, judge, lens, digest, date, forDate, session, createdAt, publishedAt, message, schemaVersion, publisherVersion, interpretiveProvider, operatorPacket, publisherEvidenceState, publisherEvidenceDetail, state, err };
}

// Legacy fallback: split a combined markdown digest into its forward (terrain) + backward
// (scan + judgment) halves on the ═-rule the generator joins them with. Used only when an
// old event (pre-structured-meta) is the latest one; the next sentinel run supersedes it.
export function splitDigest(digest: string): { terrain: string; scan: string } {
  const parts = digest.split(/\n[═]{3,}\n/);
  if (parts.length >= 2) return { terrain: parts[0].trim(), scan: parts.slice(1).join("\n").trim() };
  return { terrain: "", scan: digest.trim() };
}
