"use client";

import { useEffect, useRef } from "react";
import { eventLine, type RunEvent } from "@/lib/run-stream";

export default function LiveRunFeed({ events }: { events: RunEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events.length]);

  const lines = events.map(eventLine).filter((l): l is NonNullable<ReturnType<typeof eventLine>> => l !== null);
  if (lines.length === 0) return null;

  return (
    <div
      ref={ref}
      className="max-h-56 overflow-y-auto rounded-xl border border-line bg-ink p-4 font-mono text-xs leading-relaxed"
    >
      {lines.map((l, i) => (
        <p
          key={i}
          className={
            l.tone === "ok" ? "text-mint" : l.tone === "err" ? "text-accent" : "text-ground/70"
          }
        >
          <span className="mr-2 inline-block w-4 text-center">{l.icon}</span>
          {l.text}
        </p>
      ))}
    </div>
  );
}
