import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { readBudgets } from "./budgets";
import type { ClaudeTurn } from "./claude";
import { compileAgenticGraph, defaultDeps, threadConfig } from "./graph";
import { systemPrompt } from "./prompts";
import { createProductionTools } from "./runtime";
import type { RunMeter } from "./run-guard";
import { FETCH_URL_TOOL, TOOL_SCHEMAS, searchWebTool } from "./tools";
import {
  BROWSER_USER_AGENT,
  WEB_FETCH_TIMEOUT_MS,
  WEB_TEXT_LIMIT,
  availableSearchProviders,
  htmlToText,
  isBlockedHostname,
  isPrivateAddress,
  parseDuckDuckGoHtml,
  readPublicUrl,
  runSearchWeb,
  type PublicRequest,
  type Resolver,
} from "./web-route";

const fixture = readFileSync(new URL("./fixtures/duckduckgo-html.html", import.meta.url), "utf8");

function publicResolve(host: string): Promise<string[]> {
  if (host === "example.com") return Promise.resolve(["93.184.216.34"]);
  if (host === "rebind.example") return Promise.resolve(["93.184.216.34", "10.0.0.5"]);
  if (host === "missing.example") return Promise.resolve([]);
  return Promise.reject(new Error("dns"));
}

test("ssrf guard blocks private, loopback, link-local, and metadata targets", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("127.255.255.255"), true);
  assert.equal(isPrivateAddress("10.1.2.3"), true);
  assert.equal(isPrivateAddress("172.16.0.1"), true);
  assert.equal(isPrivateAddress("172.31.255.255"), true);
  assert.equal(isPrivateAddress("172.15.5.5"), false);
  assert.equal(isPrivateAddress("172.32.0.1"), false);
  assert.equal(isPrivateAddress("192.168.1.20"), true);
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("0.0.0.0"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("::"), true);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("fc00::1"), true);
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("foo.localhost"), true);
  assert.equal(isBlockedHostname("metadata.google.internal"), true);
  assert.equal(isBlockedHostname("metadata.google.internal."), true);
  assert.equal(isBlockedHostname("metadata.goog"), true);
  assert.equal(isBlockedHostname("example.com"), false);

  const requested: string[] = [];
  const request: PublicRequest = async (url) => {
    requested.push(url.toString());
    return { status: 200, headers: new Headers({ "content-type": "text/plain" }), body: "secret" };
  };
  const blocked = [
    "http://127.0.0.1/admin",
    "http://localhost/admin",
    "http://[::1]/",
    "http://10.1.1.1/",
    "http://192.168.0.5/",
    "http://172.16.0.5/",
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://2130706433/",
    "file:///etc/passwd",
    "http://0.0.0.0/",
    "https://rebind.example/x",
  ];
  for (const url of blocked) {
    const result = await readPublicUrl(url, { resolve: publicResolve, request });
    assert.equal(result.ok, false, url);
  }
  assert.deepEqual(requested, []);

  const unresolved = await readPublicUrl("https://missing.example/", { resolve: publicResolve, request });
  assert.equal(unresolved.ok, false);
  const broken = await readPublicUrl("https://nope.example/", { resolve: publicResolve, request });
  assert.equal(broken.ok, false);
});

test("fetch_url does not follow a redirect onto a private address", async () => {
  const requested: string[] = [];
  const resolve: Resolver = async (host) => (host === "example.com" ? ["93.184.216.34"] : [host]);
  const request: PublicRequest = async (url, address) => {
    requested.push(`${address} ${url.toString()}`);
    assert.equal(address, "93.184.216.34");
    return { status: 302, headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }), body: "" };
  };
  const result = await readPublicUrl("https://example.com/start", { resolve, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not public/);
  assert.deepEqual(requested, ["93.184.216.34 https://example.com/start"]);
});

test("fetch_url returns text and sends a browser user agent with a 15s timeout", async () => {
  assert.equal(WEB_FETCH_TIMEOUT_MS, 15_000);
  assert.match(BROWSER_USER_AGENT, /Mozilla\/5\.0/);
  let sawSignal = false;
  let userAgent = "";
  const result = await readPublicUrl("https://example.com/docs", {
    resolve: publicResolve,
    request: async (_url, _address, init) => {
      sawSignal = init.signal instanceof AbortSignal && !init.signal.aborted;
      userAgent = init.headers["User-Agent"] ?? "";
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        body: "<html><style>.x{color:red}</style><script>alert(1)</script><h1>Title</h1><p>Hello <a href=\"https://example.com/a\">docs</a> &amp; more</p></html>",
      };
    },
  });
  assert.equal(sawSignal, true);
  assert.equal(userAgent, BROWSER_USER_AGENT);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.text, /Title/);
    assert.match(result.text, /\[docs\]\(https:\/\/example\.com\/a\)/);
    assert.match(result.text, /more/);
    assert.doesNotMatch(result.text, /alert|color:red/);
  }
});

test("html to text drops scripts and caps the length", () => {
  const text = htmlToText("<script>secret()</script><p>Visible</p>");
  assert.equal(text, "Visible");
  assert.equal(htmlToText(`<p>${"a".repeat(WEB_TEXT_LIMIT + 50)}</p>`).length, WEB_TEXT_LIMIT);
});

test("json responses are returned as text", async () => {
  const result = await readPublicUrl("https://example.com/data.json", {
    resolve: publicResolve,
    request: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ ok: true, items: [1] }),
    }),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(JSON.parse(result.text), { ok: true, items: [1] });
});

test("duckduckgo html fixture parses titles, urls, and snippets", () => {
  const hits = parseDuckDuckGoHtml(fixture);
  assert.deepEqual(hits, [
    { title: "Example Docs", url: "https://example.com/docs", snippet: "How to use the example docs." },
    { title: "Direct & Title", url: "https://direct.example/page", snippet: "A plain snippet without a redirect." },
  ]);
});

test("search_web lists only providers that are configured", () => {
  assert.deepEqual(availableSearchProviders({}), ["duckduckgo"]);
  assert.deepEqual(availableSearchProviders({ TAVILY_API_KEY: "  ", BRAVE_SEARCH_API_KEY: "" }), ["duckduckgo"]);
  assert.deepEqual(new Set(availableSearchProviders({ TAVILY_API_KEY: "tavily-test", BRAVE_SEARCH_API_KEY: "brave-test" })), new Set(["brave", "duckduckgo", "tavily"]));
  const tavilyOnly = searchWebTool({ TAVILY_API_KEY: "tavily-test" });
  const names = tavilyOnly.input_schema.properties.provider.enum;
  assert.equal(names.includes("tavily"), true);
  assert.equal(names.includes("brave"), false);
  assert.equal(names.includes("duckduckgo"), true);
  assert.match(tavilyOnly.description, /one provider/);
  assert.doesNotMatch(tavilyOnly.description, /fallback|if web_search fails|then /i);
  assert.equal(FETCH_URL_TOOL.description.includes("public http"), true);
  assert.equal(TOOL_SCHEMAS.find((tool) => tool.name === "web_search")?.description, "Search the public web. No connected account.");
});

test("search_web and fetch_url work on their own and a failed provider is not replaced", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("user-agent"), BROWSER_USER_AGENT);
    assert.ok(init?.signal);
    if (url.includes("api.tavily.com")) {
      assert.equal(headers.get("authorization"), "Bearer tavily-test");
      assert.equal(String(init?.body ?? "").includes("tavily-test"), false);
      return new Response("down", { status: 503 });
    }
    if (url.includes("api.search.brave.com")) {
      assert.equal(headers.get("x-subscription-token"), "brave-test");
      return Response.json({ web: { results: [{ title: "Brave hit", url: "https://brave.example/a", description: "from brave" }] } });
    }
    if (url.startsWith("https://html.duckduckgo.com/html/?")) return new Response(fixture, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("missing", { status: 404 });
  };
  const env = { TAVILY_API_KEY: "tavily-test", BRAVE_SEARCH_API_KEY: "brave-test" };

  const duck = await runSearchWeb({ query: "example docs" }, { env, fetch: fetchImpl });
  assert.equal(duck.isError, false);
  assert.deepEqual(JSON.parse(duck.content).results[0], {
    title: "Example Docs",
    url: "https://example.com/docs",
    snippet: "How to use the example docs.",
  });
  assert.equal(calls.length, 1);
  const duckUrl = new URL(calls[0]);
  assert.equal(`${duckUrl.origin}${duckUrl.pathname}`, "https://html.duckduckgo.com/html/");
  assert.equal(duckUrl.searchParams.get("q"), "example docs");

  calls.length = 0;
  const brave = await runSearchWeb({ query: "example docs", provider: "Brave" }, { env, fetch: fetchImpl });
  assert.equal(brave.isError, false);
  assert.equal(JSON.parse(brave.content).provider, "brave");
  assert.equal(JSON.parse(brave.content).results[0].snippet, "from brave");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.search\.brave\.com/);

  calls.length = 0;
  const failed = await runSearchWeb({ query: "example docs", provider: "tavily" }, { env, fetch: fetchImpl });
  assert.equal(failed.isError, true);
  assert.match(failed.content, /tavily failed \(HTTP 503\)/);
  assert.equal(failed.content.includes("tavily-test"), false);
  assert.deepEqual(calls.map((url) => new URL(url).host), ["api.tavily.com"]);

  calls.length = 0;
  const missing = await runSearchWeb({ query: "example docs", provider: "tavily" }, { env: {}, fetch: fetchImpl });
  assert.equal(missing.isError, true);
  assert.match(missing.content, /not available/);
  assert.deepEqual(calls, []);
});

test("web_search failing does not invoke other providers", async () => {
  const calls: string[] = [];
  const previousFetch = globalThis.fetch;
  const previous = {
    composio: process.env.COMPOSIO_API_KEY,
    tavily: process.env.TAVILY_API_KEY,
    brave: process.env.BRAVE_SEARCH_API_KEY,
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  delete process.env.COMPOSIO_API_KEY;
  process.env.TAVILY_API_KEY = "tavily-test";
  process.env.BRAVE_SEARCH_API_KEY = "brave-test";
  try {
    const outcome = await createProductionTools().webSearch("user", "contract from Kemi");
    assert.equal(outcome.isError, true);
    assert.equal(outcome.content, "Web search is not configured.");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = previousFetch;
    restore("COMPOSIO_API_KEY", previous.composio);
    restore("TAVILY_API_KEY", previous.tavily);
    restore("BRAVE_SEARCH_API_KEY", previous.brave);
  }

  const seen: string[] = [];
  let steps = 0;
  const graph = compileAgenticGraph(
    defaultDeps({
      claude: {
        async complete(): Promise<ClaudeTurn> {
          steps += 1;
          if (steps === 1) {
            return { content: [{ type: "tool_use", id: "search-1", name: "web_search", input: { query: "contract" } }], thinkingSummary: "" };
          }
          return { content: [{ type: "text", text: "I could not look that up." }], thinkingSummary: "" };
        },
      },
      tools: {
        ...defaultDeps().tools,
        async webSearch() {
          seen.push("web_search");
          return { content: "temporarily disabled by the administrator", isError: true, effect: "read" };
        },
        async searchWeb() {
          seen.push("search_web");
          return { content: "other provider", isError: false, effect: "read" };
        },
        async fetchUrl() {
          seen.push("fetch_url");
          return { content: "page", isError: false, effect: "read" };
        },
      },
    }),
    new MemorySaver()
  );
  const done = await graph.invoke(
    {
      messages: [{ role: "user", content: "Find the contract" }],
      userId: "user-1",
      goal: "Find the contract",
      threadId: "web-fail",
      startedAt: Date.now(),
      status: "running",
      resolution: null,
    },
    threadConfig("web-search-does-not-switch")
  );
  assert.deepEqual(seen, ["web_search"]);
  assert.match(done.finalAnswer ?? "", /could not look that up/);
});

test("successful search_web and fetch_url are metered once", async () => {
  let charges = 0;
  const meter = { async chargeSearch() { charges += 1; } } as unknown as RunMeter;
  const tools = createProductionTools(meter, {
    env: {},
    fetch: async () => new Response(fixture, { status: 200, headers: { "content-type": "text/html" } }),
    resolve: publicResolve,
    request: async () => ({ status: 200, headers: new Headers({ "content-type": "text/plain" }), body: "page body" }),
  });
  const search = await tools.searchWeb("user", { query: "example docs", provider: "duckduckgo" });
  assert.equal(search.isError, false);
  const blocked = await tools.fetchUrl("user", "http://127.0.0.1/");
  assert.equal(blocked.isError, true);
  const page = await tools.fetchUrl("user", "https://example.com/docs");
  assert.equal(page.isError, false);
  assert.equal(page.content, "page body");
  const failed = await tools.searchWeb("user", { query: "example docs", provider: "tavily" });
  assert.equal(failed.isError, true);
  assert.equal(charges, 2);
});

test("guidance names the tools without prescribing which one to try next", () => {
  const prompt = systemPrompt({
    budgets: readBudgets(),
    facts: [],
    episodes: [],
    todos: [],
    failures: [],
    connects: [],
  });
  assert.match(prompt, /search_web queries one public search provider/);
  assert.match(prompt, /fetch_url reads one public http or https page/);
  assert.match(prompt, /If a tool fails, you can try a different tool or a different approach/);
  assert.doesNotMatch(prompt, /fallback|if web_search fails|try search_web|then fetch_url|in this order/i);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
