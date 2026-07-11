"use client";

// /incident-preview — DEV-ONLY deterministic fixture harness for the slice-3 incident banner + health
// strip (all severities). Production-gated (renders 404 in prod). NO production data, NO hooks, NO
// mutation. For independent visual/DOM review. Not linked from the app; navigate directly in dev.

import { notFound } from "next/navigation";
import "@/app/shell.css";
import "@/app/perform.css";
import "@/app/incident.css";
import { IncidentBanner } from "@/components/perform/IncidentBanner";
import { SystemHealthStrip } from "@/components/perform/SystemHealthStrip";
import { devIncidentFixture, DEV_SEVERITIES } from "@/lib/incident/devFixture";

const LABELS: Record<string, string> = {
  normal: "NORMAL (banner hidden; health strip shows)",
  checking: "CHECKING (loading — no health claim)",
  warning: "WARNING (compact, no toggle)",
  high: "HIGH (expanded, collapsible)",
  critical: "CRITICAL (always expanded; pre-empts chart)",
};

export default function IncidentPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="console-root" data-theme="blackout" style={{ minHeight: "100vh", padding: 24 }}>
      <div className="shell-root" data-mode="perform" data-skin="blackout" data-density="normal">
        <h1 style={{ fontFamily: "var(--sh-mono)", fontSize: 15, color: "var(--lcd-ink)", marginBottom: 4 }}>Incident preview — deterministic fixtures (dev only)</h1>
        <p style={{ fontFamily: "var(--sh-mono)", fontSize: 11, color: "var(--dk-mut)", marginBottom: 20 }}>slice-3 banner + system-health strip · not production data</p>
        {DEV_SEVERITIES.map((sev) => {
          const incident = devIncidentFixture(sev);
          return (
            <section key={sev} data-fixture={sev} style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: "var(--sh-mono)", fontSize: 11, color: "var(--dk-mut)", marginBottom: 6, letterSpacing: "0.04em" }}>{LABELS[sev]}</div>
              <div className="perform" data-incident={sev} style={{ border: "1px dashed var(--sep-line)", borderRadius: 12, padding: 12, minHeight: "auto", height: "auto", display: "block" }}>
                <IncidentBanner incident={incident} />
                <aside className="pf-rail" style={{ maxWidth: 380 }}>
                  <SystemHealthStrip incident={incident} />
                </aside>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
