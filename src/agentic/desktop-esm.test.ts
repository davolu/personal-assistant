import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../package.json", import.meta.url)).replace(/package\.json$/, "");

test("cloud desktop is loaded with a dynamic ESM import and is not a required server external", () => {
  const desktop = readFileSync(new URL("./desktop.ts", import.meta.url), "utf8");
  const loader = readFileSync(new URL("./e2b-desktop-loader.mjs", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

  assert.match(desktop, /turbopackIgnore:\s*true/);
  assert.match(desktop, /webpackIgnore:\s*true/);
  assert.match(desktop, /e2b-desktop-loader\.mjs/);
  assert.doesNotMatch(desktop, /require\(\s*["']@e2b\/desktop["']\s*\)/);
  assert.doesNotMatch(desktop, /(?<!typeof )import\(\s*["']@e2b\/desktop["']\s*\)/);

  assert.match(loader, /import\(\s*["']@e2b\/desktop["']\s*\)/);
  assert.match(loader, /e2b-resolve-hook\.mjs/);
  assert.doesNotMatch(loader, /require\(\s*["']@e2b\/desktop["']\s*\)/);

  const externalBlock = config.slice(config.indexOf("serverExternalPackages"), config.indexOf("outputFileTracingIncludes"));
  assert.doesNotMatch(externalBlock, /["']@e2b\/desktop["']/);
  assert.doesNotMatch(externalBlock, /["']e2b["']/);
  assert.match(config, /["']\/api\/agentic-chat\/route["']/);
  assert.match(config, /["']\/api\/inngest\/route["']/);
  assert.match(config, /e2b-desktop-loader\.mjs/);
  assert.match(config, /e2b-resolve-hook\.mjs/);
  assert.match(config, /node_modules\/@e2b\/desktop/);
  assert.match(config, /node_modules\/e2b/);
});

test("desktop ESM entry reports a missing API key instead of ERR_REQUIRE_ESM", () => {
  const script = `
    import { loadE2BDesktop } from "./src/agentic/e2b-desktop-loader.mjs";
    delete process.env.E2B_API_KEY;
    const { Sandbox } = await loadE2BDesktop();
    try {
      await Sandbox.create({ apiKey: "" });
      console.log("RESULT unexpected-success");
    } catch (err) {
      const code = err && err.code ? String(err.code) : "";
      const message = err instanceof Error ? err.message : String(err);
      console.log("RESULT " + code + " " + message.split("\\n")[0]);
    }
  `;
  const env = { ...process.env };
  delete env.E2B_API_KEY;
  const result = spawnSync(process.execPath, ["--no-experimental-require-module", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ERR_REQUIRE_ESM/);
  assert.match(output, /API key is required/);
});
