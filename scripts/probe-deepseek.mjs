#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RpcSession, categoryOf, createScenarioRoot, removeScenarioRoot,
  scenarioEnvironment, shutdownFailure, verifyPiVersion,
} from "../e2e/harness.ts";

// Separate from npm test and test:e2e. Only --live passes a credential to Pi.
const mode = process.argv[2];
if (process.argv.length !== 3 || !["--offline", "--live"].includes(mode)) {
  console.error("Usage: PI_BIN=/absolute/path/to/pi scripts/probe-deepseek.mjs --offline|--live");
  process.exit(2);
}
const live = mode === "--live";
const repo = fileURLToPath(new URL("../", import.meta.url));
const entry = join(repo, "src", "index.ts");
const query = "site:nasa.gov Mars 2020 Perseverance rover mission overview";
const offlineUrl = "https://science.nasa.gov/mission/mars-2020-perseverance/";
const blocked = "DeepSeek web requests are disabled by PI_OFFLINE.";
const result = { schemaVersion: 1, mode: mode.slice(2), outcome: "fail", piVersion: null, checks: [], errorCategory: null, cleanup: "clean" };
let root, session;
let interrupted = false;
const stop = () => {
  interrupted = true;
  void session?.close().catch(() => {});
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stop);

function requireCheck(condition, category) {
  if (condition) return;
  result.errorCategory = category;
  throw new Error(category);
}

function selectedNasaUrl(text) {
  const lines = text.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\d+\. /.test(lines[i])) continue;
    const value = lines[i + 1];
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && (url.hostname === "nasa.gov" || url.hostname.endsWith(".nasa.gov")) &&
        value.startsWith("https://") && !url.port && !url.username && !url.password &&
        !/[\s\u0000-\u001f\u007f\\]/u.test(value) && !/\.pdf$/i.test(url.pathname) &&
        /perseverance|mars-?2020/i.test(url.pathname)) return value;
    } catch { /* not a URL from a ranked result */ }
  }
}

async function command(name, args, timeout = 10_000) {
  requireCheck(!interrupted, "interrupted");
  const before = session.notificationCount();
  const response = await session.request({ type: "prompt", message: `/${name} ${args}` }, timeout);
  requireCheck(response?.disposition === "handled", "command-not-handled");
  const added = (await session.waitForNotifications(before + 1)).slice(before);
  requireCheck(added.length === 1, "notification-mismatch");
  const { notifyType, message } = added[0];
  if (live) {
    const http = /^DeepSeek API HTTP ([45]\d\d)\./.exec(message)?.[1];
    requireCheck(notifyType === "info", http ? `provider-http-${http}` : "provider-command-error");
  } else {
    requireCheck(notifyType === "error" && message === blocked, "offline-guard-mismatch");
  }
  return message;
}

try {
  requireCheck(Boolean(process.env.PI_BIN), "pi-bin-required");
  requireCheck(!live || process.env.PI_OFFLINE === undefined, "offline-requested");
  const key = live ? process.env.DEEPSEEK_API_KEY : undefined;
  requireCheck(!live || Boolean(key?.trim()), "credential-missing");
  const source = { PI_BIN: process.env.PI_BIN, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  const version = await verifyPiVersion(repo, source);
  result.cleanup = version.cleanup;
  result.piVersion = version.actual;
  if (version.failure) throw version.failure;
  result.checks.push("pinned-version");
  requireCheck(!interrupted, "interrupted");

  root = createScenarioRoot("provider-probe");
  const env = scenarioEnvironment(root.root, source);
  env.PI_DEEPSEEK_SEARCH_DEV = "1";
  if (live) {
    delete env.PI_OFFLINE;
    env.DEEPSEEK_API_KEY = key;
  } else {
    env.PI_OFFLINE = ""; // Presence, not truthiness, disables provider access.
  }
  session = await RpcSession.start({ command: source.PI_BIN, cwd: root.cwd, env, args: [
    "--mode", "rpc", "--no-session", "--no-approve", "--no-extensions", "--no-mcp", "--no-builtin-tools",
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "-e", entry,
  ] });
  requireCheck(!interrupted, "interrupted");
  const { commands } = await session.request({ type: "get_commands" }, 30_000);
  requireCheck(Array.isArray(commands) && commands.every(c => c.source === "extension" &&
    c.sourceInfo?.origin === "top-level" && c.sourceInfo.path === entry), "unexpected-command-source");
  requireCheck(["deepseek-search", "deepseek-fetch", "deepseek-read-full"].every(name => commands.some(c => c.name === name)), "command-missing");
  result.checks.push("isolated-command-discovery");

  const sources = await command("deepseek-search", query, 65_000);
  const url = live ? selectedNasaUrl(sources) : offlineUrl;
  requireCheck(Boolean(url), "no-usable-nasa-result");
  result.checks.push(live ? "search-returned-official-source" : "search-blocked-offline");

  const page = await command("deepseek-fetch", url, 65_000);
  if (live) {
    const footer = /\n\nFetch ref: (fetch:[a-f0-9]{32}) \(deepseek_web_read_full\)\.$/.exec(page);
    requireCheck(footer && /\bPerseverance\b/i.test(page.slice(0, footer.index)), "missing-mission-page-or-ref");
    result.checks.push("fetch-returned-mission-page");
    const read = await command("deepseek-read-full", JSON.stringify({ ref: footer[1], maxChars: 128 }));
    const prefix = read.replace(/\n\nContinue with offset=\d+\.$/, "");
    const preview = page.slice(0, footer.index);
    const bodyStart = preview.indexOf("\n\n");
    requireCheck(prefix.trim().length > 0 && (preview.startsWith(prefix) ||
      (bodyStart !== -1 && preview.startsWith(prefix, bodyStart + 2))), "cached-read-mismatch");
    result.checks.push("read-returned-cached-page-text");
  } else {
    result.checks.push("fetch-blocked-offline");
  }

  const state = await session.request({ type: "get_state" });
  const { messages } = await session.request({ type: "get_messages" });
  requireCheck(state?.isStreaming === false && state.isCompacting === false && state.pendingMessageCount === 0 &&
    state.messageCount === 0 && Array.isArray(messages) && messages.length === 0, "model-or-session-activity");
  session.assertHealthy();
  result.checks.push("idle-empty-transcript");
} catch (error) {
  result.errorCategory ??= categoryOf(error);
} finally {
  try {
    if (session) {
      const failure = shutdownFailure(await session.close());
      if (failure) throw failure;
    }
  } catch (error) {
    result.errorCategory ??= categoryOf(error);
    result.cleanup = "failed";
  } finally {
    if (root && !removeScenarioRoot(root.root)) result.cleanup = "failed";
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, stop);
  if (interrupted) result.errorCategory = "interrupted";
  try { session?.assertHealthy(); } catch (error) { result.errorCategory ??= categoryOf(error); }
  if (result.cleanup !== "clean") result.errorCategory ??= "cleanup-failed";
  result.outcome = result.errorCategory === null ? "pass" : "fail";
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== "pass") process.exitCode = 1;
}
