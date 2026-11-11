import type { Metadata } from "next";
import { Suspense } from "react";
import CreateAgentClient from "@/components/CreateAgentClient";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { guardQuery } from "@/lib/db-error";
import DataUnavailable from "@/components/DataUnavailable";

export const metadata: Metadata = {
  title: "Create your own agent",
  description: "Describe what you want to automate in plain language — AI drafts the workflow, you approve it.",
};

export default function CreatePage(props: { searchParams: Promise<{ agent?: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[80vh]" />}>
      <CreateContent {...props} />
    </Suspense>
  );
}

async function CreateContent({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent: editAgentId } = await searchParams;

  // Edit mode: preload the user's own custom agent so they can tweak the prompt and regenerate.
  let initialIdea = "";
  let editId: string | undefined;
  let editName = "";
  if (editAgentId) {
    const session = await getSession();
    if (session) {
      const loaded = await guardQuery(() =>
        prisma.customAgent.findFirst({
          where: { id: editAgentId, userId: session.user.id },
        })
      );
      if (!loaded.ok) return <DataUnavailable detail={loaded.detail} />;
      const custom = loaded.value;
      if (custom) {
        editId = custom.id;
        editName = custom.name;
        initialIdea = custom.idea || custom.description;
      }
    }
  }

  return (
    <div className="dotgrid min-h-[80vh] px-5 py-16">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">
          {editId ? "Edit agent" : "Agent builder"}
        </p>
        <h1 className="mt-2 text-balance text-4xl font-bold tracking-tight">
          {editId ? `Rework ${editName}` : "Describe it. It gets built."}
        </h1>
        <p className="mt-3 max-w-lg text-muted">
          {editId
            ? "Tweak the description below and regenerate — the agent keeps its connections and run history, only its plan changes."
            : "No drag-and-drop, no code. Type what you want automated in plain language — AI drafts a workflow plan from the 100+ supported tools, you approve it, and it's live."}
        </p>
        <div className="mt-8">
          <CreateAgentClient initialIdea={initialIdea} editId={editId} />
        </div>
      </div>
    </div>
  );
}
