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
  isSearchChallenge,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  readPublicUrl,
  runSearchWeb,
  wikipediaHits,
  WIKIPEDIA_USER_AGENT,
  type PublicRequest,
  type Resolver,
} from "./web-route";

const fixture = readFileSync(new URL("./fixtures/duckduckgo-html.html", import.meta.url), "utf8");
const liteFixture = readFileSync(new URL("./fixtures/duckduckgo-lite.html", import.meta.url), "utf8");
const anomalyFixture = readFileSync(new URL("./fixtures/duckduckgo-anomaly.html", import.meta.url), "utf8");
const emptyFixture = readFileSync(new URL("./fixtures/duckduckgo-empty.html", import.meta.url), "utf8");
const wikipediaFixture = readFileSync(new URL("./fixtures/wikipedia-search.json", import.meta.url), "utf8");

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

test("duckduckgo lite fixture parses titles, urls, and snippets", () => {
  const hits = parseDuckDuckGoLite(liteFixture);
  assert.deepEqual(hits, [
    { title: "Example Docs", url: "https://example.com/docs", snippet: "How to use the example docs." },
    { title: "Direct & Title", url: "https://direct.example/page", snippet: "A plain snippet without a redirect." },
  ]);
});

test("wikipedia fixture keeps the search index order", () => {
  const hits = wikipediaHits(JSON.parse(wikipediaFixture));
  assert.deepEqual(hits, [
    {
      title: "Runway (company)",
      url: "https://en.wikipedia.org/wiki/Runway_(company)",
      snippet: "Runway AI, Inc. (also known as Runway and RunwayML) is an American company.",
    },
    { title: "Seedance", url: "https://en.wikipedia.org/wiki/Seedance", snippet: "Seedance is a video model. It is not the first hit." },
  ]);
  assert.deepEqual(wikipediaHits({ batchcomplete: "" }), []);
});

test("the anomaly fixture is a challenge page and has no results", () => {
  assert.equal(isSearchChallenge(anomalyFixture), true);
  assert.deepEqual(parseDuckDuckGoHtml(anomalyFixture), []);
  assert.deepEqual(parseDuckDuckGoLite(anomalyFixture), []);
  assert.equal(isSearchChallenge(emptyFixture), false);
  assert.equal(isSearchChallenge(fixture), false);
});

test("search_web lists only providers that are configured", () => {
  assert.deepEqual(availableSearchProviders({}), ["duckduckgo", "duckduckgo_lite", "wikipedia"]);
  assert.deepEqual(availableSearchProviders({ TAVILY_API_KEY: "  ", BRAVE_SEARCH_API_KEY: "" }), ["duckduckgo", "duckduckgo_lite", "wikipedia"]);
  assert.deepEqual(
    new Set(availableSearchProviders({ TAVILY_API_KEY: "tavily-test", BRAVE_SEARCH_API_KEY: "brave-test" })),
    new Set(["brave", "duckduckgo", "duckduckgo_lite", "tavily", "wikipedia"])
  );
  const tavilyOnly = searchWebTool({ TAVILY_API_KEY: "tavily-test" });
  const names = tavilyOnly.input_schema.properties.provider.enum;
  assert.equal(names.includes("tavily"), true);
  assert.equal(names.includes("brave"), false);
  assert.equal(names.includes("duckduckgo"), true);
  assert.equal(names.includes("duckduckgo_lite"), true);
  assert.equal(names.includes("wikipedia"), true);
  assert.match(tavilyOnly.description, /one provider/);
  assert.match(tavilyOnly.description, /The call uses that provider only/);
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
    const parsed = new URL(url);
    if (`${parsed.origin}${parsed.pathname}` === "https://html.duckduckgo.com/html/") {
      assert.equal(init?.method, "POST");
      assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
      assert.equal(headers.get("origin"), "https://html.duckduckgo.com");
      assert.equal(headers.get("referer"), "https://html.duckduckgo.com/");
      assert.equal(headers.get("sec-fetch-site"), "same-origin");
      assert.match(String(init?.body ?? ""), /(?:^|&)q=example\+docs(?:&|$)/);
      assert.match(String(init?.body ?? ""), /(?:^|&)b=(?:&|$)/);
      return new Response(fixture, { status: 200, headers: { "content-type": "text/html" } });
    }
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
  assert.equal(duckUrl.search, "");

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
  assert.match(prompt, /A different query for the same tool is still that tool/);
  assert.doesNotMatch(prompt, /fallback|if web_search fails|try search_web|then fetch_url|in this order/i);
});

test("a blocked or empty duckduckgo page is an error and does not call another provider", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    const url = String(input);
    if (url === "https://html.duckduckgo.com/html/") {
      return new Response(anomalyFixture, { status: 202, headers: { "content-type": "text/html" } });
    }
    return new Response(liteFixture, { status: 200, headers: { "content-type": "text/html" } });
  };
  const blocked = await runSearchWeb({ query: "Veo 3 API pricing", provider: "duckduckgo" }, { env: {}, fetch: fetchImpl });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content, /duckduckgo blocked this request/);
  assert.match(blocked.content, /anomaly or captcha/);
  assert.match(blocked.content, /Choose another provider or fetch_url/);
  assert.doesNotMatch(blocked.content, /fallback/i);
  assert.deepEqual(calls, ["POST https://html.duckduckgo.com/html/"]);

  calls.length = 0;
  const emptyFetch: typeof fetch = async () => new Response(emptyFixture, { status: 200, headers: { "content-type": "text/html" } });
  const empty = await runSearchWeb({ query: "nothing here", provider: "duckduckgo" }, { env: {}, fetch: emptyFetch });
  assert.equal(empty.isError, true);
  assert.match(empty.content, /duckduckgo returned nothing/);

  const down = await runSearchWeb(
    { query: "example docs" },
    { env: {}, fetch: async () => new Response("nope", { status: 500, headers: { "content-type": "text/html" } }) }
  );
  assert.equal(down.isError, true);
  assert.match(down.content, /duckduckgo failed \(HTTP 500\)/);
});

test("duckduckgo_lite and wikipedia are separate providers with no fallback", async () => {
  const calls: { url: string; method: string; body: string; ua: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? ""), ua: headers.get("user-agent") ?? "" });
    const url = String(input);
    if (url === "https://lite.duckduckgo.com/lite/") return new Response(liteFixture, { status: 200, headers: { "content-type": "text/html" } });
    if (url.startsWith("https://en.wikipedia.org/w/api.php")) return new Response(wikipediaFixture, { status: 200, headers: { "content-type": "application/json" } });
    if (url === "https://html.duckduckgo.com/html/") return new Response(anomalyFixture, { status: 202, headers: { "content-type": "text/html" } });
    return new Response("missing", { status: 404 });
  };

  const lite = await runSearchWeb({ query: "example docs", provider: "duckduckgo_lite" }, { env: {}, fetch: fetchImpl });
  assert.equal(lite.isError, false);
  assert.equal(JSON.parse(lite.content).provider, "duckduckgo_lite");
  assert.equal(JSON.parse(lite.content).results[0].url, "https://example.com/docs");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://lite.duckduckgo.com/lite/");
  assert.match(calls[0].body, /(?:^|&)q=example\+docs(?:&|$)/);
  assert.equal(calls[0].ua, BROWSER_USER_AGENT);

  calls.length = 0;
  const wiki = await runSearchWeb({ query: "Runway (company)", provider: "Wikipedia" }, { env: {}, fetch: fetchImpl });
  assert.equal(wiki.isError, false);
  const wikiBody = JSON.parse(wiki.content);
  assert.equal(wikiBody.provider, "wikipedia");
  assert.equal(wikiBody.results[0].title, "Runway (company)");
  assert.equal(calls.length, 1);
  const wikiUrl = new URL(calls[0].url);
  assert.equal(`${wikiUrl.origin}${wikiUrl.pathname}`, "https://en.wikipedia.org/w/api.php");
  assert.equal(wikiUrl.searchParams.get("action"), "query");
  assert.equal(wikiUrl.searchParams.get("generator"), "search");
  assert.equal(wikiUrl.searchParams.get("gsrsearch"), "Runway (company)");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].ua, WIKIPEDIA_USER_AGENT);

  const none = await runSearchWeb(
    { query: "Veo 3 API pricing", provider: "wikipedia" },
    { env: {}, fetch: async () => new Response(JSON.stringify({ batchcomplete: "" }), { status: 200, headers: { "content-type": "application/json" } }) }
  );
  assert.equal(none.isError, true);
  assert.match(none.content, /wikipedia returned nothing/);
  assert.match(none.content, /Choose another provider or fetch_url/);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
