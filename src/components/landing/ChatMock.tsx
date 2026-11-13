"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const PROMPT = "Each weekday morning, post a short AI news digest to Slack.";
const STEPS = ["Find today's AI headlines", "Draft a short digest", "Ask before posting to Slack"];

const TYPE_AT = 250;
const TYPE_MS = 16;
const PLAN_AT = 1900;
const CONNECT_AT = 3100;
const ASK_AT = 4400;
const DONE_AT = 6000;
const LOOP_AT = 13000;

export function ChatMock() {
  const rootRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState(0);
  const [live, setLive] = useState(false);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      setPhase(5);
      setTyped(PROMPT.length);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => setLive(Boolean(entry?.isIntersecting)), { threshold: 0.15 });
    observer.observe(el);
    const onReduce = () => {
      if (!reduce.matches) return;
      setLive(false);
      setPhase(5);
      setTyped(PROMPT.length);
    };
    reduce.addEventListener("change", onReduce);
    return () => {
      observer.disconnect();
      reduce.removeEventListener("change", onReduce);
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let start = performance.now();
    let frame = 0;
    let lastPhase = -1;
    let lastTyped = -1;

    const tick = (now: number) => {
      let elapsed = now - start;
      if (elapsed >= LOOP_AT) {
        start = now;
        elapsed = 0;
        lastPhase = -1;
        lastTyped = -1;
      }
      const chars = elapsed < TYPE_AT ? 0 : Math.min(PROMPT.length, Math.floor((elapsed - TYPE_AT) / TYPE_MS));
      let next = 0;
      if (elapsed >= DONE_AT) next = 5;
      else if (elapsed >= ASK_AT) next = 4;
      else if (elapsed >= CONNECT_AT) next = 3;
      else if (elapsed >= PLAN_AT) next = 2;
      else if (elapsed >= TYPE_AT) next = 1;
      if (chars !== lastTyped) {
        lastTyped = chars;
        setTyped(chars);
      }
      if (next !== lastPhase) {
        lastPhase = next;
        setPhase(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  const thinking = (phase === 0 || (phase === 1 && typed >= PROMPT.length)) && phase < 2;

  return (
    <figure ref={rootRef} className="ld-window" data-phase={phase >= 5 ? "done" : "playing"} aria-label="Example AgentDocker chat. You ask for a weekday AI news digest in Slack. The agent plans the steps, connects Slack, asks before posting, and finishes.">
      <div aria-hidden="true" className="flex min-h-[32rem] flex-col sm:min-h-[34rem]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold tracking-[-0.02em]">AgentDocker</p>
          <p className="rounded-full bg-yellow px-2.5 py-1 text-[11px] font-semibold tracking-wide text-ink">Example</p>
        </div>
        <div className="flex flex-1 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5">
          {typed > 0 && (
            <div className="ld-rise ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] leading-relaxed text-ground sm:text-[15px]">
              {PROMPT.slice(0, typed)}
              {typed < PROMPT.length && <span className="ld-caret" />}
            </div>
          )}
          {thinking && (
            <div className="flex w-fit items-center gap-1 rounded-full border border-line bg-panel px-3 py-2" aria-hidden="true">
              <span className="ld-dot size-1.5 rounded-full bg-blue" />
              <span className="ld-dot size-1.5 rounded-full bg-green" />
              <span className="ld-dot size-1.5 rounded-full bg-coral" />
            </div>
          )}
          {phase >= 2 && (
            <div className="ld-rise rounded-2xl border border-line bg-panel px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Plan</p>
              <ol className="mt-2 space-y-1.5">
                {STEPS.map((step, index) => (
                  <li key={step} className="flex items-start gap-2.5 text-[14px] leading-snug sm:text-[15px]" style={{ animationDelay: `${index * 90}ms` }}>
                    <span className="mt-0.5 font-semibold tabular-nums text-coral">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {phase >= 3 && (
            <div className="ld-rise flex items-center justify-between gap-3 rounded-2xl border border-line bg-accent-soft px-3.5 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">App</p>
                <p className="mt-1 text-sm font-semibold">{phase >= 5 ? "Slack connected" : "Connect Slack"}</p>
              </div>
              <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">{phase >= 5 ? "Connected" : "Connect"}</span>
            </div>
          )}
          {phase === 4 && (
            <div className="ld-rise rounded-2xl border border-line bg-gold-soft px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Approval</p>
              <p className="mt-1 text-sm font-semibold">Post this digest to Slack?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">Approve</span>
                <span className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold">Edit</span>
                <span className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold">Not now</span>
              </div>
            </div>
          )}
          {phase >= 5 && (
            <p className="ld-rise text-sm font-semibold">Approved. The digest is posted.</p>
          )}
        </div>
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="flex items-center justify-between rounded-full border border-line bg-panel py-1.5 pl-4 pr-1.5">
            <span className="text-sm text-muted">Describe the outcome</span>
            <span className="grid size-9 place-items-center rounded-full bg-ink text-white">
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}
