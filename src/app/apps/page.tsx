import type { Metadata } from "next";
import Link from "next/link";
import { APP_CATALOG } from "@/lib/site";
import { SUPPORTED_TOOLKITS, toolkitLogo } from "@/lib/toolkits";

export const metadata: Metadata = {
  title: "Supported apps",
  description: "Every app AgentDock connects to with one-click managed auth — no API keys.",
};

export default function AppsPage() {
  const apps = [...SUPPORTED_TOOLKITS].sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <p className="kicker">Integrations</p>
      <h1 className="mt-2 max-w-3xl text-balance text-4xl font-bold">{APP_CATALOG.label}. {APP_CATALOG.credit}</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Every connection is one-click OAuth, fully managed. Your
        agent asks you to connect an app when a task needs it.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="block-blue p-5">
          <p className="text-lg font-bold">One-click sign-in</p>
          <p className="mt-1 text-sm text-white/85">No API keys to paste or rotate.</p>
        </div>
        <div className="block-green p-5">
          <p className="text-lg font-bold">Reused everywhere</p>
          <p className="mt-1 text-sm">Connect once. Every agent can use it.</p>
        </div>
        <div className="block-yellow p-5">
          <p className="text-lg font-bold">Asked when needed</p>
          <p className="mt-1 text-sm">The agent requests an app only for the task in front of it.</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {apps.map((name) => {
          const logo = toolkitLogo(name, 64);
          return (
            <div key={name} className="surface lift flex min-h-16 items-center gap-3 p-4">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="size-8 rounded-lg" loading="lazy" />
              ) : (
                <span className="grid size-8 place-items-center rounded-lg bg-ground font-bold ring-1 ring-line">
                  {name[0]}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                <p className="font-mono text-[11px] text-muted">supported</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="surface mt-12 p-8 text-center">
        <h2 className="text-xl font-bold">Don&apos;t see your workflow?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Describe what you want in plain language and the agent will use these apps.
        </p>
        <Link href="/agentic-chat" className="btn-ink mt-5">
          Open the agent
        </Link>
      </div>
    </div>
  );
}
