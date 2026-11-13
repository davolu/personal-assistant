export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="#1a1916" />
      <circle cx="11" cy="12" r="3.1" fill="#4a6cf7" />
      <circle cx="21" cy="12" r="3.1" fill="#7ed38a" />
      <circle cx="11" cy="21" r="3.1" fill="#ffd93d" />
      <circle cx="21" cy="21" r="3.1" fill="#ff6b3d" />
    </svg>
  );
}

export function ArrowIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScribbleCursor() {
  return (
    <svg viewBox="0 0 28 28" className="inline-block size-6 align-[-0.15em] text-coral" aria-hidden="true">
      <path d="M6 4.5 20 16.5 12.5 17.2 16 24.5 13.2 25.6 9.6 18.1 4.8 21.2Z" fill="currentColor" />
    </svg>
  );
}

function Bubble({ tone, label, className }: { tone: "blue" | "green" | "coral" | "yellow"; label: string; className?: string }) {
  const fill = { blue: "#4A6CF7", green: "#7ED38A", coral: "#FF6B3D", yellow: "#FFD93D" }[tone];
  const ink = tone === "blue" ? "#fff" : "#1A1916";
  return (
    <span className={`grid size-14 place-items-center rounded-full shadow-[0_12px_24px_-16px_rgba(26,25,22,0.7)] ring-4 ring-white ${className ?? ""}`} style={{ background: fill, color: ink }}>
      <AppGlyph name={label} />
    </span>
  );
}

function AppGlyph({ name }: { name: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "size-6", "aria-hidden": true };
  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m4.5 7 7.5 6 7.5-6" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M5 6.5h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H9l-3.5 3v-3H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2z" />
      </svg>
    );
  }
  if (name === "cal") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 3.5v3M16 3.5v3M4 9.5h16" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M14 3.5v4h4M9.5 12.5h5M9.5 16h3" />
    </svg>
  );
}

export function HeroOrbit() {
  return (
    <div className="relative mx-auto mt-4 hidden h-[300px] max-w-[920px] lg:block" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 920 300" fill="none">
        <path className="dash-flow" d="M140 70 C 240 40, 320 150, 460 150" stroke="#1A1916" strokeOpacity="0.35" strokeWidth="1.5" />
        <path className="dash-flow" d="M780 64 C 680 90, 600 140, 500 150" stroke="#1A1916" strokeOpacity="0.35" strokeWidth="1.5" />
        <path className="dash-flow" d="M160 230 C 260 210, 340 190, 450 168" stroke="#1A1916" strokeOpacity="0.28" strokeWidth="1.5" />
        <path className="dash-flow" d="M770 220 C 680 200, 600 180, 500 168" stroke="#1A1916" strokeOpacity="0.28" strokeWidth="1.5" />
      </svg>
      <div className="float-a absolute left-[6%] top-6">
        <Bubble tone="coral" label="mail" />
      </div>
      <div className="float-b absolute right-[7%] top-4">
        <Bubble tone="blue" label="chat" />
      </div>
      <div className="float-c absolute left-[10%] bottom-8">
        <Bubble tone="yellow" label="cal" />
      </div>
      <div className="float-a absolute right-[12%] bottom-6">
        <Bubble tone="green" label="doc" />
      </div>
      <StatusChip className="float-b absolute left-[22%] top-[38%]" tone="green" text="Gmail connected" />
      <StatusChip className="float-c absolute right-[20%] top-[42%]" tone="yellow" text="Waiting for approval" />
      <StatusChip className="float-a absolute left-[38%] bottom-2" tone="blue" text="Done" />
    </div>
  );
}

export function StatusChip({ text, tone, className = "" }: { text: string; tone: "blue" | "green" | "coral" | "yellow"; className?: string }) {
  const toneClass = {
    blue: "bg-blue text-white",
    green: "bg-green text-ink",
    coral: "bg-coral text-ink",
    yellow: "bg-yellow text-ink",
  }[tone];
  return <span className={`pop-in inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold shadow-[0_10px_20px_-14px_rgba(26,25,22,0.8)] ${toneClass} ${className}`}>{text}</span>;
}

export function EmptyArt({ kind }: { kind: "chats" | "schedules" | "connections" | "approvals" }) {
  const accent = kind === "chats" ? "#4A6CF7" : kind === "schedules" ? "#FFD93D" : kind === "connections" ? "#7ED38A" : "#FF6B3D";
  return (
    <svg viewBox="0 0 180 120" className="mx-auto h-28 w-44" aria-hidden="true">
      <rect x="18" y="22" width="144" height="82" rx="22" fill="#fffdf8" stroke="#e4ddd0" />
      <circle cx="48" cy="52" r="12" fill={accent} />
      <rect x="70" y="44" width="68" height="8" rx="4" fill="#1a1916" opacity="0.85" />
      <rect x="70" y="58" width="48" height="6" rx="3" fill="#6d685f" opacity="0.45" />
      {kind === "schedules" && <path d="M118 78h22M129 67v22" stroke="#1a1916" strokeWidth="2.4" strokeLinecap="round" />}
      {kind === "connections" && (
        <>
          <circle cx="112" cy="82" r="7" fill="#4A6CF7" />
          <circle cx="132" cy="82" r="7" fill="#FF6B3D" />
          <path d="M119 82h6" stroke="#1a1916" strokeWidth="1.6" strokeDasharray="2 2" />
        </>
      )}
      {kind === "chats" && <path d="M78 78h46" stroke={accent} strokeWidth="3" strokeLinecap="round" />}
      {kind === "approvals" && <path d="M112 84l6 6 12-14" fill="none" stroke="#1a1916" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
