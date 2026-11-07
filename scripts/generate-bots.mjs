// Parses the 1,000-agent catalog HTML parts and emits enriched bot data.
// Run: node scripts/generate-bots.mjs <catalog-parts-dir>
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = process.argv[2];
if (!SRC_DIR) {
  console.error("usage: node scripts/generate-bots.mjs <catalog-parts-dir>");
  process.exit(1);
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// deterministic hash → 0..1
const hash01 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
};

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ---------- parse ----------
const parts = readdirSync(SRC_DIR)
  .filter((f) => /^p(0[1-9]|10)\.html$/.test(f))
  .sort();

const sections = [];
for (const file of parts) {
  const html = readFileSync(join(SRC_DIR, file), "utf8");
  const sectionRe =
    /<section class="cat" id="(c\d+)" data-grp="([^"]+)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = sectionRe.exec(html))) {
    const [, id, grp, body] = m;
    const h2 = decode(/<h2>([\s\S]*?)<\/h2>/.exec(body)[1]);
    const who = decode(
      /<p class="who"><b>Who pays:<\/b>\s*([\s\S]*?)<\/p>/.exec(body)[1]
    );
    const items = [];
    const liRe = /<li><b>([\s\S]*?)<\/b>\s*—\s*([\s\S]*?)\s*<i>([\s\S]*?)<\/i><\/li>/g;
    let li;
    while ((li = liRe.exec(body))) {
      items.push({
        name: decode(li[1]).trim(),
        desc: decode(li[2]).replace(/\s+/g, " ").trim().replace(/\.$/, ""),
        toolkits: decode(li[3])
          .split("·")
          .map((t) => t.trim().replace(/^BigQuery via /, "")),
      });
    }
    sections.push({ id, group: decode(grp), category: h2, whoPays: who, items });
  }
}

// ---------- enrichment ----------
const ARCHETYPES = [
  { key: "triager", words: ["triage", "classif", "route", "qualif", "screen", "intake", "vets ", "dedupe"] },
  { key: "chaser", words: ["chase", "remind", "nudge", "follow-up", "follow up", "overdue", "dunning", "recover", "re-engag", "chasing", "nags", "escalat"] },
  { key: "reporter", words: ["report", "digest", "dashboard", "summar", "brief", "pack", "deck", "recap", "monthly", "weekly view", "rollup", "snapshot", "readout", "wrapped", "almanac", "statement"] },
  { key: "drafter", words: ["draft", "write", "compose", "replies", "reply", "respond", "answers", "generat", "assembl", "turns ", "pitch"] },
  { key: "scheduler", words: ["schedul", "book", "calendar", "confirm", "reschedul", "slot", "appointment", "coordinates", "invit"] },
  { key: "watcher", words: ["watch", "monitor", "alert", "flag", "detect", "spot", "track", "radar", "sentinel", "siren", "alarm", "guard", "warning", "tripwire"] },
  { key: "organizer", words: ["file", "organiz", "logs", "sync", "maintain", "keeps", "ledger", "register", "librarian", "archiv", "catalog", "collect", "vault"] },
];

const detectArchetype = (bot) => {
  const text = (bot.name + " " + bot.desc).toLowerCase();
  let best = "operator";
  let bestIdx = Infinity;
  for (const a of ARCHETYPES) {
    for (const w of a.words) {
      const idx = text.indexOf(w);
      if (idx !== -1 && idx < bestIdx) {
        bestIdx = idx;
        best = a.key;
      }
    }
  }
  return best;
};

const PRO_WORDS = ["deck", "qbr", "board pack", "investor", "proposal", "transcript", "postmortem", "portfolio", "forecast", "quarterly", "annual", "synthes", "campaign", "white-label", "client-facing", "monthly pack", "wrap report", "case stud"];
const HEAVY_WORDS = ["gong", "fathom", "bigquery", "across all", "every client", "all client", "month of", "pipeline", "reconcil"];

const tierOf = (bot) => {
  const text = (bot.name + " " + bot.desc).toLowerCase();
  let score = 0;
  score += Math.min(bot.toolkits.length - 1, 2); // 1tk=0, 2tk=1, 3+=2
  if (PRO_WORDS.some((w) => text.includes(w))) score += 2;
  if (HEAVY_WORDS.some((w) => text.includes(w))) score += 1;
  if (bot.archetype === "reporter" || bot.archetype === "drafter") score += 1;
  if (["watcher", "chaser", "organizer", "scheduler"].includes(bot.archetype)) score -= 1;
  if (score <= 0) return "lite";
  if (score <= 2) return "standard";
  return "pro";
};

const TIER_META = {
  lite: { label: "Lite", price: 5, runs: 300, model: "fast mini models" },
  standard: { label: "Standard", price: 9, runs: 500, model: "fast models with a quality drafting step" },
  pro: { label: "Pro", price: 19, runs: 1000, model: "premium models for synthesis and client-facing output" },
};

const RATES = {
  "Business & revenue": 60,
  "Freelance & agency": 65,
  "Creators": 50,
  "Vertical small business": 45,
  "Teams inside companies": 70,
  "Individuals": 35,
};

const HOURS_BASE = {
  triager: 10, chaser: 5, reporter: 7, drafter: 8,
  scheduler: 5, watcher: 4, organizer: 4, operator: 6,
};

const stepsFor = (bot) => {
  const tk = bot.toolkits;
  const t0 = tk[0];
  const tLast = tk[tk.length - 1];
  const connect = `Connect ${tk.join(", ")} with one click each — OAuth handled for you, no API keys.`;
  const byArch = {
    triager: [
      connect,
      `Every time something new lands in ${t0}, the agent reads it and decides what it is and how urgent it is.`,
      `It applies your rules: labels, assigns, prioritizes, or escalates${tk.length > 1 ? ` into ${tLast}` : ""} — the busywork a human would do first thing each morning.`,
      `Anything ambiguous gets flagged for you instead of guessed at, with its reasoning attached.`,
      `You review a clean, sorted queue instead of a raw pile.`,
    ],
    chaser: [
      connect,
      `The agent keeps a live list of everything waiting on someone else — pulled straight from ${t0}.`,
      `It sends polite, escalating follow-ups on your schedule (for example day 3, day 7, day 14), each one written to match the relationship.`,
      `The moment the other side responds or pays, it stops automatically and marks the item done.`,
      `You get a short note only when something needs a human decision.`,
    ],
    reporter: [
      connect,
      `On its schedule, the agent pulls fresh numbers and activity from ${tk.slice(0, -1).join(", ") || t0}.`,
      `It turns raw data into a readable narrative — what changed, why it matters, what to do next — not just a table of numbers.`,
      `The finished report is delivered${tk.length > 1 ? ` via ${tLast}` : ""} before you'd normally even start compiling it.`,
      `You skim in two minutes what used to take an afternoon to assemble.`,
    ],
    drafter: [
      connect,
      `When the trigger fires (a new message, ticket, or scheduled moment), the agent gathers the relevant context from ${t0}.`,
      `It writes a complete draft in your voice, using your past examples and rules as the template.`,
      `Nothing goes out without you: the draft waits for your one-click approve or quick edit.`,
      `Over time you approve more and edit less, and minutes-per-item drops toward zero.`,
    ],
    scheduler: [
      connect,
      `The agent watches for booking requests and scheduling threads in ${t0}.`,
      `It checks real availability, proposes times, handles the back-and-forth, and books the slot${tk.length > 1 ? ` in ${tk.find((x) => /calendar|calendly|cal\b/i.test(x)) || tLast}` : ""}.`,
      `Confirmations and reminders go out automatically, and cancellations trigger instant backfill from your waitlist.`,
      `Your calendar fills itself; no-shows drop.`,
    ],
    watcher: [
      connect,
      `The agent checks ${t0} continuously on your chosen cadence.`,
      `It knows your thresholds — what's normal and what's worth interrupting you for — so it stays silent until something actually matters.`,
      `When a threshold is crossed, you get one clear alert with context and a suggested next step${tk.length > 1 ? `, delivered via ${tLast}` : ""}.`,
      `You stop checking dashboards; the dashboard checks itself.`,
    ],
    organizer: [
      connect,
      `As new items appear in ${t0}, the agent captures them before they get lost.`,
      `It names, tags, and files everything by your conventions${tk.length > 1 ? `, keeping ${tLast} as the organized source of truth` : ""}.`,
      `It maintains the system continuously — no quarterly cleanup days, no "where did that go?"`,
      `Everything is findable in seconds, forever.`,
    ],
    operator: [
      connect,
      `On its trigger or schedule, the agent runs the full workflow end-to-end across ${tk.join(", ")}.`,
      `Each step follows your playbook — the same way every time, no skipped steps, no forgotten edge cases.`,
      `Anything requiring judgment is paused and surfaced to you with full context.`,
      `You supervise outcomes instead of doing the steps.`,
    ],
  };
  return byArch[bot.archetype] || byArch.operator;
};

const WHY = {
  triager: "Sorting and routing is pure overhead — necessary, repetitive, and the first thing to pile up when you're busy. This bot does it instantly and consistently, so the important items get attention while they're still fresh.",
  chaser: "Follow-ups are where money quietly dies: most unanswered messages are forgotten, not rejected. A bot never feels awkward about the third nudge and never forgets one, which is exactly why it out-collects humans.",
  reporter: "The information already exists — the cost is assembling it. This bot removes the assembly step entirely, so decisions get made on fresh data instead of last month's, and the recurring 'can you pull together…' request disappears.",
  drafter: "First drafts are 80% of the effort and 20% of the judgment. The agent does the 80%; you keep the 20% that actually needs you. Response times collapse without your standards slipping, because every word still gets your approval.",
  scheduler: "Every booking is 5–10 messages of coordination that produce zero value themselves. Automating the ping-pong means faster confirmations, fewer no-shows, and a calendar that fills without you touching it.",
  watcher: "Problems are cheap when caught early and expensive when caught late. Continuous monitoring with smart thresholds means you find out in minutes, not at month-end — without burning your own attention on routine checking.",
  organizer: "Disorganization is a tax you pay on every future search. Paying it continuously and automatically — instead of in painful quarterly cleanups — keeps the whole system trustworthy, which is what makes everything else faster.",
  operator: "Multi-step processes fail at the handoffs — a skipped step here, a forgotten edge case there. Running the whole workflow as one reliable loop removes the gaps, and frees you to handle only the genuinely unusual cases.",
};

const bots = [];
const usedSlugs = new Set();
let num = 0;
for (const s of sections) {
  for (const item of s.items) {
    num++;
    let slug = slugify(item.name);
    if (usedSlugs.has(slug)) slug = `${slug}-${slugify(s.category).split("-")[0]}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${num}`;
    usedSlugs.add(slug);

    const bot = {
      id: num,
      slug,
      name: item.name,
      desc: item.desc,
      toolkits: item.toolkits,
      category: s.category,
      group: s.group,
      whoPays: s.whoPays,
    };
    bot.archetype = detectArchetype(bot);
    bot.tier = tierOf(bot);
    const meta = TIER_META[bot.tier];
    bot.price = meta.price;
    bot.runs = meta.runs;

    const jitter = 0.7 + hash01(slug) * 0.7; // 0.7–1.4
    const tierMult = bot.tier === "pro" ? 1.5 : bot.tier === "standard" ? 1.15 : 0.85;
    const hours = Math.max(2, Math.round(HOURS_BASE[bot.archetype] * jitter * tierMult));
    const rate = RATES[s.group] || 50;
    const money = Math.round((hours * rate) / 10) * 10;
    bot.timeSavedHrs = hours;
    bot.moneySavedUsd = money;
    bot.steps = stepsFor(bot);
    bot.why = WHY[bot.archetype];
    bots.push(bot);
  }
}

if (bots.length !== 1000) {
  console.error(`expected 1000 bots, got ${bots.length}`);
  process.exit(1);
}

const dist = bots.reduce((a, b) => ((a[b.tier] = (a[b.tier] || 0) + 1), a), {});
console.log("tier distribution:", dist);
console.log(
  "archetypes:",
  bots.reduce((a, b) => ((a[b.archetype] = (a[b.archetype] || 0) + 1), a), {})
);

mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/bots.json", JSON.stringify(bots));

// slim list for the client-side catalog
const lite = bots.map((b) => ({
  slug: b.slug,
  name: b.name,
  desc: b.desc,
  toolkits: b.toolkits,
  category: b.category,
  group: b.group,
  tier: b.tier,
  price: b.price,
}));
writeFileSync("src/data/catalog.json", JSON.stringify(lite));

const categories = sections.map((s) => ({
  category: s.category,
  group: s.group,
  count: s.items.length,
}));
writeFileSync("src/data/categories.json", JSON.stringify(categories));
console.log(`wrote ${bots.length} bots, ${categories.length} categories`);
