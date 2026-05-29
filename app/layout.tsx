import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEVE — Live Market Monitor",
  description:
    "Read-only live window over the SEVE paper-trading desk: SPY 0DTE/1DTE option tape.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* IBM Plex Sans + JetBrains Mono — same fonts as the reference. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
