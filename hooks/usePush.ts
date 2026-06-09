"use client";

import { useCallback, useEffect, useState } from "react";

// Web-push enable flow for the manual-exit alerts. Registers /sw.js, requests
// permission (must be a user gesture — and on iOS the app must be an installed PWA),
// subscribes with the VAPID public key, and POSTs the subscription to the backend.
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlB64ToUint8(base64: string): BufferSource {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "loading" | "unsupported" | "noconfig" | "off" | "denied" | "working" | "on" | "error";

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) { setState("unsupported"); return; }
    if (!VAPID) { setState("noconfig"); return; }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) setState("on");
        else setState(Notification.permission === "denied" ? "denied" : "off");
      } catch { setState("off"); }
    })();
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported || !VAPID) { setState(VAPID ? "unsupported" : "noconfig"); return; }
    setState("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID) });
      const r = await fetch("/api/push-subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
      setState(r.ok ? "on" : "error");
    } catch { setState("error"); }
  }, [supported]);

  return { state, enable };
}
