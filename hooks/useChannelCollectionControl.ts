"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface ChannelCollectionInventoryView {
  channelId: string;
  channelSlug: string;
  executionPosture: "paper" | "observe-only";
  collectionState: "active" | "paused" | "archived";
  currentReceiptId: string;
}

interface CullPreview {
  previewHash: string;
  changes: Array<{
    channelId: string;
    channelSlug: string;
    before: string;
    after: string;
  }>;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  guarantees: Record<string, boolean>;
}

export function useChannelCollectionControl() {
  const { session, operator } = useAuth();
  const [inventory, setInventory] = useState<ChannelCollectionInventoryView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"pause" | "resume">("pause");
  const [preview, setPreview] = useState<CullPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const applyRequestId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !operator) {
      setInventory([]);
      return;
    }
    try {
      const response = await fetch("/api/channel-collection-state", {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        inventory?: ChannelCollectionInventoryView[];
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "collection inventory read failed");
      }
      setInventory(body.inventory ?? []);
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error
        ? readError.message
        : "collection inventory read failed");
    }
  }, [operator, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cullable = useMemo(() => inventory.filter((item) =>
    item.executionPosture === "observe-only"
      && item.collectionState === "active"), [inventory]);
  const resumable = useMemo(() => inventory.filter((item) =>
    item.executionPosture === "observe-only"
      && item.collectionState === "paused"), [inventory]);
  const eligible = mode === "pause" ? cullable : resumable;

  const changes = useMemo(() => eligible
    .filter((item) => selected.has(item.channelId))
    .map((item) => ({
      channelId: item.channelId,
      targetState: mode === "pause" ? "paused" : "active",
      reason: mode === "pause"
        ? "Pause non-executing research collection after operator swarm-cull review."
        : "Resume non-executing research collection after operator review.",
      evidenceRefs: [
        `operator:collection-cull:${item.channelSlug}`,
        `collection-base-receipt:${item.currentReceiptId}`,
      ],
    })), [eligible, mode, selected]);

  const request = useCallback(async (
    action: "preview" | "apply",
    previewHash?: string,
    requestId = crypto.randomUUID(),
  ) => {
    if (!session || !operator) throw new Error("operator sign-in is required");
    const response = await fetch("/api/channel-collection-state", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        "idempotency-key": requestId,
      },
      body: JSON.stringify({
        action,
        changes,
        ...(previewHash ? { previewHash } : {}),
      }),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      error?: string;
      preview?: CullPreview;
    };
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? "collection request failed");
    }
    return body;
  }, [changes, operator, session]);

  const previewCull = useCallback(async () => {
    if (!changes.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = await request("preview");
      setPreview(body.preview ?? null);
      applyRequestId.current = crypto.randomUUID();
      setNotice("Read-only cull preview ready. Execution and history remain unchanged.");
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "collection preview failed");
    } finally {
      setBusy(false);
    }
  }, [changes.length, request]);

  const applyCull = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request(
        "apply",
        preview.previewHash,
        applyRequestId.current ?? crypto.randomUUID(),
      );
      setNotice("Append-only collection receipts applied. Execution state was not changed.");
      setSelected(new Set());
      setPreview(null);
      applyRequestId.current = null;
      await refresh();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "collection apply failed");
    } finally {
      setBusy(false);
    }
  }, [preview, refresh, request]);

  const toggle = (channelId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
    setPreview(null);
    applyRequestId.current = null;
  };

  return {
    inventory,
    cullable,
    resumable,
    eligible,
    mode,
    selected,
    preview,
    busy,
    error,
    notice,
    signedIn: Boolean(session && operator),
    toggle,
    setMode: (next: "pause" | "resume") => {
      setMode(next);
      setSelected(new Set());
      setPreview(null);
      applyRequestId.current = null;
    },
    selectAll: () => {
      setSelected(new Set(eligible.map((item) => item.channelId)));
      setPreview(null);
      applyRequestId.current = null;
    },
    clear: () => {
      setSelected(new Set());
      setPreview(null);
      applyRequestId.current = null;
    },
    previewCull,
    applyCull,
  };
}
