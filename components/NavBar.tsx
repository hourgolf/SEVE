"use client";

import { AuthControl } from "@/components/AuthControl";

// Slim utility strip above the single TR-909 surface: brand + auth. (The desk is
// one page now, so there are no view tabs — in-chassis anchors handle sections.)
export function NavBar() {
  return (
    <nav className="nav">
      <span className="nav-brand">≣ SEVE</span>
      <span className="nav-spacer" />
      <AuthControl />
    </nav>
  );
}
