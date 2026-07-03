"use client";

import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
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

function Pad({ s, focused, sortable, onJump }: { s: StrategistState; focused: boolean; sortable: boolean; onJump: (slug: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.slug, disabled: !sortable });
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{ transform: CSS.Transform.toString(transform), transition, ["--pad" as string]: pmVar(s.color) }}
      className={`mx-pad${focused ? " on" : ""}${s.config.muted ? " muted" : ""}${s.config.soloed ? " solo" : ""}${isDragging ? " dragging" : ""}`}
      onClick={() => onJump(s.slug)}
      title={`${s.name} — tap to view, hold to reorder`}
      {...attributes}
      {...listeners}
    >
      {padCode(s)}
    </button>
  );
}

// The master mixer: every channel as a small colored pad. Tap → jump the grid to that
// channel; press-and-hold → drag to reorder (persists via the shared ordering hook).
// Reorder + group-by are operator-gated; tap-to-jump always works.
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
  // delay activation so a quick TAP fires onClick (jump) and a press-HOLD starts the
  // drag. Mouse+Touch (NOT Pointer+Touch): registering PointerSensor alongside
  // TouchSensor double-fires on iOS and the hold-drag never activates — the dnd-kit
  // mixed-input combo is Mouse for desktop + Touch (longer delay) for fingers.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 10 } }),
  );
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
              <Pad key={s.slug} s={s} focused={focusedSlugs.includes(s.slug)} sortable={canWrite} onJump={onJump} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
