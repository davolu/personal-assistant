"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { clampWidth, keyResize, nextWidthFromPointer, readPanelPrefs, resetWidth, type PanelEdge, type PanelPrefs } from "./panel-layout";

export const PANEL_RAIL = 48;

export type PanelControls = {
  collapsed: boolean;
  toggleButton: ReactNode;
};

type Props = {
  storageKey: string;
  label: string;
  edge: PanelEdge;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  className: string;
  marker?: "desktop";
  children: (controls: PanelControls) => ReactNode;
};

export function DesktopPanel({ storageKey, label, edge, defaultWidth, minWidth, maxWidth, className, marker, children }: Props) {
  const [prefs, setPrefs] = useState<PanelPrefs>({ width: defaultWidth, collapsed: false });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [resizing, setResizing] = useState(false);
  const hydrated = useRef(false);
  const dragCleanup = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    hydrated.current = true;
    setPrefs(readPanelPrefs(window.localStorage.getItem(storageKey), { width: defaultWidth, collapsed: false }, minWidth, maxWidth));
    return () => {
      dragCleanup.current?.();
    };
  }, [storageKey, defaultWidth, minWidth, maxWidth]);

  function viewportMax() {
    if (typeof window === "undefined") return maxWidth;
    return Math.min(maxWidth, Math.max(minWidth, Math.round(window.innerWidth * 0.46)));
  }

  function persist(next: PanelPrefs) {
    const value = { width: clampWidth(next.width, minWidth, maxWidth), collapsed: next.collapsed };
    prefsRef.current = value;
    setPrefs(value);
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* private mode or a full disk */
    }
  }

  function toggle() {
    persist({ ...prefsRef.current, collapsed: !prefsRef.current.collapsed });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || prefsRef.current.collapsed) return;
    if (event.detail > 1) {
      dragCleanup.current?.();
      dragCleanup.current = null;
      persist({ width: resetWidth(defaultWidth, minWidth, maxWidth), collapsed: false });
      return;
    }
    const startX = event.clientX;
    const startWidth = prefsRef.current.width;
    const limit = viewportMax();
    let width = startWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizing(true);

    const move = (pointer: PointerEvent) => {
      width = nextWidthFromPointer(startWidth, pointer.clientX - startX, edge, minWidth, limit);
      const value = { width, collapsed: false };
      prefsRef.current = value;
      setPrefs(value);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      setResizing(false);
      dragCleanup.current = null;
      persist({ width, collapsed: false });
    };
    dragCleanup.current?.();
    dragCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next = keyResize(prefsRef.current.width, event.key, edge, minWidth, viewportMax(), event.shiftKey);
    if (next == null) return;
    event.preventDefault();
    persist({ width: next, collapsed: false });
  }

  const collapsed = prefs.collapsed;
  const pointsLeft = (edge === "right" && !collapsed) || (edge === "left" && collapsed);
  const bodyId = `${storageKey}-body`;
  const toggleButton = (
    <button
      type="button"
      data-panel-toggle={storageKey}
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      onClick={toggle}
      className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-ground hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Chevron direction={pointsLeft ? "left" : "right"} />
    </button>
  );

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={prefs.width}
      aria-valuetext={`${prefs.width} pixels`}
      tabIndex={0}
      data-panel-resize={storageKey}
      title="Drag to resize. Double-click to reset."
      className="panel-handle shrink-0 touch-none select-none outline-none"
      onPointerDown={onPointerDown}
      onDoubleClick={() => persist({ width: resetWidth(defaultWidth, minWidth, maxWidth), collapsed: false })}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <aside
      {...(marker === "desktop" ? { "data-desktop-panel": true } : {})}
      data-panel={storageKey}
      data-collapsed={collapsed ? "true" : "false"}
      data-resizing={resizing ? "true" : "false"}
      className={`${className} panel-shell flex-row`}
      style={{ width: collapsed ? PANEL_RAIL : prefs.width }}
    >
      {edge === "left" && !collapsed ? handle : null}
      <div id={bodyId} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {children({ collapsed, toggleButton })}
      </div>
      {edge === "right" && !collapsed ? handle : null}
    </aside>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d={direction === "left" ? "M10 3.5 5.5 8 10 12.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
