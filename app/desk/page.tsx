"use client";

import "../console.css";
import { DeskProvider } from "@/components/console/DeskProvider";
import { DeskScreen } from "@/components/console/DeskScreen";

export default function DeskPage() {
  return (
    <div className="console-root">
      <DeskProvider>
        <DeskScreen />
      </DeskProvider>
    </div>
  );
}
