"use client";

import { useEffect, useId, useRef, useState } from "react";
import { hapticTap } from "./haptic";

export type AgentThread = { id: string; title: string; pinned?: boolean };

export function AgentList({
  threads,
  activeId,
  renamingId,
  renameDraft,
  onRenameDraft,
  onOpen,
  onRename,
  onStartRename,
  onCancelRename,
  onDelete,
  onPin,
  onDuplicate,
  onSchedule,
  sheet = false,
  initialMenuId = null,
}: {
  threads: AgentThread[];
  activeId?: string | null;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onStartRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDuplicate: (id: string) => void;
  onSchedule?: (id: string) => void;
  sheet?: boolean;
  initialMenuId?: string | null;
}) {
  const [menuId, setMenuId] = useState<string | null>(initialMenuId);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-agent-list>
      {threads.length === 0 && <li className="px-2 py-2 text-sm text-muted">Create your first Autonomous Agent</li>}
      {threads.map((thread) => (
        <li key={thread.id} className="group relative">
          {renamingId === thread.id ? (
            <form
              className="flex min-w-0 gap-1 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                onRename(thread.id, renameDraft);
              }}
            >
              <input
                value={renameDraft}
                onChange={(event) => onRenameDraft(event.target.value)}
                aria-label="Agent name"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-ground px-2 text-sm"
                autoFocus
              />
              <button type="submit" className="min-h-11 px-1 text-xs font-semibold text-accent-dark">Save</button>
              <button type="button" className="min-h-11 px-1 text-xs font-semibold text-muted" onClick={onCancelRename}>Cancel</button>
            </form>
          ) : (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                data-agent-row
                data-active={activeId === thread.id ? "true" : "false"}
                className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm transition duration-150 hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98] active:bg-accent-soft ${activeId === thread.id ? "bg-accent-soft font-semibold" : ""}`}
                onPointerDown={() => hapticTap(typeof navigator === "undefined" ? undefined : navigator)}
                onClick={() => onOpen(thread.id)}
              >
                <AgentIcon />
                <span className="truncate">{thread.title || "New agent"}</span>
              </button>
              <button
                type="button"
                data-agent-menu-button
                aria-haspopup="menu"
                aria-expanded={menuId === thread.id}
                aria-label={`Actions for ${thread.title || "New agent"}`}
                className={`grid size-11 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-accent-soft hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95 max-md:opacity-100 ${menuId === thread.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setAnchor({ top: rect.bottom + 4, left: Math.max(8, rect.right - 176) });
                  setMenuId((current) => (current === thread.id ? null : thread.id));
                }}
              >
                <KebabIcon />
              </button>
              {menuId === thread.id && (
                <AgentMenu
                  title={thread.title || "New agent"}
                  pinned={Boolean(thread.pinned)}
                  sheet={sheet}
                  anchor={anchor}
                  onClose={() => setMenuId(null)}
                  onRename={() => {
                    setMenuId(null);
                    onStartRename(thread.id, thread.title || "");
                  }}
                  onDelete={() => {
                    setMenuId(null);
                    if (window.confirm(`Delete ${thread.title || "this agent"}? This removes it from your account.`)) onDelete(thread.id);
                  }}
                  onPin={() => {
                    setMenuId(null);
                    onPin(thread.id, !thread.pinned);
                  }}
                  onDuplicate={() => {
                    setMenuId(null);
                    onDuplicate(thread.id);
                  }}
                  onSchedule={
                    onSchedule
                      ? () => {
                          setMenuId(null);
                          onSchedule(thread.id);
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AgentMenu({
  title,
  pinned,
  sheet,
  anchor,
  onClose,
  onRename,
  onDelete,
  onPin,
  onDuplicate,
  onSchedule,
}: {
  title: string;
  pinned: boolean;
  sheet: boolean;
  anchor: { top: number; left: number } | null;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onSchedule?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const label = useId();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);
  const items = (
    <div
      ref={ref}
      role="menu"
      aria-labelledby={label}
      data-agent-menu
      data-sheet={sheet ? "true" : "false"}
      style={sheet || !anchor ? undefined : { position: "fixed", top: anchor.top, left: anchor.left }}
      className={sheet ? "fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line bg-panel p-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg" : "z-50 w-44 rounded-xl border border-line bg-panel p-1 shadow-lg"}
    >
      <p id={label} className="px-3 py-2 text-xs font-semibold text-muted md:sr-only">{title}</p>
      <MenuButton onClick={onRename}>Rename</MenuButton>
      {onSchedule && <MenuButton onClick={onSchedule}>Schedule</MenuButton>}
      <MenuButton onClick={onPin}>{pinned ? "Unpin" : "Pin to top"}</MenuButton>
      <MenuButton onClick={onDuplicate}>Duplicate</MenuButton>
      <MenuButton onClick={onDelete}>Delete</MenuButton>
    </div>
  );
  if (!sheet) return items;
  return (
    <>
      <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-ink/30" onClick={onClose} />
      {items}
    </>
  );
}

function MenuButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onClick}>
      {children}
    </button>
  );
}

function AgentIcon() {
  return (
    <svg data-agent-icon width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-accent">
      <path fill="currentColor" d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v7A1.5 1.5 0 0 1 11.5 11H8.2L5 13.4V11H4.5A1.5 1.5 0 0 1 3 9.5v-7Z" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3.25" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="12.75" r="1.25" fill="currentColor" />
    </svg>
  );
}
