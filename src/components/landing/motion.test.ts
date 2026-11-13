import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("landing scroll motion stays on transform and opacity and turns off for reduced motion", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
  const reveal = readFileSync(new URL("./Reveal.tsx", import.meta.url), "utf8");
  const motion = readFileSync(new URL("./motion.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./ChatMock.tsx", import.meta.url), "utf8");

  assert.match(page, /ld-hero/);
  assert.match(page, /ld-words/);
  assert.match(page, /ld-tilt/);
  assert.match(page, /ld-rail/);
  assert.match(page, /ld-cta/);
  assert.match(page, /SITE\.hero\.titleLead/);
  assert.match(css, /@keyframes ld-word-in/);
  assert.match(css, /@keyframes ld-pop/);
  assert.match(css, /@keyframes ld-rail-x/);
  assert.match(css, /@keyframes ld-scale/);
  assert.match(css, /@keyframes ld-draw/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(reveal, /prefers-reduced-motion: reduce/);
  assert.match(reveal, /IntersectionObserver/);
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(motion, /translate3d/);
  assert.match(chat, /prefers-reduced-motion: reduce/);
  assert.match(chat, /useState\(false\)/);
});
