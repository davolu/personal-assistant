import type { ReactNode } from "react";

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function Glyph({ name, className = "size-6" }: { name: GlyphName; className?: string }) {
  return (
    <svg {...common} className={className}>
      {draw[name]}
    </svg>
  );
}

export type GlyphName =
  | "apps"
  | "desktop"
  | "clock"
  | "recover"
  | "shield"
  | "model"
  | "news"
  | "inbox"
  | "report"
  | "social"
  | "check"
  | "edit"
  | "link"
  | "minus";

const draw: Record<GlyphName, ReactNode> = {
  apps: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5L15 15" />
    </>
  ),
  recover: (
    <>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4v5h-5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5.5 6.2v5.6c0 3.8 2.7 6.3 6.5 7.7 3.8-1.4 6.5-3.9 6.5-7.7V6.2L12 3.5z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </>
  ),
  model: (
    <>
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2.1" fill="#fff" />
      <circle cx="15" cy="16" r="2.1" fill="#fff" />
    </>
  ),
  news: (
    <>
      <path d="M5 6.5h9.5A2.5 2.5 0 0 1 17 9v8.5H7.5A2.5 2.5 0 0 1 5 15V6.5z" />
      <path d="M17 10.5h1.5A1.5 1.5 0 0 1 20 12v5.5a2 2 0 0 1-2 2H7" />
      <path d="M8 10h6M8 13.5h4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13 6 5.5h12L20.5 13" />
      <path d="M3.5 13v5.5h17V13" />
      <path d="M3.5 13h4.2l1.1 2h6.4l1.1-2h4.2" />
    </>
  ),
  report: (
    <>
      <path d="M7 3.5h7l4 4V20.5H7v-17z" />
      <path d="M14 3.5v4h4M9.5 12.5h5M9.5 16h3.5" />
    </>
  ),
  social: (
    <>
      <circle cx="7" cy="12" r="2.2" />
      <circle cx="16.5" cy="7" r="2.2" />
      <circle cx="16.5" cy="17" r="2.2" />
      <path d="m9 11 5.2-3M9 13l5.2 3" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19 7.5" />,
  edit: (
    <>
      <path d="M4 20h4.2L19.2 9a2 2 0 0 0-2.8-2.8L5.4 17.2 4 20z" />
      <path d="m13.8 6.8 2.8 2.8" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l2.3-2.3a4 4 0 0 0-5.7-5.6L11 7.3" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.3 2.3a4 4 0 0 0 5.7 5.6L13 16.7" />
    </>
  ),
  minus: <path d="M6 12h12" />,
};
