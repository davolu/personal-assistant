import Link from "next/link";
import { ChatMock } from "@/components/landing/ChatMock";
import { Glyph, type GlyphName } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/Reveal";
import { APP_CATALOG, SITE } from "@/lib/site";

const primary =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-[#1d1d1f] px-7 text-[15px] font-semibold text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d1d1f]";
const secondary =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-black/10 bg-white/80 px-7 text-[15px] font-semibold text-[#1d1d1f] backdrop-blur-xl transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d1d1f]";

const STEPS: { n: string; t: string; d: string }[] = [
  {
    n: "01",
    t: "Describe",
    d: "Say what done looks like, in plain language. No workflow builder and no code.",
  },
  {
    n: "02",
    t: "It plans and acts",
    d: "The agent splits the outcome into steps, connects the apps it needs, and carries the work out.",
  },
  {
    n: "03",
    t: "It checks with you",
    d: "Before it sends, deletes, or pays, it stops and asks. You approve, edit, or leave it.",
  },
];

const COMPARE = [
  { chatbot: "Answers questions, then waits.", agent: "Finishes the job." },
  { chatbot: "You copy and paste between apps.", agent: "Connects your apps and acts in them." },
  { chatbot: "Stops when something fails.", agent: "Tries another way and recovers." },
  { chatbot: "One reply at a time.", agent: "Plans multi-step work and runs on a schedule." },
  { chatbot: "Can't work a site that has no API.", agent: "Uses its own cloud desktop to work there." },
  { chatbot: "Does what it's told blindly.", agent: "Asks before it sends, deletes, or pays." },
] as const;

const CAPABILITIES: { icon: GlyphName; title: string; body: string }[] = [
  {
    icon: "apps",
    title: APP_CATALOG.label,
    body: `${APP_CATALOG.credit}. One-click sign-in, no API keys to manage.`,
  },
  {
    icon: "desktop",
    title: "Its own cloud desktop",
    body: "When a site has no API, the agent opens it on a cloud desktop and does the work there.",
  },
  {
    icon: "clock",
    title: "Runs on a schedule",
    body: "Daily, hourly, or when something happens in a connected app — including while you are away.",
  },
  {
    icon: "recover",
    title: "Recovers from failures",
    body: "If a step fails, it tries another way instead of stopping and handing the job back.",
  },
  {
    icon: "shield",
    title: "Asks before anything risky",
    body: "Sends, deletes, and payments wait until you approve them.",
  },
  {
    icon: "model",
    title: "Choose your model",
    body: "Pick the model the agent uses, and switch it when you want. Not locked to one.",
  },
];

const USES: { icon: GlyphName; title: string; body: string }[] = [
  {
    icon: "news",
    title: "Daily AI news to Slack",
    body: "A weekday digest of what happened in AI, drafted for Slack and sent only after you approve.",
  },
  {
    icon: "inbox",
    title: "Inbox triage",
    body: "Read new mail, set aside what matters, and draft replies for you to approve.",
  },
  {
    icon: "report",
    title: "Research reports",
    body: "Gather sources on a question and write a short report you can review.",
  },
  {
    icon: "social",
    title: "Social posting drafts",
    body: "Turn a note or a link into post drafts, and wait for approval before anything goes live.",
  },
];

const SAFETY: { icon: GlyphName; title: string; body: string }[] = [
  {
    icon: "shield",
    title: "A pause before it commits",
    body: "Sends, deletes, and payments do not run until you say yes.",
  },
  {
    icon: "edit",
    title: "Edit or turn it down",
    body: "Change the step, or reject it. The agent waits.",
  },
  {
    icon: "link",
    title: "Only apps you connect",
    body: "It acts in the accounts you sign in. Nothing is connected for you in the background.",
  },
  {
    icon: "desktop",
    title: "The same check on the desktop",
    body: "Work on a site with no API still stops for approval when the action is risky.",
  },
];

const FAQ = [
  {
    q: "Do I need to know how to code?",
    a: `No. Describe the outcome in chat. ${SITE.name} creates the agent and does the work.`,
  },
  {
    q: "How is this different from a chatbot?",
    a: "A chatbot answers and waits. An agent plans the steps, uses your apps, tries another way when a step fails, and finishes the job.",
  },
  {
    q: "Which apps can it use?",
    a: `${APP_CATALOG.label}. ${APP_CATALOG.credit}. One-click sign-in, and a cloud desktop for a site with no API.`,
  },
  {
    q: "What if a step fails?",
    a: "It tries another way and keeps going, instead of ending the job at the error.",
  },
  {
    q: "Will it send, delete, or pay without me?",
    a: "No. Those actions wait for your approval. You can edit the step or reject it.",
  },
  {
    q: "Can it run while I am away?",
    a: "Yes. It can run daily, hourly, or when something happens in a connected app.",
  },
  {
    q: "Do I have to use one model?",
    a: "No. You choose the model for the agent in chat, and you can switch it.",
  },
];

function Kicker({ children }: { children: string }) {
  return <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6e6e73]">{children}</p>;
}

function Mark({ benefit }: { benefit?: boolean }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full ${benefit ? "bg-[#1d1d1f] text-white" : "bg-[#f5f5f7] text-[#6e6e73] ring-1 ring-black/10"}`}
    >
      <Glyph name={benefit ? "check" : "minus"} className="size-3.5" />
    </span>
  );
}

export default function Home() {
  return (
    <div className="landing bg-white text-[#1d1d1f]">
      <style>{`
        .landing::selection, .landing *::selection { background: rgba(0, 0, 0, 0.1); }
        body:has(.landing) header {
          background: rgba(255, 255, 255, 0.72);
          border-bottom-color: rgba(0, 0, 0, 0.08);
          -webkit-backdrop-filter: saturate(180%) blur(20px);
          backdrop-filter: saturate(180%) blur(20px);
        }
        body:has(.landing) header nav a { color: #6e6e73; }
        body:has(.landing) header nav a:hover { background: rgba(0, 0, 0, 0.05); color: #1d1d1f; }
        body:has(.landing) nav.fixed {
          background: rgba(255, 255, 255, 0.8);
          border-top-color: rgba(0, 0, 0, 0.08);
          -webkit-backdrop-filter: saturate(180%) blur(18px);
          backdrop-filter: saturate(180%) blur(18px);
        }
        .ld-glow-wrap { position: absolute; left: 50%; top: 46%; z-index: 0; width: min(760px, 92vw); height: 340px; transform: translateX(-50%); pointer-events: none; }
        .ld-glow { width: 100%; height: 100%; filter: blur(16px); background: radial-gradient(closest-side at 50% 50%, rgba(10, 132, 255, 0.32), transparent 70%), radial-gradient(closest-side at 72% 40%, rgba(0, 0, 0, 0.05), transparent 68%); animation: ld-drift 18s ease-in-out infinite alternate; }
        .ld-card { border: 1px solid rgba(0, 0, 0, 0.1); background: #fff; box-shadow: 0 1px 1px rgba(0, 0, 0, 0.03), 0 14px 34px -22px rgba(0, 0, 0, 0.28); }
        .ld-window { border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 28px; background: rgba(255, 255, 255, 0.82); box-shadow: 0 1px 0 rgba(255, 255, 255, 0.95) inset, 0 2px 8px rgba(0, 0, 0, 0.04), 0 30px 70px -36px rgba(0, 0, 0, 0.45); backdrop-filter: blur(22px); }
        .ld-rise { animation: ld-rise 0.55s ease both; }
        .ld-caret { display: inline-block; width: 1px; height: 0.9em; margin-left: 1px; vertical-align: text-bottom; background: currentColor; animation: ld-blink 1s steps(1) infinite; }
        .ld-dot { animation: ld-bounce 1s infinite; }
        .ld-dot:nth-child(2) { animation-delay: 150ms; }
        .ld-dot:nth-child(3) { animation-delay: 300ms; }
        .ld-faq summary { list-style: none; }
        .ld-faq summary::-webkit-details-marker { display: none; }
        .ld-plus { position: relative; width: 14px; height: 14px; flex: none; }
        .ld-plus::before, .ld-plus::after { content: ""; position: absolute; background: currentColor; border-radius: 1px; }
        .ld-plus::before { top: 6px; right: 0; left: 0; height: 1.5px; }
        .ld-plus::after { top: 0; bottom: 0; left: 6px; width: 1.5px; transition: transform 0.25s ease; }
        .ld-faq details[open] .ld-plus::after { transform: rotate(90deg); }
        .ld-reveal.ld-wait .ld-stagger > * { opacity: 0; transform: translateY(18px); }
        .ld-reveal.ld-in .ld-stagger > *, .ld-reveal.ld-wait .ld-stagger > * { transition: opacity 0.7s ease, transform 0.7s ease; }
        .ld-reveal.ld-in .ld-stagger > * { opacity: 1; transform: none; }
        .ld-reveal.ld-in .ld-stagger > *:nth-child(2) { transition-delay: 70ms; }
        .ld-reveal.ld-in .ld-stagger > *:nth-child(3) { transition-delay: 140ms; }
        .ld-reveal.ld-in .ld-stagger > *:nth-child(4) { transition-delay: 210ms; }
        .ld-reveal.ld-in .ld-stagger > *:nth-child(5) { transition-delay: 280ms; }
        .ld-reveal.ld-in .ld-stagger > *:nth-child(6) { transition-delay: 350ms; }
        @keyframes ld-drift { from { transform: translate3d(-3%, 0, 0) scale(1); } to { transform: translate3d(4%, 5%, 0) scale(1.06); } }
        @keyframes ld-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes ld-blink { 50% { opacity: 0; } }
        @keyframes ld-bounce { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
        @media (hover: hover) and (prefers-reduced-motion: no-preference) {
          .ld-card { transition: transform 0.35s ease, box-shadow 0.35s ease; }
          .ld-reveal.ld-in .ld-stagger > .ld-card:hover { transform: translateY(-4px); box-shadow: 0 16px 36px -22px rgba(0, 0, 0, 0.4); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ld-glow, .ld-rise, .ld-caret, .ld-dot, .ld-plus::after, .ld-card { animation: none; transition: none; }
          .ld-reveal.ld-wait .ld-stagger > *, .ld-reveal.ld-in .ld-stagger > * { opacity: 1; transform: none; transition: none; }
        }
      `}</style>
      <div className="relative">
        <div className="ld-glow-wrap" aria-hidden="true">
          <div className="ld-glow" />
        </div>
        <section className="relative z-10">
          <div className="mx-auto w-full max-w-[1120px] px-5 pb-8 pt-16 text-center sm:pb-10 sm:pt-24">
            <Kicker>{SITE.hero.eyebrow}</Kicker>
            <h1 className="mx-auto mt-4 max-w-5xl text-balance text-[2.6rem] font-bold leading-[1.02] tracking-[-0.045em] min-[420px]:text-[2.85rem] sm:text-6xl lg:text-[4.25rem]">
              {SITE.hero.titleLead}
              <span className="mt-1 block">{SITE.hero.titleRest}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-[#6e6e73] sm:text-lg">
              {SITE.hero.subtitle}
            </p>
            <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
              <Link href={SITE.hero.ctaHref} className={primary}>
                {SITE.hero.ctaLabel}
              </Link>
              <a href={SITE.hero.secondaryHref} className={secondary}>
                {SITE.hero.secondaryLabel}
              </a>
            </div>
          </div>
        </section>

        <section className="relative z-10" aria-labelledby="product-heading">
          <div className="mx-auto w-full max-w-[1120px] px-5 pb-20 sm:pb-28">
            <div className="mx-auto mb-8 max-w-xl text-center">
              <Kicker>The product</Kicker>
              <h2 id="product-heading" className="mt-3 text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.5rem]">
                You describe it. The agent takes it from there.
              </h2>
            </div>
            <div className="mx-auto max-w-[680px] max-md:mt-10">
              <ChatMock />
            </div>
          </div>
        </section>
      </div>

      <section id="how-it-works" className="scroll-mt-24 bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 sm:py-28">
          <Kicker>How it works</Kicker>
          <h2 className="mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
            Three steps, then it keeps going
          </h2>
          <Reveal>
            <ol className="ld-stagger mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className="ld-card rounded-3xl p-6 sm:p-7">
                  <span className="text-sm font-semibold tracking-[0.14em] text-[#6e6e73]">{step.n}</span>
                  <h3 className="mt-5 text-xl tracking-[-0.03em]">{step.t}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#6e6e73]">{step.d}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section id="agents-vs-chatbots" className="scroll-mt-24" aria-labelledby="agents-vs-chatbots-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 sm:py-28">
          <Kicker>Why an agent</Kicker>
          <h2 id="agents-vs-chatbots-heading" className="mt-3 max-w-2xl text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
            Autonomous agents vs chatbots
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-[#6e6e73]">
            A chatbot stops at an answer. An autonomous agent takes the outcome you describe and does the work.
          </p>
          <Reveal>
            <div className="ld-card mt-12 overflow-hidden rounded-[28px]">
              <div className="hidden border-b border-black/10 md:grid md:grid-cols-2">
                <p className="px-6 py-4 text-sm font-semibold text-[#6e6e73]">Chatbot</p>
                <p className="border-l border-black/10 px-6 py-4 text-sm font-semibold">Autonomous agent</p>
              </div>
              <ul className="ld-stagger">
                {COMPARE.map((row) => (
                  <li key={row.agent} className="grid border-b border-black/10 last:border-b-0 md:grid-cols-2">
                    <div className="px-4 py-4 sm:px-6">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73] md:hidden">Chatbot</p>
                      <div className="flex items-center gap-3">
                        <Mark />
                        <p className="min-w-0 text-[15px] leading-relaxed text-[#6e6e73]">{row.chatbot}</p>
                      </div>
                    </div>
                    <div className="border-t border-black/10 bg-[#fafafa] px-4 py-4 sm:px-6 md:border-l md:border-t-0">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] md:hidden">Autonomous agent</p>
                      <div className="flex items-center gap-3">
                        <Mark benefit />
                        <p className="min-w-0 text-[15px] font-semibold leading-relaxed">{row.agent}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bg-[#f5f5f7]" aria-labelledby="capabilities-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 sm:py-28">
          <Kicker>What it can do</Kicker>
          <h2 id="capabilities-heading" className="mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
            Built to finish the work
          </h2>
          <Reveal>
            <ul className="ld-stagger mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <li key={item.title} className="ld-card rounded-3xl p-6">
                  <span className="grid size-11 place-items-center rounded-2xl bg-[#f5f5f7] text-[#1d1d1f]">
                    <Glyph name={item.icon} />
                  </span>
                  <h3 className="mt-5 text-lg tracking-[-0.02em]">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#6e6e73]">{item.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="uses-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 sm:py-28">
          <Kicker>Examples</Kicker>
          <h2 id="uses-heading" className="mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
            Jobs you can hand it
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-[#6e6e73]">
            Describe the outcome the way you would to a teammate. These are the kinds of work it can take on.
          </p>
          <Reveal>
            <ul className="ld-stagger mt-12 grid gap-4 sm:grid-cols-2">
              {USES.map((item) => (
                <li key={item.title} className="ld-card rounded-3xl p-6 sm:p-7">
                  <span className="grid size-11 place-items-center rounded-2xl bg-[#f5f5f7]">
                    <Glyph name={item.icon} />
                  </span>
                  <h3 className="mt-5 text-xl tracking-[-0.03em]">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#6e6e73]">{item.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="bg-[#f5f5f7]" aria-labelledby="safety-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start lg:gap-16">
            <div>
              <Kicker>Safety and control</Kicker>
              <h2 id="safety-heading" className="mt-3 text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
                You stay in charge
              </h2>
              <p className="mt-4 text-pretty text-[17px] leading-relaxed text-[#6e6e73]">
                The agent can act in your apps. Anything hard to undo waits for a yes.
              </p>
            </div>
            <Reveal>
              <ul className="ld-stagger grid gap-4 sm:grid-cols-2">
                {SAFETY.map((item) => (
                  <li key={item.title} className="ld-card rounded-3xl p-6">
                    <Glyph name={item.icon} />
                    <h3 className="mt-4 text-lg tracking-[-0.02em]">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#6e6e73]">{item.body}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-heading">
        <div className="mx-auto w-full max-w-[760px] px-5 py-20 sm:py-28">
          <Kicker>FAQ</Kicker>
          <h2 id="faq-heading" className="mt-3 text-balance text-[2rem] leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
            Questions
          </h2>
          <div className="ld-faq mt-8 border-t border-black/10">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-black/10">
                <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-6 py-4 text-[17px] font-semibold tracking-[-0.02em]">
                  {item.q}
                  <span className="ld-plus" aria-hidden="true" />
                </summary>
                <p className="max-w-xl pb-5 text-[15px] leading-relaxed text-[#6e6e73]">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-20 text-center sm:py-28">
          <h2 className="mx-auto max-w-3xl text-balance text-[2.4rem] leading-[1.05] tracking-[-0.045em] sm:text-5xl lg:text-[3.5rem]">
            Describe the outcome.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-pretty text-[17px] leading-relaxed text-[#6e6e73]">
            No code. Say what you want done, and {SITE.name} creates an agent that does the work.
          </p>
          <Link href={SITE.hero.ctaHref} className={`${primary} mt-8`}>
            {SITE.hero.ctaLabel}
          </Link>
        </div>
      </section>
    </div>
  );
}
