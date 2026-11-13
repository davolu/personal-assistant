import { register } from "node:module";

const hookUrl = new URL("./e2b-resolve-hook.mjs", import.meta.url);
let pending;

/** Load `@e2b/desktop` through its ESM build. Safe to call more than once. */
export function loadE2BDesktop() {
  pending ??= Promise.resolve(register(hookUrl, { parentURL: import.meta.url })).then(() => import("@e2b/desktop"));
  return pending;
}
