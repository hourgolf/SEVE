"use client";

import "../console.css";
import { DeskProvider } from "@/components/console/DeskProvider";
import { Console } from "@/components/console/Console";

export default function ConsolePage() {
  return (
    <div className="console-root">
      <DeskProvider>
        <Console />
      </DeskProvider>
    </div>
  );
}
