"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"show" | "wait" | "in">("show");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia(REDUCE);
    const show = () => setMode("in");
    if (reduce.matches) {
      show();
      const onChange = () => {
        if (reduce.matches) show();
      };
      reduce.addEventListener("change", onChange);
      return () => reduce.removeEventListener("change", onChange);
    }

    let observer: IntersectionObserver | null = null;
    const enter = () => {
      setMode("in");
      observer?.disconnect();
    };
    const visible = () => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.88 && rect.bottom > 32;
    };

    if (visible()) {
      enter();
    } else {
      setMode("wait");
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          enter();
        },
        { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
      );
      observer.observe(el);
    }

    const onChange = () => {
      if (!reduce.matches) return;
      enter();
    };
    reduce.addEventListener("change", onChange);
    return () => {
      observer?.disconnect();
      reduce.removeEventListener("change", onChange);
    };
  }, []);

  const state = mode === "wait" ? "ld-wait" : mode === "in" ? "ld-in" : "";
  return <div ref={ref} className={`ld-reveal ${state} ${className}`.trim()}>{children}</div>;
}
