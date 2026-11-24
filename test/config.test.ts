import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROFILE, loadProfiles, readEnvironment } from "../src/config.ts";

function fixture(fn: (f: { agentDir: string; cwd: string; global: (v: unknown) => void; project: (v: unknown) => void }) => void) {
  const root = mkdtempSync(join(tmpdir(), "deepseek-config-"));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  mkdirSync(agentDir); mkdirSync(join(cwd, ".pi"), { recursive: true });
  const put = (path: string, value: unknown) => writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  try { fn({ agentDir, cwd, global: v => put(join(agentDir, "pi-deepseek-search.json"), v), project: v => put(join(cwd, ".pi", "pi-deepseek-search.json"), v) }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("missing configuration uses defaults without writing files", () => fixture(f => {
  assert.deepEqual(loadProfiles({ ...f, trusted: true }), { profile: DEFAULT_PROFILE, origin: "default", warnings: [], replay: false });
  assert.equal(existsSync(join(f.agentDir, "pi-deepseek-search.json")), false);
}));

test("trusted overrides merge defaults and selectors; exact and most-specific patterns win", () => fixture(f => {
  f.global({ version: "1.0", replay: true, allowProjectConfig: true, default: { maxResults: 4, needContent: true }, models: {
    "p/*": { maxResults: 5, maxOutputChars: 500 }, "p/model*": { maxResults: 6, maxOutputChars: 600 },
    "p/model-1": { maxResults: 7, maxOutputChars: 700 },
  } });
  f.project({ default: { maxOutputChars: 900 }, models: { "p/model-1": { maxResults: 8, maxOutputChars: 800, needContent: false } } });
  const load = (id: string, trusted = true) => loadProfiles({ ...f, trusted, model: { provider: "p", id } });
  assert.deepEqual(load("model-1").profile, { maxResults: 8, maxOutputChars: 800, needContent: false });
  assert.equal(load("model-1").origin, "exact");
  assert.equal(load("model-2").profile.maxResults, 6);
  assert.equal(load("model-2").origin, "pattern");
  assert.equal(load("model-1", false).profile.maxResults, 7);
  assert.equal(load("model-1").replay, true);
  assert.deepEqual(load("other", true).profile, { maxResults: 5, maxOutputChars: 500, needContent: true });
}));

test("invalid layers, unsupported versions, secrets and project replay fall back safely", () => fixture(f => {
  f.global({ version: "1.2", allowProjectConfig: true, default: { maxResults: 9 } });
  for (const bad of ["{secret", { version: "2.0", default: { maxResults: 1 } }, { replay: true }, { allowProjectConfig: true }, { allowProjectConfig: false }, { apiKey: "secret" }, { default: { baseUrl: "secret" } }, { default: { maxResults: 51 } }, { models: { secret: { maxOutputChars: 255 } } }]) {
    f.project(bad);
    const result = loadProfiles({ ...f, trusted: true });
    assert.equal(result.profile.maxResults, 9);
    assert.equal(result.replay, false);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0], "Ignoring invalid or unreadable project config.");
  }
  f.global({ default: { maxResults: 0 } });
  f.project({ default: { needContent: true } });
  const result = loadProfiles({ ...f, trusted: true });
  assert.deepEqual(result.profile, DEFAULT_PROFILE);
  assert.deepEqual(result.warnings, ["Ignoring invalid or unreadable global config."]);
}));

test("project config requires both global opt-in and trust", () => fixture(f => {
  f.project("invalid secret");
  for (const global of [{}, { allowProjectConfig: false }, { allowProjectConfig: true }]) {
    f.global(global);
    for (const trusted of [false, true]) {
      const result = loadProfiles({ ...f, trusted });
      assert.deepEqual(result.warnings, global.allowProjectConfig && trusted ? ["Ignoring invalid or unreadable project config."] : []);
    }
  }
  f.project({ default: { maxResults: 11 } });
  f.global({ allowProjectConfig: true });
  assert.equal(loadProfiles({ ...f, trusted: true }).profile.maxResults, 11);
  assert.equal(loadProfiles({ ...f, trusted: false }).profile.maxResults, 3);
  f.global({ allowProjectConfig: "true" });
  assert.equal(loadProfiles({ ...f, trusted: true }).profile.maxResults, 3);
  assert.deepEqual(loadProfiles({ ...f, trusted: true }).warnings, ["Ignoring invalid or unreadable global config."]);
}));

test("matching selectors merge fields across global and project layers", () => fixture(f => {
  f.global({ allowProjectConfig: true, models: {
    "p/exact": { maxResults: 7, maxOutputChars: 700, needContent: true },
    "p/model*": { maxResults: 6, maxOutputChars: 600, needContent: true },
  } });
  f.project({ models: { "p/exact": { maxResults: 8 }, "p/model*": { needContent: false } } });
  const load = (id: string) => loadProfiles({ ...f, trusted: true, model: { provider: "p", id } });
  assert.deepEqual(load("exact").profile, { maxResults: 8, maxOutputChars: 700, needContent: true });
  assert.equal(load("exact").origin, "exact");
  assert.deepEqual(load("model-1").profile, { maxResults: 6, maxOutputChars: 600, needContent: false });
  assert.equal(load("model-1").origin, "pattern");
}));

test("oversized documents are bounded and untrusted projects are not read", () => fixture(f => {
  f.global(" ".repeat(70000)); f.project("invalid secret");
  const result = loadProfiles({ ...f, trusted: false });
  assert.deepEqual(result.warnings, ["Ignoring invalid or unreadable global config."]);
  assert.deepEqual(result.profile, DEFAULT_PROFILE);
}));

test("environment credentials are trimmed and dev mode is explicit", () => {
  assert.deepEqual(readEnvironment({ DEEPSEEK_API_KEY: "  key  ", PI_DEEPSEEK_SEARCH_DEV: " TRUE " }), { apiKey: "key", devMode: true });
  assert.deepEqual(readEnvironment({ DEEPSEEK_API_KEY: " ", PI_DEEPSEEK_SEARCH_DEV: "yes" }), { apiKey: undefined, devMode: false });
});
