import type { Metadata } from "next";
import Link from "next/link";
import { bots } from "@/lib/agents";
import { SUPPORTED_TOOLKITS, toolkitLogo } from "@/lib/toolkits";

export const metadata: Metadata = {
  title: "Supported apps",
  description: "Every app Agently connects to with one-click managed auth — no API keys.",
};

export default function AppsPage() {
  const counts = new Map<string, number>();
  for (const b of bots) for (const t of b.toolkits) counts.set(t, (counts.get(t) ?? 0) + 1);
  const apps = SUPPORTED_TOOLKITS.map((name) => ({ name, count: counts.get(name) ?? 0 })).sort(
    (a, b) => b.count - a.count
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Integrations</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">{apps.length}+ supported apps</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Every connection is one-click OAuth, fully managed — no API keys, no developer setup. Click
        an app to see every template that uses it.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {apps.map((a) => {
          const logo = toolkitLogo(a.name, 64);
          return (
            <Link
              key={a.name}
              href={`/agents?app=${encodeURIComponent(a.name)}`}
              className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="size-8 rounded-lg" loading="lazy" />
              ) : (
                <span className="grid size-8 place-items-center rounded-lg bg-ground font-bold ring-1 ring-line">
                  {a.name[0]}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold group-hover:text-accent-dark">{a.name}</p>
                <p className="font-mono text-[11px] text-muted">
                  {a.count > 0 ? `${a.count} template${a.count === 1 ? "" : "s"}` : "supported"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-12 rounded-2xl border border-line bg-panel p-8 text-center">
        <h2 className="text-xl font-bold tracking-tight">Don&apos;t see your workflow?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Describe what you want in plain language and AI will draft a custom agent from these apps.
        </p>
        <Link
          href="/create"
          className="mt-5 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-white transition hover:bg-accent-dark"
        >
          ✨ Create your own agent
        </Link>
      </div>
    </div>
  );
}
