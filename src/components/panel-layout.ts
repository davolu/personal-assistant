export type PanelEdge = "left" | "right";

export type PanelPrefs = {
  width: number;
  collapsed: boolean;
};

export function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function readPanelPrefs(raw: string | null, fallback: PanelPrefs, min: number, max: number): PanelPrefs {
  if (!raw) return { width: clampWidth(fallback.width, min, max), collapsed: fallback.collapsed };
  try {
    const parsed = JSON.parse(raw) as { width?: unknown; collapsed?: unknown };
    const width = typeof parsed.width === "number" ? parsed.width : fallback.width;
    const collapsed = typeof parsed.collapsed === "boolean" ? parsed.collapsed : fallback.collapsed;
    return { width: clampWidth(width, min, max), collapsed };
  } catch {
    return { width: clampWidth(fallback.width, min, max), collapsed: fallback.collapsed };
  }
}

/** Signed pointer delta. A right edge grows when the pointer moves right; a left edge grows when it moves left. */
export function nextWidthFromPointer(startWidth: number, deltaX: number, edge: PanelEdge, min: number, max: number): number {
  const signed = edge === "right" ? deltaX : -deltaX;
  return clampWidth(startWidth + signed, min, max);
}

/** Arrow keys resize the focused handle. Home and End jump to the limits. Shift uses a larger step. */
export function keyResize(width: number, key: string, edge: PanelEdge, min: number, max: number, shift: boolean): number | null {
  if (key === "Home") return min;
  if (key === "End") return max;
  const step = shift ? 48 : 16;
  const grow = edge === "right" ? "ArrowRight" : "ArrowLeft";
  const shrink = edge === "right" ? "ArrowLeft" : "ArrowRight";
  if (key === grow) return clampWidth(width + step, min, max);
  if (key === shrink) return clampWidth(width - step, min, max);
  return null;
}

export function resetWidth(defaultWidth: number, min: number, max: number): number {
  return clampWidth(defaultWidth, min, max);
}
