"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

export function HeroStage({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia(REDUCE);
    const nodes = () => [...root.querySelectorAll<HTMLElement>("[data-parallax]")];
    const clear = () => {
      for (const node of nodes()) node.style.transform = "";
    };
    if (reduce.matches) {
      clear();
      const onChange = () => {
        if (reduce.matches) clear();
      };
      reduce.addEventListener("change", onChange);
      return () => reduce.removeEventListener("change", onChange);
    }

    let frame = 0;
    let watching = false;
    const update = () => {
      frame = 0;
      const rect = root.getBoundingClientRect();
      const travel = Math.min(160, Math.max(0, -rect.top));
      const progress = travel / 160;
      for (const node of nodes()) {
        const depth = Number(node.dataset.parallax) || 0;
        node.style.transform = `translate3d(0, ${(progress * depth).toFixed(2)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (!watching || frame) return;
      frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      watching = Boolean(entry?.isIntersecting);
      if (watching) update();
    });
    observer.observe(root);
    window.addEventListener("scroll", onScroll, { passive: true });
    const rect = root.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      watching = true;
      update();
    }
    const onChange = () => {
      if (!reduce.matches) return;
      watching = false;
      clear();
    };
    reduce.addEventListener("change", onChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
      reduce.removeEventListener("change", onChange);
    };
  }, []);

  return (
    <div ref={ref} className={className} aria-hidden="true">
      {children}
    </div>
  );
}

export function Float({ depth, className, children }: { depth: number; className?: string; children: ReactNode }) {
  return (
    <div className={className} data-parallax={depth}>
      {children}
    </div>
  );
}
