"use client";

// RACK — the modular-panel primitive (909-redesign; operator 07-03: "perhaps
// this ability needs to be (mostly) global"). Two columns of panels; drag the
// ⠿ grip in a panel's corner to re-rack it within/between columns. Order is a
// LOCAL preference (localStorage, available signed-out — it's layout, not desk
// config). A saved order merges with the defaults so newly-shipped panels
// still appear under an old key, and unknown keys are dropped.
//
// Desktop-only by usage (mobile stacks single-column); rooms: PLAY live book,
// TAPE, OPS.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Cols = { a: string[]; b: string[] };

function RackItem({ id, optional, children }: { id: string; optional?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={`rack-item${optional ? " rack-item--optional" : ""}${isDragging ? " dragging" : ""}`}
    >
      <button type="button" className="rack-grip" {...attributes} {...listeners} title="drag to re-rack this panel" aria-label={`move ${id} panel`}>⠿</button>
      {children}
    </div>
  );
}

function RackColumn({ colId, className, items, optional, panels }: {
  colId: "a" | "b";
  className: string;
  items: string[];
  optional: string[];
  panels: Record<string, ReactNode>;
}) {
  const { setNodeRef } = useDroppable({ id: `col-${colId}` });
  return (
    <div ref={setNodeRef} className={className}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        {items.map((k) => (
          <RackItem key={k} id={k} optional={optional.includes(k)}>
            {panels[k]}
          </RackItem>
        ))}
      </SortableContext>
    </div>
  );
}

export function Rack({
  storageKey,
  defaults,
  panels,
  optional = [],
  gridClass = "grid grid--live",
  colAClass = "col col--fill",
  colBClass = "col",
}: {
  /** localStorage key for this rack's saved order */
  storageKey: string;
  defaults: Cols;
  panels: Record<string, ReactNode>;
  /** items hidden when they render no .panel (e.g. Net Exposure when flat) */
  optional?: string[];
  gridClass?: string;
  colAClass?: string;
  colBClass?: string;
}) {
  const [rack, setRack] = useState<Cols>(defaults);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(storageKey);
      if (s) {
        const p = JSON.parse(s) as Cols;
        if (Array.isArray(p?.a) && Array.isArray(p?.b)) {
          // merge: drop unknown keys, append newly-shipped defaults to their home column
          const known = new Set(Object.keys(panels));
          const seen = new Set([...p.a, ...p.b]);
          const a = p.a.filter((k) => known.has(k));
          const b = p.b.filter((k) => known.has(k));
          for (const k of defaults.a) if (!seen.has(k) && known.has(k)) a.push(k);
          for (const k of defaults.b) if (!seen.has(k) && known.has(k)) b.push(k);
          setRack({ a, b });
        }
      }
    } catch { /* */ }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!loaded.current) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(rack)); } catch { /* */ }
  }, [rack, storageKey]);

  const colOf = (id: string): "a" | "b" | null =>
    id === "col-a" || rack.a.includes(id) ? "a" : id === "col-b" || rack.b.includes(id) ? "b" : null;
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = colOf(String(active.id));
    const to = colOf(String(over.id));
    if (!from || !to || from === to) return;
    setRack((r) => {
      const src = r[from].filter((x) => x !== String(active.id));
      const dst = [...r[to]];
      const overIdx = dst.indexOf(String(over.id));
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, String(active.id));
      return { ...r, [from]: src, [to]: dst };
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const col = colOf(String(active.id));
    if (!col) return;
    setRack((r) => {
      const from = r[col].indexOf(String(active.id));
      const to = r[col].indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to) return r;
      return { ...r, [col]: arrayMove(r[col], from, to) };
    });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    // stable id — dnd-kit's auto ids are SSR-nondeterministic with multiple contexts
    <DndContext id={`rack-${storageKey}`} sensors={sensors} collisionDetection={closestCenter} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className={gridClass}>
        <RackColumn colId="a" className={colAClass} items={rack.a} optional={optional} panels={panels} />
        <RackColumn colId="b" className={colBClass} items={rack.b} optional={optional} panels={panels} />
      </div>
    </DndContext>
  );
}
