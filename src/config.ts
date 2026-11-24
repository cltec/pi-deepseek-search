import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

export type Profile = { maxResults: number; maxOutputChars: number; needContent: boolean };
export const DEFAULT_PROFILE: Profile = Object.freeze({ maxResults: 3, maxOutputChars: 12000, needContent: false });

type PartialProfile = Partial<Profile>;
type Document = { default?: PartialProfile; models?: Record<string, PartialProfile>; replay?: boolean; allowProjectConfig?: boolean };
const FILE = "pi-deepseek-search.json";
const MAX_BYTES = 64 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validProfile(value: unknown): value is PartialProfile {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, v]) => {
    if (key === "maxResults") return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 50;
    if (key === "maxOutputChars") return typeof v === "number" && Number.isInteger(v) && v >= 256 && v <= 50000;
    if (key === "needContent") return typeof v === "boolean";
    return false;
  });
}

function validDocument(value: unknown, project: boolean): value is Document {
  if (!object(value)) return false;
  for (const [key, v] of Object.entries(value)) {
    if (key === "version") {
      if (typeof v !== "string" || !/^1(?:\.\d+){0,2}$/.test(v)) return false;
    } else if (key === "default") {
      if (!validProfile(v)) return false;
    } else if (key === "models") {
      if (!object(v) || !Object.values(v).every(validProfile)) return false;
    } else if (key === "replay" || key === "allowProjectConfig") {
      if (project || typeof v !== "boolean") return false;
    } else return false;
  }
  return true;
}

function readDocument(path: string, layer: "global" | "project", warnings: string[]): Document {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > MAX_BYTES) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used)));
    if (!validDocument(value, layer === "project")) throw new Error();
    return value;
  } catch (error) {
    if (!(object(error) && error.code === "ENOENT")) warnings.push(`Ignoring invalid or unreadable ${layer} config.`);
    return {};
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Linear-space glob matching without compiling untrusted selectors as regexes.
function matches(pattern: string, text: string): boolean {
  let p = 0, t = 0, star = -1, retry = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== "*" && pattern[p] === text[t]) { p++; t++; }
    else if (pattern[p] === "*") { star = p++; retry = t; }
    else if (star !== -1) { p = star + 1; t = ++retry; }
    else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

export function loadProfiles(options: { agentDir: string; cwd: string; trusted: boolean; model?: { provider: string; id: string } }): { profile: Profile; origin: string; warnings: string[]; replay: boolean } {
  const warnings: string[] = [];
  const global = readDocument(join(options.agentDir, FILE), "global", warnings);
  const project = options.trusted && global.allowProjectConfig === true ? readDocument(join(options.cwd, ".pi", FILE), "project", warnings) : {};
  const defaults = { ...DEFAULT_PROFILE, ...global.default, ...project.default };
  const models = { ...global.models };
  for (const [selector, profile] of Object.entries(project.models ?? {})) {
    models[selector] = { ...models[selector], ...profile };
  }
  const key = options.model ? `${options.model.provider}/${options.model.id}` : undefined;
  let selected: PartialProfile | undefined;
  let origin = "default";
  // Like the reference, model overrides require both budgets; needContent is optional.
  const complete = (p: PartialProfile | undefined) => p !== undefined && p.maxResults !== undefined && p.maxOutputChars !== undefined;
  if (key !== undefined && Object.hasOwn(models, key) && complete(models[key])) {
    selected = models[key];
    origin = "exact";
  } else if (key !== undefined) {
    let specificity = -1;
    for (const [selector, candidate] of Object.entries(models)) {
      const score = selector.replace(/\*/g, "").length;
      if (selector.includes("*") && score > specificity && complete(candidate) && matches(selector, key)) {
        selected = candidate;
        specificity = score;
        origin = "pattern";
      }
    }
  }
  return { profile: { ...defaults, ...selected }, origin, warnings, replay: global.replay ?? false };
}

export function readEnvironment(env: NodeJS.ProcessEnv): { apiKey?: string; devMode: boolean } {
  const apiKey = env.DEEPSEEK_API_KEY?.trim() || undefined;
  const dev = env.PI_DEEPSEEK_SEARCH_DEV?.trim().toLowerCase();
  return { apiKey, devMode: dev === "1" || dev === "true" };
}
