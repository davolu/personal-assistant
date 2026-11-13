"use client";

import { useEffect, useState } from "react";
import { isTextEntry, measureKeyboard, type KeyboardMeasure } from "@/components/mobile-viewport";

const CLOSED: KeyboardMeasure = {
  open: false,
  inset: 0,
  top: 0,
  height: 0,
  baselineWidth: 0,
  baselineHeight: 0,
};

let snapshot: KeyboardMeasure = CLOSED;
let focused = false;
let listening = false;
let blurTimer = 0;
const listeners = new Set<(next: KeyboardMeasure) => void>();

function apply(next: KeyboardMeasure) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (next.open) {
    root.dataset.keyboard = "open";
    root.style.setProperty("--vv-top", `${next.top}px`);
    root.style.setProperty("--vv-height", `${Math.max(next.height, 1)}px`);
    return;
  }
  if (root.dataset.keyboard) delete root.dataset.keyboard;
  root.style.removeProperty("--vv-top");
  root.style.removeProperty("--vv-height");
}

function sync() {
  if (typeof window === "undefined") return;
  const viewport = window.visualViewport;
  const next = measureKeyboard({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
    baselineWidth: snapshot.baselineWidth,
    baselineHeight: snapshot.baselineHeight,
    focused,
  });
  snapshot = next;
  apply(next);
  listeners.forEach((listener) => listener(next));
}

function scrollFieldIntoView(target: HTMLElement) {
  const transcript = document.querySelector("[data-transcript]");
  if (target.closest("[data-composer]")) {
    if (transcript instanceof HTMLElement) transcript.scrollTop = transcript.scrollHeight;
    return;
  }
  target.scrollIntoView({ block: "center", inline: "nearest" });
}

function onFocusIn(event: FocusEvent) {
  window.clearTimeout(blurTimer);
  if (!isTextEntry(event.target)) return;
  focused = true;
  sync();
  const target = event.target;
  if (target instanceof HTMLElement) requestAnimationFrame(() => scrollFieldIntoView(target));
}

function onFocusOut() {
  window.clearTimeout(blurTimer);
  blurTimer = window.setTimeout(() => {
    focused = isTextEntry(document.activeElement);
    sync();
  }, 60);
}

function ensure() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  sync();
}

export function useMobileViewport(): KeyboardMeasure {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    ensure();
    listeners.add(setState);
    setState(snapshot);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
