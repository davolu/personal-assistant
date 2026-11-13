import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_CATALOG, SITE } from "./site";

function landingSource() {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dir = new URL("../components/landing/", import.meta.url);
  const parts = readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => readFileSync(new URL(name, dir), "utf8"));
  return [page, ...parts].join("\n");
}

test("public copy presents AgentDocker and a path to agentic chat", () => {
  assert.equal(SITE.name, "AgentDocker");
  assert.equal(SITE.domain, "agentdocker.io");
  assert.match(`${SITE.hero.titleLead} ${SITE.hero.titleRest}`, /Create autonomous agents by chatting/);
  const subtitleSentences = SITE.hero.subtitle.split(/(?<=\.)\s+/).filter(Boolean);
  assert.ok(subtitleSentences.length >= 1 && subtitleSentences.length <= 2);
  assert.match(SITE.hero.subtitle, /no code/i);
  assert.ok(SITE.hero.promises.length >= 3 && SITE.hero.promises.length <= 4);
  assert.match(SITE.hero.promises.join(" "), /tools/i);
  assert.match(SITE.hero.promises.join(" "), /apps/i);
  assert.match(SITE.hero.promises.join(" "), /cloud desktop/i);
  assert.match(SITE.hero.promises.join(" "), /risky/i);
  assert.match(SITE.hero.subtitle, /fails/i);
  assert.equal(SITE.hero.ctaHref, "/agentic-chat");
  assert.equal(SITE.signInTitle, "Welcome back to AgentDocker");
  assert.doesNotMatch(`${SITE.name} ${SITE.tagline} ${SITE.description} ${SITE.hero.subtitle}`, /personal assistant/i);

  const page = landingSource();
  assert.doesNotMatch(page, /AgentDock(?!er)/);
  assert.match(page, /SITE\.hero\.ctaHref/);
  assert.match(page, /SITE\.hero\.titleLead/);
  assert.equal(SITE.hero.secondaryHref, "#how-it-works");
  assert.match(page, /id="how-it-works"/);
  assert.match(page, /Autonomous agents vs chatbots/);
  assert.match(page, /APP_CATALOG\.label/);
  assert.match(page, /APP_CATALOG\.credit/);
  assert.doesNotMatch(page, /1,500/);
  assert.doesNotMatch(page, /\b(claude|gpt-?[0-9]|gemini|llama|mistral|anthropic|openai)\b/i);
  const form = readFileSync(new URL("../components/AuthForm.tsx", import.meta.url), "utf8");
  assert.match(form, /SITE\.signInTitle/);
  assert.match(form, /SITE\.signInSubtitle/);
  const manifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  assert.match(manifest, /SITE\.name/);
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /metadataBase: new URL\(`https:\/\/\$\{SITE\.domain\}`\)/);
  assert.match(layout, /canonical: "\.\/"/);
  assert.match(layout, /siteName: SITE\.name/);
  const icon = readFileSync(new URL("../../public/icon.svg", import.meta.url), "utf8");
  assert.match(icon, /<title>AgentDocker<\/title>/);
  assert.match(icon, /aria-label="AgentDocker"/);
  const nav = readFileSync(new URL("../components/Nav.tsx", import.meta.url), "utf8");
  assert.match(nav, /LOGO_WORDMARK/);
  assert.doesNotMatch(nav, /SITE\.name/);
  const footer = readFileSync(new URL("../components/Footer.tsx", import.meta.url), "utf8");
  assert.match(footer, /LOGO_WORDMARK/);
  assert.match(footer, /© 2026 \{SITE\.name\}/);
  const mark = readFileSync(new URL("../components/illustrations.tsx", import.meta.url), "utf8");
  assert.match(mark, /export const LOGO_WORDMARK = "AgentDocker\.io"/);
  assert.equal(APP_CATALOG.label, "Over 1,500 apps supported");
  assert.equal(APP_CATALOG.credit, "Powered by Composio");
  const apps = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8");
  assert.match(apps, /APP_CATALOG\.label/);
  assert.match(apps, /APP_CATALOG\.credit/);
  assert.equal(apps.includes("apps.length"), false);
  const pricing = readFileSync(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
  assert.match(pricing, /APP_CATALOG\.label/);
  assert.equal(pricing.includes("100+"), false);
});
