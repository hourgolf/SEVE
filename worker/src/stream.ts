// ============================================================================
//  Alpaca stock-bar websocket — the always-on heart of the streaming driver.
//  Holds a persistent socket (which Supabase edge fns / Vercel structurally
//  can't), authenticates, subscribes to SPY minute bars, and fires onBar() the
//  instant a bar closes — zero cron lag. Auto-reconnects with reseed.
//
//  Feed-selectable: "iex" (free, runs NOW) → "sip" (real-time, Algo Trader
//  Plus). v1 consumes completed minute bars (`b.SPY`); the trade stream (`t.SPY`,
//  for sub-minute / live forming bars) is a Phase C option.
// ============================================================================

import WebSocket from "ws";
import { config } from "./config.js";
import { info, warn, error } from "./log.js";
import type { Bar } from "../../engine/types";

const WS_BASE = "wss://stream.data.alpaca.markets/v2";

// RTH (Mon–Fri 09:30–16:00 ET). Bars only stream during the session, so the
// stale-socket watchdog must fire ONLY then — off-hours the socket is idle by
// design (no bars), not dead, and forcing reconnects just churns (and risks
// Alpaca's single-connection 406 on each reconnect).
const ET_RTH = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
function isRthNow(): boolean {
  const p: Record<string, string> = {};
  for (const x of ET_RTH.formatToParts(new Date())) p[x.type] = x.value;
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const min = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return min >= 570 && min < 960;
}

interface RawBar { T: string; S: string; o: number; h: number; l: number; c: number; v: number; vw?: number; t: string; }

export class StockBarStream {
  private ws: WebSocket | null = null;
  private retry = 0;
  private alive = false;
  private closing = false;
  private lastMsgMs = 0;
  private hbTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly symbol: string,
    private readonly onBar: (bar: Bar) => void,
    private readonly onReconnect: () => void,
  ) {}

  start(): void {
    this.closing = false;
    this.connect();
    // Heartbeat / stale-socket watchdog: if no message for 90s during what should
    // be an active socket, force a reconnect (Alpaca pushes frequently).
    this.hbTimer = setInterval(() => {
      if (this.alive && isRthNow() && this.lastMsgMs && Date.now() - this.lastMsgMs > 90_000) {
        warn("stream: no bars for >90s during RTH — forcing reconnect");
        this.ws?.terminate();
      }
    }, 30_000);
  }

  stop(): void {
    this.closing = true;
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.ws?.close();
  }

  private connect(): void {
    const url = `${WS_BASE}/${config.stockFeed}`;
    info(`stream: connecting ${url} (feed=${config.stockFeed})`);
    const ws = new WebSocket(url);
    this.ws = ws;

    // Alpaca's handshake: the server sends {success,connected} first, THEN we
    // auth (see handle()). Authing on open too would double-auth → 403.
    ws.on("open", () => info("stream: socket open — awaiting connected"));

    ws.on("message", (data: WebSocket.RawData) => {
      this.lastMsgMs = Date.now();
      let msgs: any[];
      try { msgs = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(msgs)) return;
      for (const m of msgs) this.handle(m);
    });

    ws.on("error", (e: Error) => error(`stream: socket error — ${e.message}`));

    ws.on("close", (code: number) => {
      this.alive = false;
      if (this.closing) { info("stream: closed (shutdown)"); return; }
      this.retry++;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retry, 5));
      warn(`stream: closed (code ${code}) — reconnecting in ${delay}ms (attempt ${this.retry})`);
      setTimeout(() => this.connect(), delay);
    });
  }

  private handle(m: any): void {
    switch (m.T) {
      case "success":
        if (m.msg === "connected") {
          this.ws?.send(JSON.stringify({ action: "auth", key: config.alpacaKey, secret: config.alpacaSecret }));
        } else if (m.msg === "authenticated") {
          info("stream: authenticated — subscribing bars");
          this.ws?.send(JSON.stringify({ action: "subscribe", bars: [this.symbol] }));
        }
        break;
      case "subscription":
        info("stream: subscribed", { bars: m.bars });
        // A (re)subscription means the socket is live again. After the very first
        // connect this is a reconnect → reseed in-memory state from REST.
        if (this.alive) this.onReconnect();
        this.alive = true;
        this.retry = 0;
        break;
      case "error":
        // 406 = subscription not permitted (e.g. sip without the data sub).
        error(`stream: alpaca error ${m.code} — ${m.msg}`);
        break;
      case "b": {
        const b = m as RawBar;
        if (b.S !== this.symbol) return;
        this.onBar({
          ts: Date.parse(b.t),
          open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c),
          volume: Number(b.v ?? 0), vwap: Number(b.vw ?? b.c),
        });
        break;
      }
      default:
        break; // ignore quotes/trades/etc. (not subscribed in v1)
    }
  }
}
