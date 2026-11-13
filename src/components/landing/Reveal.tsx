"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"show" | "wait" | "in">("show");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("in");
      return;
    }
    const visible = () => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
    };
    if (visible()) {
      setMode("in");
      return;
    }
    setMode("wait");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMode("in");
        observer.disconnect();
      },
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const state = mode === "wait" ? "ld-wait" : mode === "in" ? "ld-in" : "";
  return (
    <div ref={ref} className={`ld-reveal ${state} ${className}`}>
      {children}
    </div>
  );
}
