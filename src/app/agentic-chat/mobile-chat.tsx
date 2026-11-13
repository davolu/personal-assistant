"use client";

import { useState, type ReactNode } from "react";
import { MobileLayer } from "@/components/mobile-overlay";
import { SiteMenuLinks } from "@/components/SiteMenu";
import { hapticTap } from "./haptic";
import { AgentList, type AgentThread } from "./agent-list";

function tap() {
  hapticTap(typeof navigator === "undefined" ? undefined : navigator);
}

export function MobileChatBar({
  title,
  planActive,
  agentsOpen,
  menuOpen,
  onOpenAgents,
  onOpenMenu,
  onOpenPlan,
}: {
  title: string;
  planActive: boolean;
  agentsOpen: boolean;
  menuOpen: boolean;
  onOpenAgents: () => void;
  onOpenMenu: () => void;
  onOpenPlan: () => void;
}) {
  return (
    <header data-mobile-appbar className="glass z-30 shrink-0 border-b md:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="grid h-14 grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center px-1">
        <div className="flex">
          <button
            type="button"
            data-agents-button
            className="press grid size-11 place-items-center rounded-full"
            aria-label="Your agents"
            aria-expanded={agentsOpen}
            onClick={() => {
              tap();
              onOpenAgents();
            }}
          >
            <AgentsIcon />
          </button>
        </div>
        <h1 className="truncate px-1 text-center text-[15px] font-semibold">{title}</h1>
        <div className="flex justify-end">
          <button
            type="button"
            data-plan-button
            className="press grid size-11 place-items-center rounded-full"
            aria-label="Plan and computer"
            onClick={() => {
              tap();
              onOpenPlan();
            }}
          >
            <span className="flex items-center gap-0.5">
              <PlanIcon />
              {planActive && <span data-plan-badge className="size-1.5 shrink-0 rounded-full bg-coral" />}
            </span>
          </button>
          <button
            type="button"
            data-overflow-button
            className="press grid size-11 place-items-center rounded-full text-lg leading-none"
            aria-label="More"
            aria-expanded={menuOpen}
            onClick={() => {
              tap();
              onOpenMenu();
            }}
          >
            ⋯
          </button>
        </div>
      </div>
    </header>
  );
}

type AgentActions = {
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
};

export function MobileAgentsDrawer({
  open,
  onClose,
  onNewChat,
  ...agents
}: AgentActions & { open: boolean; onClose: () => void; onNewChat: () => void }) {
  if (!open) return null;
  return (
    <MobileLayer kind="drawer" label="Your agents" onClose={onClose}>
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <p className="panel-label">Your agents</p>
        <button type="button" className="press grid size-11 place-items-center rounded-full text-lg" aria-label="Close agents" onClick={onClose}>
          ×
        </button>
      </div>
      <button
        type="button"
        className="press mx-2 min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-link"
        onClick={() => {
          onNewChat();
          onClose();
        }}
      >
        New agent
      </button>
      <AgentList
        {...agents}
        sheet
        onOpen={(id) => {
          agents.onOpen(id);
          onClose();
        }}
      />
    </MobileLayer>
  );
}

export function MobileChatMenu({
  open,
  onClose,
  title,
  activeId,
  modelLabel,
  planActive,
  hasModel,
  renaming,
  renameDraft,
  onRenameDraft,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onSchedule,
  onModel,
  onPlan,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  activeId?: string | null;
  modelLabel: string;
  planActive: boolean;
  hasModel: boolean;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onSchedule: () => void;
  onModel: () => void;
  onPlan: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;
  const canEdit = Boolean(activeId);
  return (
    <MobileLayer kind="sheet" label="More" onClose={onClose}>
      <div className="px-2 pb-2">
        <p className="truncate px-3 pb-2 text-sm font-semibold">{title}</p>
        {renaming ? (
          <form
            className="flex flex-col gap-2 px-3"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveRename();
            }}
          >
            <label className="text-sm font-semibold" htmlFor="mobile-agent-name">
              Agent name
            </label>
            <input
              id="mobile-agent-name"
              value={renameDraft}
              onChange={(event) => onRenameDraft(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-ground px-3 text-base outline-none focus:border-ink/40"
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-ink text-sm">
                Save
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={onCancelRename}>
                Cancel
              </button>
            </div>
          </form>
        ) : confirming ? (
          <div className="mx-3 rounded-2xl border border-danger/30 bg-danger-soft p-3">
            <p className="text-sm font-semibold">Delete this agent?</p>
            <p className="mt-1 text-xs text-muted">This removes it from your account.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="min-h-11 rounded-xl bg-danger px-3 text-sm font-semibold text-white" onClick={onDelete}>
                Delete
              </button>
              <button type="button" className="min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <div role="group" aria-label="Agent actions">
            <MenuRow onClick={onSchedule}>Schedule</MenuRow>
            {hasModel && (
              <MenuRow onClick={onModel}>
                <span>Model</span>
                <span className="truncate text-xs font-medium text-muted">{modelLabel}</span>
              </MenuRow>
            )}
            <MenuRow onClick={onPlan}>
              <span>Plan and computer</span>
              {planActive && <span className="size-2 shrink-0 rounded-full bg-coral" />}
            </MenuRow>
            <MenuRow disabled={!canEdit} onClick={onStartRename}>
              Rename
            </MenuRow>
            <MenuRow disabled={!canEdit} onClick={() => setConfirming(true)}>
              Delete
            </MenuRow>
          </div>
        )}
        <SiteMenuLinks onNavigate={onClose} />
      </div>
    </MobileLayer>
  );
}

export function PlanSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <MobileLayer kind="sheet" label="Plan and computer" onClose={onClose}>
      <div className="flex items-center justify-between px-4 pb-2">
        <p className="text-sm font-semibold">Plan and computer</p>
        <button type="button" className="press min-h-11 px-2 text-sm font-semibold" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </MobileLayer>
  );
}

function MenuRow({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="press flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-semibold disabled:opacity-40 active:bg-accent-soft"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AgentsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path d="M4 6.5h12M4 10h12M4 13.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 8.5h7M6.5 11.5h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
