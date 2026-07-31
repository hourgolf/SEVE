"use client";

import { useEffect, useState } from "react";
import type { ChannelConfigDraftModel } from "@/lib/channels/channelConfigDraft";
import "@/app/channel-draft.css";

export function ChannelConfigDraftPanel({ model, active, canStart, onStart, onDiscard, canSeal = false, sealBusy = false, sealReason, sealNotice, sealError, onSeal, compact = false }: {
  model: ChannelConfigDraftModel | null;
  active: boolean;
  canStart: boolean;
  onStart: () => void;
  onDiscard: () => void;
  canSeal?: boolean;
  sealBusy?: boolean;
  sealReason?: string | null;
  sealNotice?: string | null;
  sealError?: string | null;
  onSeal?: () => void;
  compact?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setCopyState("idle"), [model?.canonicalJson]);
  if (!model) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(model.canonicalJson);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  if (!active) return <section className={`channel-draft-launch${compact ? " compact" : ""}`}>
    <span><b>FUTURE CONFIGURATION EPOCH</b><small>tune locally · review · seal later · RC5 remains unchanged</small></span>
    <button type="button" disabled={!canStart} onClick={onStart}>{canStart ? "FORK DRAFT" : "SIGN IN TO FORK"}</button>
  </section>;

  return <section className={`channel-draft-panel ${model.state}${compact ? " compact" : ""}`} aria-label="Unsealed channel configuration draft">
    <header><span><b>UNSEALED LOCAL DRAFT</b><small>{model.slug} · {model.diffs.length} proposed change{model.diffs.length === 1 ? "" : "s"}</small></span><em>{model.state.toUpperCase()}</em></header>
    <div className="channel-draft-diffs">{model.diffs.length ? model.diffs.map((diff) => <span key={diff.key}><small>{diff.label}</small><b>{diff.before}</b><i>→</i><strong>{diff.after}</strong></span>) : <p>Move a configuration control to create a reviewable diff.</p>}</div>
    <div className="channel-draft-issues">{model.issues.map((issue) => <p key={`${issue.key}:${issue.message}`} className={issue.tone}>{issue.message}</p>)}</div>
    <footer>
      <button type="button" disabled={model.state === "empty"} onClick={copy}>{copyState === "copied" ? "COPIED" : copyState === "failed" ? "COPY FAILED" : "COPY REVIEW RECEIPT"}</button>
      {onSeal && <button type="button" disabled={!canSeal || sealBusy} onClick={onSeal}>{sealBusy ? "SEALING…" : "SEAL GOVERNED PROPOSAL"}</button>}
      <button type="button" onClick={onDiscard}>DISCARD</button>
      <span>{sealReason ?? "NO DIRECT APPLY AUTHORITY"}</span>
      {sealNotice && <p>{sealNotice}</p>}
      {sealError && <p className="error">{sealError}</p>}
    </footer>
  </section>;
}
