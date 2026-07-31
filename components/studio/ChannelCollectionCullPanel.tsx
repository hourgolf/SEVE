"use client";

import { useChannelCollectionControl } from "@/hooks/useChannelCollectionControl";

export function ChannelCollectionCullPanel() {
  const control = useChannelCollectionControl();
  if (!control.signedIn) return null;
  return (
    <details className="collection-cull">
      <summary>
        <span><b>RESEARCH COLLECTION CULL</b><small>independent of paper execution</small></span>
        <em>{control.cullable.length} ACTIVE · {control.resumable.length} PAUSED</em>
        <i aria-hidden="true">▾</i>
      </summary>
      <div>
        <header>
          <p>Select only non-executing channels. The preview cannot change routes, economics, orders, active manifests, or historical evidence.</p>
          <span>
            <button type="button" disabled={control.busy} onClick={() => control.setMode("pause")}>PAUSE</button>
            <button type="button" disabled={control.busy} onClick={() => control.setMode("resume")}>RESUME</button>
            <button type="button" disabled={!control.eligible.length || control.busy} onClick={control.selectAll}>SELECT ALL</button>
            <button type="button" disabled={!control.selected.size || control.busy} onClick={control.clear}>CLEAR</button>
          </span>
        </header>
        <div className="collection-cull-grid">
          {control.eligible.map((item) => <label key={item.channelId}>
            <input
              type="checkbox"
              checked={control.selected.has(item.channelId)}
              disabled={control.busy}
              onChange={() => control.toggle(item.channelId)}
            />
            <b>{item.channelSlug}</b>
            <small>{item.collectionState} · execution observe-only</small>
          </label>)}
        </div>
        <footer>
          {!control.preview ? <button
            type="button"
            disabled={!control.selected.size || control.busy}
            onClick={() => void control.previewCull()}
          >
            PREVIEW {control.selected.size} COLLECTION {control.mode.toUpperCase()}{control.selected.size === 1 ? "" : "S"}
          </button> : <button
            type="button"
            disabled={control.busy}
            onClick={() => void control.applyCull()}
          >
            APPLY {control.preview.changes.length} APPEND-ONLY RECEIPT{control.preview.changes.length === 1 ? "" : "S"}
          </button>}
          {control.preview && <span>
            ACTIVE {control.preview.beforeCounts.active} → {control.preview.afterCounts.active}
            {" · "}HISTORY PRESERVED
          </span>}
          {control.notice && <p>{control.notice}</p>}
          {control.error && <p className="error">{control.error}</p>}
        </footer>
      </div>
    </details>
  );
}
