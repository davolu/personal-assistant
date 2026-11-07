import type { Metadata } from "next";
import CreateAgentClient from "@/components/CreateAgentClient";

export const metadata: Metadata = {
  title: "Create your own agent",
  description: "Describe what you want to automate in plain language — AI drafts the workflow, you approve it.",
};

export default function CreatePage() {
  return (
    <div className="dotgrid min-h-[80vh] px-5 py-16">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Agent builder</p>
        <h1 className="mt-2 text-balance text-4xl font-bold tracking-tight">
          Describe it. It gets built.
        </h1>
        <p className="mt-3 max-w-lg text-muted">
          No drag-and-drop, no code. Type what you want automated in plain language — AI drafts a
          workflow plan from the 100+ supported tools, you approve it, and it&apos;s live.
        </p>
        <div className="mt-8">
          <CreateAgentClient />
        </div>
      </div>
    </div>
  );
}
