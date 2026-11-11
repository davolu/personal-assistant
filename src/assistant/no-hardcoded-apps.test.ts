import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/** Connect-page names and the trigger fallback are the only allowed lists. */
const ALLOW = new Set(["src/lib/toolkits.ts", "src/lib/triggers.ts"]);
const BANNED = /\b(heygen|elevenlabs|runway|descript|canva|notion)\b/i;
const RANKING = /\/SEND_\/|\/FETCH_EMAILS\/|rankActions|rankCatalogTools|selectToolkitSlugs|rankChipLabels|orderCatalogActions/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

test("runtime source does not hardcode toolkit names", () => {
  const hits: string[] = [];
  for (const file of files("src")) {
    const rel = file.split(path.sep).join("/");
    if (rel.endsWith(".test.ts") || rel.includes("/fixtures/")) continue;
    if (ALLOW.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    if (BANNED.test(source) || RANKING.test(source)) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});
