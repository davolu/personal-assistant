import type { CSSProperties } from "react";
import Link from "next/link";
import { ChatMock } from "@/components/landing/ChatMock";
import { Glyph, type GlyphName } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/Reveal";
import { ArrowIcon, HeroOrbit, ScribbleCursor, StatusChip } from "@/components/illustrations";
import { APP_CATALOG, SITE } from "@/lib/site";

const BLOCKS = ["block-blue", "block-green", "block-coral", "block-yellow"] as const;

const STEPS: { n: string; t: string; d: string; tone: (typeof BLOCKS)[number] }[] = [
  {
    n: "01",
    t: "Describe",
    d: "Say what done looks like, in plain language. No workflow builder and no code.",
    tone: "block-blue",
  },
  {
    n: "02",
    t: "It plans and acts",
    d: "The agent splits the outcome into steps, connects the apps it needs, and carries the work out.",
    tone: "block-green",
  },
  {
    n: "03",
    t: "It checks with you",
    d: "Before it sends, deletes, or pays, it stops and asks. You approve, edit, or leave it.",
    tone: "block-coral",
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

const USES: { icon: GlyphName; title: string; body: string; tone: (typeof BLOCKS)[number] }[] = [
  {
    icon: "news",
    title: "Daily AI news to Slack",
    body: "A weekday digest of what happened in AI, drafted for Slack and sent only after you approve.",
    tone: "block-yellow",
  },
  {
    icon: "inbox",
    title: "Inbox triage",
    body: "Read new mail, set aside what matters, and draft replies for you to approve.",
    tone: "block-blue",
  },
  {
    icon: "report",
    title: "Research reports",
    body: "Gather sources on a question and write a short report you can review.",
    tone: "block-green",
  },
  {
    icon: "social",
    title: "Social posting drafts",
    body: "Turn a note or a link into post drafts, and wait for approval before anything goes live.",
    tone: "block-coral",
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
    a: "No. Describe the outcome in chat. AgentDocker creates the agent and does the work.",
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
  return <p className="kicker">{children}</p>;
}

function wordDelay(index: number): CSSProperties {
  return { "--ld-delay": `${index * 55}ms` } as CSSProperties;
}

function Words({ text, start = 0 }: { text: string; start?: number }) {
  const words = text.split(" ").filter(Boolean);
  return words.map((word, index) => (
    <span key={`${start + index}-${word}`}>
      {index > 0 ? " " : null}
      <span className="ld-word" style={wordDelay(start + index)}>
        {word}
      </span>
    </span>
  ));
}

export default function Home() {
  return (
    <div className="landing overflow-x-clip text-ink">
      <section className="scallop relative bg-panel/70">
        <Reveal className="ld-hero">
        <div className="mx-auto w-full max-w-[1120px] px-5 pb-16 pt-12 text-center sm:pb-20 sm:pt-16">
          <div className="ld-stagger">
          <Kicker>{SITE.hero.eyebrow}</Kicker>
          <h1 className="ld-words mx-auto mt-4 max-w-5xl text-balance text-[2.55rem] font-bold leading-[1.02] min-[420px]:text-[2.9rem] sm:text-6xl lg:text-[4.4rem]">
            <Words text={SITE.hero.titleLead} /> <ScribbleCursor />
            <span className="mt-2 block">
              <span className="scribble">
                <Words text={SITE.hero.titleRest.split(" ").slice(0, -1).join(" ")} start={SITE.hero.titleLead.split(" ").length} />{" "}
              </span>
              <span className="hl-chip ld-word" style={wordDelay(SITE.hero.titleLead.split(" ").length + 1)}>
                <span className="hl-tag">No code</span>
                {SITE.hero.titleRest.split(" ").slice(-1)}
              </span>
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted sm:text-lg">{SITE.hero.subtitle}</p>
          <div className="mx-auto mt-8 flex w-full max-w-xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <div className="flex min-h-14 items-center rounded-full border border-ink/10 bg-panel p-1.5 shadow-[var(--shadow-card)]">
              <span className="min-w-0 flex-1 truncate px-4 text-left text-sm text-muted">Describe the outcome</span>
              <Link href={SITE.hero.ctaHref} className="btn-ink shrink-0">
                {SITE.hero.ctaLabel}
                <ArrowIcon />
              </Link>
            </div>
            <a href={SITE.hero.secondaryHref} className="btn-ghost">
              {SITE.hero.secondaryLabel}
            </a>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2 lg:hidden">
            <StatusChip tone="green" text="Gmail connected" />
            <StatusChip tone="yellow" text="Waiting for approval" />
            <StatusChip tone="blue" text="Done" />
          </div>
          </div>
          <HeroOrbit />
        </div>
        </Reveal>
      </section>

      <section className="relative" aria-labelledby="product-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:pb-28">
          <Reveal>
            <div className="ld-stagger mx-auto mb-8 max-w-xl text-center">
              <Kicker>The product</Kicker>
              <h2 id="product-heading" className="ld-words mt-3 text-balance text-[2rem] leading-[1.08] sm:text-[2.6rem]">
                <Words text="You describe it. The agent takes it from there." />
              </h2>
            </div>
          </Reveal>
          <Reveal>
            <div className="ld-stagger mx-auto max-w-[680px]">
              <ChatMock />
            </div>
          </Reveal>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:py-24">
          <Reveal>
            <div className="ld-stagger">
              <Kicker>How it works</Kicker>
              <h2 className="ld-words mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                <Words text="Three steps, then it keeps going" />
              </h2>
            </div>
          </Reveal>
          <Reveal className="ld-tilt ld-steps">
            <div className="relative mt-10">
              <div className="ld-rail" aria-hidden="true" />
              <ol className="ld-stagger grid gap-4 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className={`lift rounded-[1.75rem] p-6 sm:p-7 ${step.tone}`}>
                  <span className="text-sm font-semibold tracking-[0.14em] opacity-80">{step.n}</span>
                  <h3 className="mt-5 text-xl">{step.t}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed opacity-90">{step.d}</p>
                </li>
              ))}
            </ol>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="agents-vs-chatbots" className="scroll-mt-24" aria-labelledby="agents-vs-chatbots-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:py-24">
          <Reveal>
            <div className="ld-stagger">
              <Kicker>Why an agent</Kicker>
              <h2 id="agents-vs-chatbots-heading" className="ld-words mt-3 max-w-2xl text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                <Words text="Autonomous agents vs chatbots" />
              </h2>
              <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted">
                A chatbot stops at an answer. An autonomous agent takes the outcome you describe and does the work.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="ld-card mt-10 overflow-hidden rounded-[28px]">
              <div className="hidden border-b border-line md:grid md:grid-cols-2">
                <p className="px-6 py-4 text-sm font-semibold text-muted">Chatbot</p>
                <p className="border-l border-line px-6 py-4 text-sm font-semibold">Autonomous agent</p>
              </div>
              <ul className="ld-stagger">
                {COMPARE.map((row) => (
                  <li key={row.agent} className="grid border-b border-line last:border-b-0 md:grid-cols-2">
                    <div className="px-4 py-4 sm:px-6">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted md:hidden">Chatbot</p>
                      <div className="flex items-center gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ground text-muted ring-1 ring-line">
                          <Glyph name="minus" className="size-3.5" />
                        </span>
                        <p className="min-w-0 text-[15px] leading-relaxed text-muted">{row.chatbot}</p>
                      </div>
                    </div>
                    <div className="border-t border-line bg-gold-soft/40 px-4 py-4 sm:px-6 md:border-l md:border-t-0">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] md:hidden">Autonomous agent</p>
                      <div className="flex items-center gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-green text-ink">
                          <Glyph name="check" className="size-3.5" />
                        </span>
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

      <section aria-labelledby="capabilities-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:py-24">
          <Reveal>
            <div className="ld-stagger">
              <Kicker>What it can do</Kicker>
              <h2 id="capabilities-heading" className="ld-words mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                <Words text="Built to finish the work" />
              </h2>
            </div>
          </Reveal>
          <Reveal className="ld-tilt">
            <ul className="ld-stagger mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item, index) => (
                <li key={item.title} className={`lift rounded-[1.75rem] p-6 ${BLOCKS[index % BLOCKS.length]}`}>
                  <span className="grid size-11 place-items-center rounded-2xl bg-white/70 text-ink">
                    <Glyph name={item.icon} />
                  </span>
                  <h3 className="mt-5 text-lg">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed opacity-90">{item.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="uses-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:py-24">
          <Reveal>
            <div className="ld-stagger">
              <Kicker>Examples</Kicker>
              <h2 id="uses-heading" className="ld-words mt-3 max-w-xl text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                <Words text="Jobs you can hand it" />
              </h2>
              <p className="mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted">
                Describe the outcome the way you would to a teammate. These are the kinds of work it can take on.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <ul className="ld-stagger mt-10 grid gap-4 sm:grid-cols-2">
              {USES.map((item) => (
                <li key={item.title} className="ld-card lift flex gap-4 rounded-[1.75rem] p-6 sm:p-7">
                  <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${item.tone}`}>
                    <Glyph name={item.icon} />
                  </span>
                  <div>
                    <h3 className="text-xl">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="safety-heading">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start lg:gap-16">
            <Reveal>
              <div className="ld-stagger">
                <Kicker>Safety and control</Kicker>
                <h2 id="safety-heading" className="ld-words mt-3 text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                  <Words text="You stay in charge" />
                </h2>
                <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted">The agent can act in your apps. Anything hard to undo waits for a yes.</p>
              </div>
            </Reveal>
            <Reveal>
              <ul className="ld-stagger grid gap-4 sm:grid-cols-2">
                {SAFETY.map((item, index) => (
                  <li key={item.title} className="ld-card lift rounded-[1.75rem] p-6">
                    <span className={`grid size-10 place-items-center rounded-2xl ${BLOCKS[index % BLOCKS.length]}`}>
                      <Glyph name={item.icon} className="size-5" />
                    </span>
                    <h3 className="mt-4 text-lg">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.body}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-heading">
        <div className="mx-auto w-full max-w-[760px] px-5 py-16 sm:py-24">
          <Reveal>
            <div className="ld-stagger">
              <Kicker>FAQ</Kicker>
              <h2 id="faq-heading" className="ld-words mt-3 text-balance text-[2rem] leading-[1.08] sm:text-[2.75rem]">
                <Words text="Questions" />
              </h2>
            </div>
          </Reveal>
          <Reveal>
          <div className="ld-faq ld-stagger mt-8 border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-6 py-4 text-[17px] font-semibold">
                  {item.q}
                  <span className="ld-plus" aria-hidden="true" />
                </summary>
                <p className="max-w-xl pb-5 text-[15px] leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
          </Reveal>
        </div>
      </section>

      <section className="px-5 pb-8">
        <Reveal className="ld-cta">
        <div className="scallop ld-cta-band mx-auto w-full max-w-[1120px] overflow-hidden rounded-[2rem] bg-ink px-6 py-16 text-center text-ground sm:py-20">
          <h2 className="ld-words mx-auto max-w-3xl text-balance text-[2.3rem] leading-[1.05] text-ground sm:text-5xl">
            <Words text="Describe the outcome." />
          </h2>
          <p className="mx-auto mt-5 max-w-md text-pretty text-[17px] leading-relaxed text-ground/75">
            No code. Say what you want done, and AgentDocker creates an agent that does the work.
          </p>
          <Link href={SITE.hero.ctaHref} className="btn-ink btn-sun mt-8">
            {SITE.hero.ctaLabel}
            <ArrowIcon />
          </Link>
        </div>
        </Reveal>
      </section>
    </div>
  );
}
