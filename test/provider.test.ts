import { test } from "node:test";
import assert from "node:assert/strict";
import { createProvider, MISSING_KEY_MESSAGE, validatePageUrl, validateSearchRequest } from "../src/provider.ts";

const hit = { title: "Title", url: "https://example.org/a", content: "# Markdown\n\n text ", snippet: "snippet", summary: "summary" };
const request = { query: "  site:example.org test  ", count: 1, needContent: true };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("validates query by Unicode characters and checks request fields", () => {
  assert.equal(validateSearchRequest(request).query, "site:example.org test");
  assert.equal(validateSearchRequest({ ...request, query: "😀".repeat(128) }).query.length, 256);
  for (const query of [" ", "a".repeat(129)]) assert.throws(() => validateSearchRequest({ ...request, query }));
  for (const count of [0, 51, 1.5, NaN]) assert.throws(() => validateSearchRequest({ ...request, count }));
  assert.throws(() => validateSearchRequest({ ...request, needContent: 1 } as any));
});

test("validates absolute URLs without userinfo and trims whitespace", () => {
  assert.equal(validatePageUrl("  https://example.org/a  "), "https://example.org/a");
  for (const url of ["/relative", "ftp://example.org", "https://u:p@example.org", "https://@example.org", "https://example.org/has space", "https://example.org/" + "a".repeat(8192)]) assert.throws(() => validatePageUrl(url));
});

test("sends only fixed endpoints and returns bounded structured results and verbatim Markdown", async () => {
  const calls: Array<[string, RequestInit]> = [];
  const fake: typeof fetch = async (url, init) => {
    calls.push([String(url), init!]);
    return calls.length === 1 ? json({ results: [hit, hit] }) : json({ title: "Page", content: "# page\n\n  x\n" });
  };
  const provider = createProvider({ apiKey: "secret", fetchImpl: fake });
  assert.deepEqual(await provider.search(request), [hit]);
  assert.deepEqual(await provider.fetch(" https://example.org/a "), { title: "Page", content: "# page\n\n  x\n" });
  assert.deepEqual(calls.map(x => x[0]), ["https://api.deepseek.com/v1/tools/search", "https://api.deepseek.com/v1/tools/fetch"]);
  assert.deepEqual(JSON.parse(String(calls[0][1].body)), { query: "site:example.org test", count: 1, need_content: true });
  assert.deepEqual(JSON.parse(String(calls[1][1].body)), { url: "https://example.org/a" });
  for (const [, init] of calls) {
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { Authorization: "Bearer secret", "Content-Type": "application/json" });
  }
});

test("rejects missing key and malformed responses without revealing provider data", async () => {
  await assert.rejects(createProvider({}).search(request), { message: MISSING_KEY_MESSAGE });
  for (const data of [{}, { results: [{ ...hit, url: "https://user:secret@example.org" }] }, { results: [{ ...hit, content: null }] }]) {
    const provider = createProvider({ apiKey: "secret", fetchImpl: async () => json(data) });
    await assert.rejects(provider.search(request), { message: "DeepSeek returned an invalid response." });
  }
  const provider = createProvider({ apiKey: "secret", fetchImpl: async () => new Response("secret invalid json") });
  await assert.rejects(provider.fetch("https://example.org"), { message: "DeepSeek returned an invalid response." });
});

test("sanitizes HTTP and transport errors without retries", async () => {
  for (const status of [400, 401, 402, 403, 404, 408, 413, 429, 500, 504]) {
    let calls = 0;
    const provider = createProvider({ apiKey: "secret", fetchImpl: async () => { calls++; return json({ error: "secret" }, status); } });
    await assert.rejects(provider.search(request), (error: Error) => error.message.includes(String(status)) && !error.message.includes("secret"));
    assert.equal(calls, 1);
  }
  const provider = createProvider({ apiKey: "secret", fetchImpl: async () => { throw new Error("DeepSeek API HTTP secret"); } });
  await assert.rejects(provider.search(request), { message: "DeepSeek request failed. Check your connection and try again." });
});

test("cancellation and timeout bound uncooperative fetch and response streams", async () => {
  const controller = new AbortController();
  const provider = createProvider({ apiKey: "secret", timeoutMs: 1000, fetchImpl: async () => new Promise(() => {}) });
  const pending = provider.search(request, controller.signal);
  controller.abort("secret reason");
  await assert.rejects(pending, { message: "DeepSeek request cancelled." });
  await assert.rejects(provider.search(request, controller.signal), { message: "DeepSeek request cancelled." });
  let cancelled = false;
  const slow = createProvider({ apiKey: "secret", timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; } })) });
  await assert.rejects(slow.fetch("https://example.org"), { message: "DeepSeek request timed out." });
  assert.equal(cancelled, true);
});

test("caps streamed response bytes and cancels the stream", async () => {
  let cancelled = false;
  const provider = createProvider({ apiKey: "secret", fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(provider.search(request), { message: "DeepSeek response exceeded the size limit." });
  assert.equal(cancelled, true);
});


test("rejects backslash URL ambiguity and malformed UTF-8", async () => {
  for (const url of ["https://example.org\\@evil.test/", "https:///example.org", "https:////example.org", "https://@example.org", "https://a@b@host/"]) assert.throws(() => validatePageUrl(url));
  assert.equal(validatePageUrl("https://EXAMPLE.org:443/a%2Fb?x=1#frag"), "https://EXAMPLE.org:443/a%2Fb?x=1#frag");
  const provider = createProvider({ apiKey: "key", fetchImpl: async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d])) });
  await assert.rejects(provider.fetch("https://example.org"), { message: "DeepSeek returned an invalid response." });
});

test("handles fragmented UTF-8 and bounds results with content disabled", async () => {
  const { content, ...withoutContent } = hit;
  const bytes = new TextEncoder().encode(JSON.stringify({ results: [{ ...withoutContent, title: "😀" }, hit] }));
  const provider = createProvider({ apiKey: "key", fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  })) });
  assert.deepEqual(await provider.search({ ...request, count: 2, needContent: false }), [{ ...withoutContent, title: "😀", content: "" }, { ...hit, content: "" }]);
  const empty = createProvider({ apiKey: "key", fetchImpl: async () => json({ results: [] }) });
  assert.deepEqual(await empty.search({ ...request, count: 50 }), []);
});

test("deadline includes synchronous JSON parsing", async () => {
  const original = JSON.parse;
  const provider = createProvider({ apiKey: "key", timeoutMs: 10, fetchImpl: async () => json({ title: "ok", content: "ok" }) });
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    const end = performance.now() + 20;
    while (performance.now() < end) {}
    return original(...args);
  }) as typeof JSON.parse;
  try { await assert.rejects(provider.fetch("https://example.org"), { message: "DeepSeek request timed out." }); }
  finally { JSON.parse = original; }
});

test("cancels a stream of empty chunks and catches cumulative overflow", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const provider = createProvider({ apiKey: "key", fetchImpl: async () => new Response(new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array()); }, cancel() { cancelled = true; },
  })) });
  const pending = provider.fetch("https://example.org", controller.signal);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { message: "DeepSeek request cancelled." });
  assert.equal(cancelled, true);
  let overflowCancelled = false;
  const overflow = createProvider({ apiKey: "key", fetchImpl: async () => new Response(new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { overflowCancelled = true; },
  })) });
  await assert.rejects(overflow.search(request), { message: "DeepSeek response exceeded the size limit." });
  assert.equal(overflowCancelled, true);
});
