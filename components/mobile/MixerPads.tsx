"use client";

import { useEffect, useRef } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pmVar } from "@/lib/desk/colors";
import type { StrategistState } from "@/lib/desk/types";

// 2–3 char code from the channel name (initials, else first chars) for the small pad.
// Strip punctuation first so e.g. "Trend QQQ (trailed)" → TQT, not "TQ(".
// Exported: the bench rail (86'd shelf) renders the same codes on both surfaces.
export function padCode(s: StrategistState): string {
  const parts = s.name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = parts.map((w) => w[0]).join("");
  return (initials.length >= 2 ? initials : parts[0] || s.slug).slice(0, 3).toUpperCase();
}

function Pad({ s, focused, canWrite, onJump }: { s: StrategistState; focused: boolean; canWrite: boolean; onJump: (slug: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.slug });
  // swallow the click iOS/dnd-kit synthesizes AFTER a completed drag — without
  // this a successful reorder also jumps the carousel, which reads as a glitch.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{ transform: CSS.Transform.toString(transform), transition, ["--pad" as string]: pmVar(s.color) }}
      className={`mx-pad${focused ? " on" : ""}${s.config.muted ? " muted" : ""}${s.config.soloed ? " solo" : ""}${isDragging ? " dragging" : ""}`}
      onClick={() => {
        if (dragged.current) { dragged.current = false; return; }
        onJump(s.slug);
      }}
      title={`${s.name} — tap to view, hold ¼s to reorder${canWrite ? "" : " (this session only — sign in to save the order)"}`}
      {...attributes}
      {...listeners}
    >
      {padCode(s)}
    </button>
  );
}

// The master mixer: every channel as a small colored pad. Tap → jump the grid to that
// channel; press-and-HOLD (~250ms) → drag to reorder. The drag is NEVER auth-gated —
// the REORDER dispatch is optimistic-local, so it always responds; the DB sort_order
// write inside persist() is what silently no-ops for anon (order reverts on reload).
// A disabled sortable gives ZERO feedback on a phone, which reads as "drag is broken".
export function MixerPads({
  strategists, focusedSlugs, onJump, persist, canWrite,
}: {
  strategists: StrategistState[];
  focusedSlugs: string[];
  onJump: (slug: string) => void;
  persist: (order: string[]) => void;
  canWrite: boolean;
}) {
  const order = strategists.map((s) => s.slug);
  // ONE sensor. PointerSensor covers mouse + touch + pen via pointer events —
  // registering it alongside TouchSensor (the original setup) double-fires on iOS
  // and the hold-drag never activates; Mouse+Touch also proved flaky on-device.
  // delay 250/tolerance 15 = a deliberate quarter-second hold with finger wobble room.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 15 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const from = order.indexOf(String(e.active.id));
    const to = e.over ? order.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    persist(arrayMove(order, from, to));
  };
  return (
    <div className="mx-mixer">
      <div className="mx-bar">
        <span className="mx-title">Mixer</span>
      </div>
      <DndContext id="mixer-pads" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
          <div className="mx-pads">
            {strategists.map((s) => (
              <Pad key={s.slug} s={s} focused={focusedSlugs.includes(s.slug)} canWrite={canWrite} onJump={onJump} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
