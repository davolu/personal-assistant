import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/**
 * `@e2b/desktop` and `e2b` publish a CommonJS `main` that `require()`s ESM-only
 * `chalk`. Node's default import of the package name therefore throws
 * ERR_REQUIRE_ESM where `require(esm)` is disabled. Send those specifiers at
 * the ESM builds, which import chalk instead of requiring it.
 */
const esmEntry = {
  e2b: pathToFileURL(require.resolve("e2b/dist/index.mjs")).href,
  "@e2b/desktop": pathToFileURL(require.resolve("@e2b/desktop/dist/index.mjs")).href,
};

export async function resolve(specifier, context, nextResolve) {
  const target = esmEntry[specifier];
  if (target) return { url: target, shortCircuit: true };
  return nextResolve(specifier, context);
}
