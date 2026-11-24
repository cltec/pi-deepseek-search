import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDeepSeek } from "../src/wiring.ts";

function fixture(t, env = {}, fetchImpl = () => { throw new Error("Unexpected network request"); }) {
  const dir = mkdtempSync(join(tmpdir(), "deepseek-wiring-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tools = new Map(), commands = new Map(), events = new Map(), messages = [], notifications = [], entries = [];
  const pi = {
    registerTool(tool) { assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); },
    registerCommand(name, command) { assert.equal(commands.has(name), false); commands.set(name, command); },
    on(name, handler) { assert.equal(events.has(name), false); events.set(name, handler); },
    getAllTools() { return [...tools.values()]; },
    sendMessage(...args) { messages.push(args); },
    appendEntry(...args) { entries.push(args); },
  };
  registerDeepSeek(pi, { agentDir: dir, env, fetchImpl });
  const ctx = { cwd: dir, isProjectTrusted: () => false, hasUI: false, ui: { notify: (...args) => notifications.push(args) } };
  const call = (name, params, signal) => tools.get(name).execute("call", params, signal, undefined, ctx);
  return { dir, tools, commands, events, messages, notifications, entries, ctx, call };
}
const search = "deepseek_web_search", fetchPage = "deepseek_web_fetch", read = "deepseek_web_read_full";
const status = "DeepSeek Search loaded. Tools: deepseek_web_search, deepseek_web_fetch, deepseek_web_read_full.";

test("registers the three tools with constrained schemas and reports exact status on both channels", async t => {
  const f = fixture(t);
  assert.deepEqual([...f.tools.keys()], [search, fetchPage, read]);
  for (const tool of f.tools.values()) {
    assert.ok(tool.label && tool.description && tool.promptSnippet && tool.promptGuidelines.length);
    assert.equal(tool.parameters.type, "object");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.deepEqual(f.tools.get(search).parameters.required, ["query"]);
  assert.deepEqual(f.tools.get(fetchPage).parameters.required, ["url"]);
  assert.deepEqual(f.tools.get(read).parameters.required, ["ref"]);
  assert.deepEqual(Object.keys(f.tools.get(read).parameters.properties), ["ref", "section", "resultIndex", "offset", "maxChars", "mode", "path", "overwrite"]);
  assert.deepEqual(f.tools.get(read).parameters.properties.section.enum, ["title", "url", "content"]);
  assert.deepEqual(f.tools.get(read).parameters.properties.mode.enum, ["inline", "file"]);
  assert.equal(f.tools.get(search).parameters.properties.query.maxLength, 128);
  assert.equal(f.tools.get(fetchPage).parameters.properties.url.maxLength, 8192);
  assert.equal(f.tools.get(read).parameters.properties.maxChars.maximum, 50000);
  assert.deepEqual([...f.commands.keys()], ["deepseek-search-status"]);
  const handler = f.commands.get("deepseek-search-status").handler;
  await handler("ignored", { ...f.ctx, hasUI: true });
  assert.deepEqual(f.notifications, [[status, "info"]]);
  assert.deepEqual(f.messages, []);
  await handler("ignored", { ...f.ctx, ui: undefined });
  assert.deepEqual(f.messages, [[{ customType: "deepseek-search-status", content: status, display: true }, { triggerTurn: false }]]);
});

test("search discovery, selected fetch and cached section paging keep bodies out of details", async t => {
  const requests = [];
  const url = "https://example.org/article";
  const summary = "Search preview ".repeat(100);
  const markdown = "# Article\n\n" + "Full page body. ".repeat(100);
  const f = fixture(t, { DEEPSEEK_API_KEY: "fixture-key" }, async (input, init) => {
    requests.push({ input, body: JSON.parse(init.body), authorization: init.headers.Authorization });
    if (input.endsWith("/search")) return Response.json({ results: [{ title: "Article", url, snippet: "snippet", summary, content: "" }] });
    assert.ok(input.endsWith("/fetch"));
    return Response.json({ title: "Article", content: markdown });
  });
  writeFileSync(join(f.dir, "pi-deepseek-search.json"), JSON.stringify({ default: { maxOutputChars: 256 } }));
  const found = await f.call(search, { query: " article " });
  assert.match(found.content[0].text, /1\. Article\nhttps:\/\/example\.org\/article/);
  assert.equal(found.details.truncated, true);
  assert.ok(found.content[0].text.length <= 256);
  assert.ok(!JSON.stringify(found.details).includes(summary));
  const sr = found.details.fullContentRef;
  const link = await f.call(read, { ref: sr, section: "url", resultIndex: 1 });
  assert.equal(link.content[0].text, url);
  const preview = await f.call(read, { ref: sr, section: "content", resultIndex: 1, maxChars: 7 });
  assert.equal(preview.details.nextOffset, 7);
  assert.match(preview.content[0].text, /^Search /);
  const page = await f.call(fetchPage, { url: link.content[0].text });
  assert.equal(page.details.truncated, true);
  assert.ok(page.content[0].text.length <= 256);
  assert.ok(!JSON.stringify(page.details).includes(markdown));
  const ref = page.details.fullContentRef;
  const title = await f.call(read, { ref, section: "title" });
  assert.equal(title.content[0].text, "Article");
  const first = await f.call(read, { ref, maxChars: 10 });
  assert.equal(first.details.nextOffset, 10);
  assert.equal(first.details.servedFrom, "cache");
  const rest = await f.call(read, { ref, offset: first.details.nextOffset, maxChars: 5000 });
  assert.equal(rest.content[0].text, markdown.slice(10));
  assert.equal(rest.details.nextOffset, null);
  assert.ok(!JSON.stringify(rest.details).includes(markdown));
  assert.deepEqual(requests, [
    { input: "https://api.deepseek.com/v1/tools/search", body: { query: "article", count: 3, need_content: false }, authorization: "Bearer fixture-key" },
    { input: "https://api.deepseek.com/v1/tools/fetch", body: { url }, authorization: "Bearer fixture-key" },
  ]);
});

test("debug commands are gated and execute real tools with redacted errors", async t => {
  const f = fixture(t, { DEEPSEEK_API_KEY: "key", PI_DEEPSEEK_SEARCH_DEV: "true" }, async input => {
    if (input.endsWith("/search")) return Response.json({ results: [{ title: "Result", url: "https://example.org/", snippet: "brief", summary: "brief" }] });
    return Response.json({ title: "Page", content: "Markdown" });
  });
  assert.deepEqual([...f.commands.keys()], ["deepseek-search-status", "deepseek-search", "deepseek-fetch", "deepseek-read-full"]);
  await f.commands.get("deepseek-search").handler("query", f.ctx);
  const ref = f.entries[0][1].details.fullContentRef;
  await f.commands.get("deepseek-fetch").handler("https://example.org/", f.ctx);
  await f.commands.get("deepseek-read-full").handler(JSON.stringify({ ref, section: "title", resultIndex: 1 }), f.ctx);
  assert.equal(f.entries[2][1].content, "Result");
  assert.equal(f.entries[1][1].content, `Page\n\nMarkdown\n\nFetch ref: ${f.entries[1][1].details.fullContentRef} (deepseek_web_read_full).`);
  assert.ok(f.entries[0][1].content.includes(ref));
  assert.deepEqual(f.entries.map(e => e[0]), ["deepseek-search-debug", "deepseek-fetch-debug", "deepseek-read-full-debug"]);
  assert.deepEqual(f.messages, []);
  await f.commands.get("deepseek-read-full").handler('{"secret":true}', { ...f.ctx, hasUI: true });
  assert.deepEqual(f.notifications, [['Expected JSON arguments, e.g. {"ref":"fetch:…","section":"content"}.', "error"]]);
  await f.commands.get("deepseek-fetch").handler("not a URL", f.ctx);
  assert.match(f.entries.at(-1)[1].error, /^URL must be/);
});

test("session reset expires refs and shutdown removes temporary exports and aborts requests", async t => {
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { DEEPSEEK_API_KEY: "key" }, async (input, init) => {
    if (input.endsWith("/fetch")) return Response.json({ title: "Page", content: "body" });
    started();
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const page = await f.call(fetchPage, { url: "https://example.org/" });
  const ref = page.details.fullContentRef;
  const exported = await f.call(read, { ref, mode: "file" });
  assert.equal(readFileSync(exported.details.path, "utf8"), "body");
  await f.events.get("session_start")({}, f.ctx);
  assert.equal(existsSync(exported.details.path), false);
  await assert.rejects(f.call(read, { ref }), /reference not found/i);
  const pending = f.call(search, { query: "wait" });
  await waiting;
  await f.events.get("session_shutdown")();
  await assert.rejects(pending, /cancelled/i);
  await assert.rejects(f.call(read, { ref }), /abort/i);
});

test("explicit model-facing exports require approval, and user debug exports can opt into overwrite", async t => {
  const f = fixture(t, { DEEPSEEK_API_KEY: "key", PI_DEEPSEEK_SEARCH_DEV: "1" }, async () =>
    Response.json({ title: "Page", content: "A😀B" }));
  const page = await f.call(fetchPage, { url: "https://example.org/" });
  const ref = page.details.fullContentRef;
  const chunk = await f.call(read, { ref, offset: 1, maxChars: 1 });
  assert.match(chunk.content[0].text, /^😀\n\nContinue with offset=3\.$/u);
  assert.equal(chunk.details.nextOffset, 3);
  await assert.rejects(f.call(read, { ref, offset: 2 }), /inside a Unicode character/);
  const path = join(f.dir, "page.md");
  writeFileSync(path, "existing");
  const params = { ref, mode: "file", path: "@page.md", overwrite: true };
  await assert.rejects(f.call(read, params), /require interactive approval/);
  const prompts = [];
  const controller = new AbortController();
  const approve = async (_title, text, options) => {
    prompts.push(text);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.timeout, 30_000);
    return prompts.length === 2 ? true : "false";
  };
  const userCtx = { ...f.ctx, hasUI: true, ui: { ...f.ctx.ui, confirm: approve } };
  const run = () => f.tools.get(read).execute("call", params, controller.signal, undefined, userCtx);
  await assert.rejects(run(), /not approved/);
  assert.equal(readFileSync(path, "utf8"), "existing");
  assert.equal((await run()).details.path, path);
  assert.equal(prompts[0], `Write (replacing any existing file at) ${JSON.stringify(path)}?`);
  assert.equal(readFileSync(path, "utf8"), "A😀B");
  const debug = f.commands.get("deepseek-read-full").handler;
  await debug(JSON.stringify({ ...params, path: "another.md", overwrite: "false" }), f.ctx);
  assert.match(f.entries.at(-1)[1].error, /^Invalid read-full arguments/);
  assert.equal(existsSync(join(f.dir, "another.md")), false);
  await debug(JSON.stringify({ ...params, path: "another.md" }), f.ctx);
  assert.equal(readFileSync(join(f.dir, "another.md"), "utf8"), "A😀B");
});

test("PI_OFFLINE blocks search and fetch before any request", async t => {
  const f = fixture(t, { DEEPSEEK_API_KEY: "key", PI_OFFLINE: "1", PI_DEEPSEEK_SEARCH_DEV: "1" });
  await assert.rejects(f.call(search, { query: "query" }), /disabled by PI_OFFLINE/);
  await assert.rejects(f.call(fetchPage, { url: "https://example.org/" }), /disabled by PI_OFFLINE/);
  await f.events.get("session_start")({}, { ...f.ctx, hasUI: true });
  assert.deepEqual(f.notifications, []);
  await f.commands.get("deepseek-search").handler("query", f.ctx);
  assert.match(f.entries[0][1].error, /disabled by PI_OFFLINE/);
});
