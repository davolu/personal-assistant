/** A short tap when the device exposes the vibration API. Never throws. */
export function hapticTap(nav: { vibrate?: (ms: number) => boolean | void } | null | undefined): void {
  try {
    if (nav && typeof nav.vibrate === "function") nav.vibrate(10);
  } catch {
    // Some browsers expose vibrate and then reject it.
  }
}
