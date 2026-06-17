import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";

export const metadata: Metadata = {
  title: "$EVE — Live Market Monitor",
  description:
    "Read-only live window over the SEVE paper-trading desk: SPY 0DTE/1DTE option tape.",
  manifest: "/manifest.webmanifest",
  // standalone PWA — required for iOS web-push (the manual-exit alerts).
  appleWebApp: { capable: true, title: "SEVE", statusBarStyle: "black-translucent" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* IBM Plex Sans + JetBrains Mono — same fonts as the reference.
            Inter (800) is the cream-TE wordmark face (see --wordmark). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@600;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          {/* NavBar retired in the cream-TE redesign — the persistent Shell owns the
              wordmark + room tabs; sign-in moves to the OPS room (F6 / P3-ops). */}
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
