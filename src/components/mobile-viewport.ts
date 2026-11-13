/** Treat a height drop as a keyboard once it is clearly larger than the browser chrome. */
export const KEYBOARD_THRESHOLD = 140;

export type KeyboardMeasureInput = {
  innerWidth: number;
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  baselineWidth: number;
  baselineHeight: number;
  focused: boolean;
};

export type KeyboardMeasure = {
  open: boolean;
  inset: number;
  top: number;
  height: number;
  baselineWidth: number;
  baselineHeight: number;
};

function positive(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * Decide whether the on-screen keyboard is covering the page.
 * `dvh` does not shrink with the keyboard, and `interactive-widget=resizes-content`
 * shrinks `innerHeight` together with the visual viewport, so a raw
 * innerHeight − visualHeight delta stays near zero on Android Chrome.
 * Remember the last full-screen height and compare the visual viewport to that.
 * A rotation changes the width, so it updates the baseline instead of looking like a keyboard.
 */
export function measureKeyboard(input: KeyboardMeasureInput): KeyboardMeasure {
  const innerWidth = positive(input.innerWidth);
  const innerHeight = positive(input.innerHeight);
  const height = positive(input.visualHeight);
  const top = positive(input.offsetTop);
  const baselineWidth = positive(input.baselineWidth);
  const baselineHeight = positive(input.baselineHeight);
  const widthStable = baselineWidth === 0 || Math.abs(innerWidth - baselineWidth) < 80;
  const layoutGap = Math.max(0, innerHeight - height);
  const baselineGap = baselineHeight > 0 ? Math.max(0, baselineHeight - height) : 0;
  const open = input.focused || layoutGap > KEYBOARD_THRESHOLD || (widthStable && baselineGap > KEYBOARD_THRESHOLD);

  let nextBaselineHeight = innerHeight;
  let nextBaselineWidth = innerWidth;
  if (open) {
    nextBaselineHeight = baselineHeight > 0 ? baselineHeight : Math.max(innerHeight, height);
    nextBaselineWidth = baselineWidth > 0 ? baselineWidth : innerWidth;
    if (innerHeight > nextBaselineHeight) nextBaselineHeight = innerHeight;
  }

  return {
    open,
    inset: open ? Math.max(0, nextBaselineHeight - height) : 0,
    top,
    height,
    baselineWidth: nextBaselineWidth,
    baselineHeight: nextBaselineHeight,
  };
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = target.type;
    return type === "text" || type === "search" || type === "email" || type === "url" || type === "password" || type === "tel" || type === "number" || type === "";
  }
  return false;
}
