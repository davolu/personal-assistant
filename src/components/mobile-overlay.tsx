"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function MobileLayer({
  kind,
  label,
  onClose,
  children,
}: {
  kind: "drawer" | "sheet";
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  function setDragOffset(next: number) {
    offsetRef.current = next;
    setOffset(next);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, axis: null };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      const dismissAxis = kind === "drawer" ? "x" : "y";
      if (current.axis === dismissAxis) event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const dismissAxis = kind === "drawer" ? "x" : "y";
    if (current.axis !== dismissAxis) return;
    const next = kind === "drawer" ? -dx : dy;
    setDragOffset(next > 0 ? next : 0);
  }

  function endDrag() {
    drag.current = null;
    if (offsetRef.current > 96) closeRef.current();
    setDragOffset(0);
  }

  const dragging = offset > 0;
  const transform = offset > 0 ? (kind === "drawer" ? `translateX(-${offset}px)` : `translateY(${offset}px)`) : undefined;
  const pointer = kind === "drawer" ? { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag } : {};

  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-overlay className="fixed inset-0 z-[60] md:hidden" role="presentation">
      <button type="button" aria-label="Close" className="mobile-backdrop absolute inset-0 bg-ink/40" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-dragging={dragging ? "true" : "false"}
        data-drawer={kind === "drawer" ? "true" : undefined}
        data-sheet={kind === "sheet" ? "true" : undefined}
        className={
          kind === "drawer"
            ? "mobile-drawer absolute inset-y-0 left-0 flex w-[min(86vw,20rem)] max-w-full touch-pan-y flex-col bg-panel shadow-[var(--shadow-card)] outline-none"
            : "mobile-sheet absolute inset-x-0 bottom-0 flex max-h-[min(85dvh,40rem)] flex-col rounded-t-3xl border border-line bg-panel shadow-[var(--shadow-card)] outline-none"
        }
        style={{
          transform,
          paddingTop: kind === "drawer" ? "env(safe-area-inset-top)" : undefined,
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
        {...pointer}
      >
        {kind === "sheet" && (
          <div
            data-sheet-handle
            className="flex shrink-0 cursor-grab touch-none justify-center py-3"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span className="h-1.5 w-10 rounded-full bg-line" />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body
  );
}
