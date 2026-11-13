import { lookup } from "node:dns/promises";
import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const WEB_TEXT_LIMIT = 20_000;
export const WEB_FETCH_TIMEOUT_MS = 15_000;
const RAW_BODY_LIMIT = 200_000;
const MAX_FETCH_HOPS = 5;

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Wikimedia asks clients to identify themselves. This is not a browser impersonation. */
export const WIKIPEDIA_USER_AGENT = "AgentDocker/0.1 (https://agentdocker.io; search_web wikipedia)";

const CHALLENGE_MARKERS = [
  "anomaly-modal",
  "bots use duckduckgo",
  "challenge-form",
  "anomaly.js",
  "please complete the following challenge",
];

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
  "metadata.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export type DirectProvider = "brave" | "duckduckgo" | "duckduckgo_lite" | "tavily" | "wikipedia";

export type SearchHit = { title: string; url: string; snippet: string };

export type WebOutcome = { content: string; isError: boolean; effect: "read" };

export type Resolver = (hostname: string) => Promise<string[]>;

export type PublicResponse = { status: number; headers: Headers; body: string };

export type PublicRequest = (
  url: URL,
  address: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<PublicResponse>;

export type WebRouteDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  resolve?: Resolver;
  request?: PublicRequest;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
  };
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) return blocked.check(ip, "ipv6");
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.localdomain") return true;
  if (METADATA_HOSTS.has(host) || host.endsWith(".metadata.google.internal") || host.endsWith(".metadata.internal")) return true;
  if (isAmbiguousNumericHost(host)) return true;
  if (isIP(host)) return isPrivateAddress(host);
  return false;
}

function isAmbiguousNumericHost(hostname: string): boolean {
  if (isIP(hostname)) return false;
  return /^[\d.]+$/.test(hostname) || /^(?:0x[0-9a-f]+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(hostname);
}

export function availableSearchProviders(env: Record<string, string | undefined> = process.env): DirectProvider[] {
  const providers: DirectProvider[] = [];
  if (env.BRAVE_SEARCH_API_KEY?.trim()) providers.push("brave");
  providers.push("duckduckgo", "duckduckgo_lite", "wikipedia");
  if (env.TAVILY_API_KEY?.trim()) providers.push("tavily");
  return providers;
}

export function decodeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
    const token = body.toLowerCase();
    if (token.startsWith("#x")) return codePoint(Number.parseInt(token.slice(2), 16), entity);
    if (token.startsWith("#")) return codePoint(Number.parseInt(token.slice(1), 10), entity);
    return NAMED_ENTITIES[token] ?? entity;
  });
}

function codePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

export function htmlToText(html: string, limit = WEB_TEXT_LIMIT): string {
  let src = html;
  src = src.replace(/<(script|style|noscript|svg|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  src = src.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, inner: string) => {
    const href = decodeHtml(attr(attrs, "href"));
    const label = inlineText(inner);
    if (!href) return label;
    if (!label || label === href) return href;
    return `[${label}](${href})`;
  });
  src = src.replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `\n${"#".repeat(Number(level))} `);
  src = src.replace(/<li\b[^>]*>/gi, "\n- ");
  src = src.replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote)\b[^>]*>/gi, "\n");
  src = src.replace(/<[^>]+>/g, " ");
  src = decodeHtml(src);
  src = src
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return src.slice(0, limit);
}

function inlineText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.slice(1).find((part) => part != null) ?? "";
}

export function readableText(body: string, contentType: string, limit = WEB_TEXT_LIMIT): string {
  const type = contentType.toLowerCase();
  const start = body.trimStart();
  if (type.includes("json")) return body.slice(0, limit);
  if (type.includes("html") || type.includes("xml") || start.startsWith("<")) return htmlToText(body, limit);
  if (!type && (start.startsWith("{") || start.startsWith("["))) return body.slice(0, limit);
  return body.slice(0, limit);
}

export function duckDuckGoTarget(href: string): string {
  const decoded = decodeHtml(href).trim();
  if (!decoded) return "";
  const absolute = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  try {
    const url = new URL(absolute, "https://html.duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target || url.toString();
  } catch {
    return absolute;
  }
}

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const parts = html.split(/<div\b[^>]*\bclass\s*=\s*(?:"[^"]*\bresult\b[^"]*"|'[^']*\bresult\b[^']*')[^>]*>/i).slice(1);
  for (const block of parts) {
    const link = findAnchor(block, "result__a");
    if (!link) continue;
    const title = inlineText(link.inner);
    const url = duckDuckGoTarget(link.href);
    if (!title || !url) continue;
    const snippet = findAnchor(block, "result__snippet");
    hits.push({ title, url, snippet: snippet ? inlineText(snippet.inner) : "" });
  }
  return hits;
}

export function parseDuckDuckGoLite(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe = /<a\b([^>]*\bclass\s*=\s*(?:"[^"]*\bresult-link\b[^"]*"|'[^']*\bresult-link\b[^']*')[^>]*)>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkRe)];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const title = inlineText(link[2] ?? "");
    const url = duckDuckGoTarget(decodeHtml(attr(link[1] ?? "", "href")));
    if (!title || !url) continue;
    const start = link.index ?? 0;
    const next = links[i + 1]?.index ?? html.length;
    const snippet = html
      .slice(start, next)
      .match(/<td\b[^>]*\bclass\s*=\s*(?:"[^"]*\bresult-snippet\b[^"]*"|'[^']*\bresult-snippet\b[^']*')[^>]*>([\s\S]*?)<\/td>/i);
    hits.push({ title, url, snippet: snippet ? inlineText(snippet[1]) : "" });
  }
  return hits;
}

/** DuckDuckGo's bot wall. A normal results page does not contain these. */
export function isSearchChallenge(html: string): boolean {
  const sample = html.slice(0, 30_000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => sample.includes(marker));
}

export function wikipediaHits(value: unknown): SearchHit[] {
  if (!value || typeof value !== "object") return [];
  const pages = (value as { query?: { pages?: unknown } }).query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const hits: { index: number; hit: SearchHit }[] = [];
  for (const row of Object.values(pages as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const page = row as Record<string, unknown>;
    const title = String(page.title ?? "").trim();
    const url = String(page.fullurl ?? "").trim();
    if (!title || !url) continue;
    const index = Number(page.index);
    hits.push({
      index: Number.isFinite(index) ? index : hits.length + 1,
      hit: { title, url, snippet: inlineText(String(page.extract ?? "")) },
    });
  }
  return hits
    .sort((a, b) => a.index - b.index)
    .slice(0, 8)
    .map((item) => item.hit);
}

function findAnchor(block: string, className: string): { href: string; inner: string } | null {
  const found = block.match(new RegExp(`<a\\b[^>]*\\b${className}\\b[^>]*>[\\s\\S]*?<\\/a>`, "i"));
  if (!found) return null;
  const tag = found[0];
  const open = tag.match(/^<a\b([^>]*)>/i);
  const href = decodeHtml(attr(open?.[1] ?? "", "href"));
  const inner = tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "");
  return { href, inner };
}

export function formatSearchResults(provider: string, results: SearchHit[]): string {
  return JSON.stringify({ provider, results }).slice(0, 8000);
}

export async function resolvePublicHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function publicAddressOf(
  raw: string,
  resolve: Resolver = resolvePublicHost
): Promise<{ ok: true; url: URL; address: string } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only public http and https URLs can be read." };
  }
  const host = url.hostname.replace(/\.$/, "");
  if (isBlockedHostname(host)) return { ok: false, error: "That address is not public." };
  let addresses: string[] = [];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      return { ok: false, error: "Could not resolve that host." };
    }
  }
  if (!addresses.length) return { ok: false, error: "Could not resolve that host." };
  for (const address of addresses) {
    if (!isIP(address) || isPrivateAddress(address)) return { ok: false, error: "That address is not public." };
  }
  return { ok: true, url, address: addresses[0] };
}

export async function readPublicUrl(
  raw: string,
  deps: { resolve?: Resolver; request?: PublicRequest; timeoutMs?: number } = {}
): Promise<{ ok: true; text: string; contentType: string } | { ok: false; error: string }> {
  const resolve = deps.resolve ?? resolvePublicHost;
  const request = deps.request ?? defaultRequest;
  const timeoutMs = deps.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  let current = raw.trim();
  for (let hop = 0; hop < MAX_FETCH_HOPS; hop++) {
    const checked = await publicAddressOf(current, resolve);
    if (!checked.ok) return checked;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: PublicResponse;
    try {
      response = await request(checked.url, checked.address, { headers: browserHeaders(), signal });
    } catch (err) {
      const timedOut = signal.aborted || (err instanceof Error && (err.name === "TimeoutError" || err.message === "timeout"));
      return { ok: false, error: timedOut ? "The page took too long to respond." : "The page could not be read." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: "The page redirected without a destination." };
      try {
        current = new URL(location, checked.url).href;
      } catch {
        return { ok: false, error: "The page redirected to an invalid URL." };
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, error: `The page returned HTTP ${response.status}.` };
    const contentType = response.headers.get("content-type") ?? "";
    return { ok: true, text: readableText(response.body, contentType), contentType };
  }
  return { ok: false, error: "The page redirected too many times." };
}

export async function runSearchWeb(
  args: Record<string, unknown>,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}
): Promise<WebOutcome> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const query = String(args.query ?? "").trim();
  if (!query) return { content: "query is required", isError: true, effect: "read" };
  const requested = String(args.provider ?? "").trim().toLowerCase();
  const provider = requested || "duckduckgo";
  const available = availableSearchProviders(env);
  if (!available.includes(provider as DirectProvider)) return { content: "That provider is not available.", isError: true, effect: "read" };
  const result = await searchOne(query, provider as DirectProvider, env, fetchImpl);
  if (!result.ok) return { content: result.error, isError: true, effect: "read" };
  return { content: formatSearchResults(provider, result.results), isError: false, effect: "read" };
}

async function searchOne(
  query: string,
  provider: DirectProvider,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch
): Promise<{ ok: true; results: SearchHit[] } | { ok: false; error: string }> {
  try {
    if (provider === "tavily") return await searchTavily(query, env.TAVILY_API_KEY?.trim() ?? "", fetchImpl);
    if (provider === "brave") return await searchBrave(query, env.BRAVE_SEARCH_API_KEY?.trim() ?? "", fetchImpl);
    if (provider === "wikipedia") return await searchWikipedia(query, fetchImpl);
    if (provider === "duckduckgo_lite") return await searchDuckDuckGoLite(query, fetchImpl);
    return await searchDuckDuckGo(query, fetchImpl);
  } catch (err) {
    return { ok: false, error: providerFailure(provider, err) };
  }
}

async function searchTavily(query: string, key: string, fetchImpl: typeof fetch) {
  if (!key) return { ok: false as const, error: "That provider is not available." };
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    redirect: "manual",
    headers: { ...browserHeaders(), Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5 }),
    signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return { ok: false as const, error: `tavily failed (HTTP ${response.status})` };
  const data = await readJson(response);
  if (!data.ok) return { ok: false as const, error: "tavily returned an unreadable response" };
  const results = data.value && typeof data.value === "object" && "results" in data.value ? (data.value as { results?: unknown }).results : undefined;
  return finishHits("tavily", hitsFromList(results));
}

async function searchBrave(query: string, key: string, fetchImpl: typeof fetch) {
  if (!key) return { ok: false as const, error: "That provider is not available." };
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "5");
  const response = await fetchImpl(endpoint, {
    method: "GET",
    redirect: "manual",
    headers: { ...browserHeaders(), Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return { ok: false as const, error: `brave failed (HTTP ${response.status})` };
  const data = await readJson(response);
  if (!data.ok) return { ok: false as const, error: "brave returned an unreadable response" };
  const web = data.value && typeof data.value === "object" && "web" in data.value ? (data.value as { web?: { results?: unknown } }).web : undefined;
  return finishHits("brave", hitsFromList(web?.results));
}

async function searchDuckDuckGo(query: string, fetchImpl: typeof fetch) {
  return postDuckDuckGo(
    "duckduckgo",
    "https://html.duckduckgo.com/html/",
    "https://html.duckduckgo.com",
    { q: query, b: "" },
    fetchImpl,
    parseDuckDuckGoHtml
  );
}

async function searchDuckDuckGoLite(query: string, fetchImpl: typeof fetch) {
  return postDuckDuckGo(
    "duckduckgo_lite",
    "https://lite.duckduckgo.com/lite/",
    "https://lite.duckduckgo.com",
    { q: query },
    fetchImpl,
    parseDuckDuckGoLite
  );
}

async function postDuckDuckGo(
  provider: "duckduckgo" | "duckduckgo_lite",
  endpoint: string,
  origin: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
  parse: (html: string) => SearchHit[]
) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "manual",
    headers: duckDuckGoFormHeaders(origin),
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
  });
  const html = await response.text();
  return classifyHtmlSearch(provider, response.status, html, parse(html));
}

function duckDuckGoFormHeaders(origin: string): Record<string, string> {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "max-age=0",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: origin,
    Referer: `${origin}/`,
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
  };
}

async function searchWikipedia(query: string, fetchImpl: typeof fetch) {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("generator", "search");
  endpoint.searchParams.set("gsrsearch", query);
  endpoint.searchParams.set("gsrlimit", "5");
  endpoint.searchParams.set("prop", "extracts|info");
  endpoint.searchParams.set("inprop", "url");
  endpoint.searchParams.set("exintro", "1");
  endpoint.searchParams.set("explaintext", "1");
  endpoint.searchParams.set("exchars", "240");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("utf8", "1");
  const response = await fetchImpl(endpoint, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json", "User-Agent": WIKIPEDIA_USER_AGENT, "Api-User-Agent": WIKIPEDIA_USER_AGENT },
    signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
  });
  if (response.status === 403 || response.status === 429) return { ok: false as const, error: blockedMessage("wikipedia") };
  if (!response.ok) return { ok: false as const, error: `wikipedia failed (HTTP ${response.status})` };
  const data = await readJson(response);
  if (!data.ok) return { ok: false as const, error: "wikipedia returned an unreadable response" };
  return finishHits("wikipedia", wikipediaHits(data.value));
}

function classifyHtmlSearch(
  provider: string,
  status: number,
  html: string,
  results: SearchHit[]
): { ok: true; results: SearchHit[] } | { ok: false; error: string } {
  const challenge = isSearchChallenge(html);
  if (results.length > 0 && status >= 200 && status < 300 && status !== 202 && !challenge) {
    return { ok: true, results: results.slice(0, 8) };
  }
  if (status === 202 || status === 403 || challenge) return { ok: false, error: blockedMessage(provider) };
  if (status < 200 || status >= 300) return { ok: false, error: `${provider} failed (HTTP ${status})` };
  return { ok: false, error: emptyMessage(provider) };
}

function finishHits(provider: string, results: SearchHit[]): { ok: true; results: SearchHit[] } | { ok: false; error: string } {
  if (results.length === 0) return { ok: false, error: emptyMessage(provider) };
  return { ok: true, results: results.slice(0, 8) };
}

function blockedMessage(provider: string): string {
  return `${provider} blocked this request. It returned an anomaly or captcha page and no results. Choose another provider or fetch_url.`;
}

function emptyMessage(provider: string): string {
  return `${provider} returned nothing. Choose another provider or fetch_url.`;
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

function hitsFromList(value: unknown): SearchHit[] {
  if (!Array.isArray(value)) return [];
  const hits: SearchHit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    const url = String(row.url ?? "").trim();
    const snippet = String(row.content ?? row.snippet ?? row.description ?? "").trim();
    if (!title && !url) continue;
    hits.push({ title, url, snippet });
  }
  return hits.slice(0, 8);
}

function providerFailure(provider: string, err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return `${provider} timed out`;
  return `${provider} failed`;
}

function pinLookup(address: string) {
  const family = isIP(address) === 6 ? 6 : 4;
  return (_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;
    const all = typeof options === "object" && options !== null && "all" in options && Boolean((options as { all?: boolean }).all);
    if (all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

function defaultRequest(url: URL, address: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<PublicResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: PublicResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error("The page could not be read."));
    };
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      servername: url.protocol === "https:" ? url.hostname : undefined,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: init.headers,
      agent: false,
      timeout: WEB_FETCH_TIMEOUT_MS,
      lookup: pinLookup(address),
    };
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer | string) => {
        if (size >= RAW_BODY_LIMIT) {
          res.destroy();
          return;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const room = RAW_BODY_LIMIT - size;
        chunks.push(buf.length > room ? buf.subarray(0, room) : buf);
        size += Math.min(buf.length, room);
        if (size >= RAW_BODY_LIMIT) res.destroy();
      });
      const done = () => {
        finish({
          status: res.statusCode ?? 0,
          headers: headersFrom(res.headers),
          body: Buffer.concat(chunks).toString("utf8"),
        });
      };
      res.on("end", done);
      res.on("error", done);
    });
    const abort = () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      req.destroy(error);
      fail(error);
    };
    if (init.signal.aborted) {
      abort();
      return;
    }
    init.signal.addEventListener("abort", abort, { once: true });
    req.on("timeout", abort);
    req.on("error", fail);
    req.end();
  });
}

function headersFrom(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers.append(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}
