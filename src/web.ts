import { loadProfiles } from "./config.ts";
import { createProvider, validatePageUrl, validateSearchRequest } from "./provider.ts";
import { createRetrieval, type PageSnapshot, type ReadRequest } from "./retrieval.ts";

export const TOOL_NAMES = ["deepseek_web_search", "deepseek_web_fetch", "deepseek_web_read_full"] as const;
export type WebResult = { content: [{ type: "text"; text: string }]; details: Record<string, unknown> };
export type WebContext = { cwd: string; model?: { provider: string; id: string }; isProjectTrusted(): boolean };

function result(text: string, details: Record<string, unknown> = {}): WebResult {
  return { content: [{ type: "text", text }], details };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function prefix(text: string, limit: number): string {
  const next = text.charCodeAt(limit);
  return text.slice(0, next >= 0xdc00 && next <= 0xdfff && limit > 0 ? limit - 1 : limit);
}

function clipped(text: string, limit: number): string {
  return text.length <= limit ? text : `${prefix(text, limit - 1)}…`;
}

export function createWebTools(options: { agentDir: string; apiKey?: string; fetchImpl?: typeof fetch; offline: boolean }) {
  const provider = createProvider(options);
  const readProfiles = (ctx: WebContext) => loadProfiles({
    agentDir: options.agentDir, cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), model: ctx.model,
  });
  let state = { refs: createRetrieval(), controller: new AbortController() };

  async function close() {
    state.controller.abort();
    await state.refs.close();
  }

  function online() {
    if (options.offline) throw new Error("DeepSeek web requests are disabled by PI_OFFLINE.");
  }

  function operationSignal(session: typeof state, signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, session.controller.signal]) : session.controller.signal;
  }

  async function search(query: string, ctx: WebContext, signal?: AbortSignal): Promise<WebResult> {
    online();
    const session = state;
    const active = readProfiles(ctx);
    const { profile } = active;
    const request = validateSearchRequest({ query, count: profile.maxResults, needContent: profile.needContent });
    const run = async (abort: AbortSignal) => {
      const hits = await provider.search(request, abort);
      const previews = hits.map(hit => hit.summary.trim() || hit.snippet.trim() || hit.content);
      const snapshot: PageSnapshot = {
        kind: "search",
        results: hits.map((hit, index) => ({
          title: hit.title, url: hit.url, content: hit.content.trim() ? hit.content : previews[index],
        })),
      };
      return { snapshot, previews };
    };
    const abort = operationSignal(session, signal);
    const { snapshot, previews } = await run(abort);
    if (abort.aborted) throw new Error("DeepSeek request cancelled.");
    const budget = profile.maxOutputChars;
    const appliedProfile = { origin: active.origin, ...profile };
    if (!snapshot.results.length) return result("No results found.", { resultCount: 0, omittedResultCount: 0, truncated: false, appliedProfile });
    const ref = session.refs.remember(snapshot, active.replay ? async replaySignal => (await run(replaySignal)).snapshot : undefined);
    const rows = snapshot.results.map((hit, index) => {
      const title = oneLine(hit.title) || "Untitled";
      const preview = oneLine(previews[index]);
      return { header: `${index + 1}. ${clipped(title, 240)}\n${hit.url}`, preview, replacement: title !== hit.title || preview !== hit.content || title.length > 240 };
    });
    const compact = rows.map(row => row.header + (row.preview ? `\n${clipped(row.preview, 800)}` : ""));
    const full = compact.join("\n\n");
    const notice = `\n\nSearch ref: ${ref} (deepseek_web_read_full; use resultIndex).`;
    const limit = budget - notice.length;
    const selected = new Set<number>();
    let text = full;
    if (full.length <= limit) {
      rows.forEach((_row, i) => selected.add(i));
    } else {
      const visible: string[] = [];
      let room = limit;
      // Reserve titles and whole URLs before spending room on previews.
      for (let i = 0; i < rows.length; i++) {
        const size = rows[i].header.length + (selected.size ? 2 : 0);
        if (size > room) continue;
        selected.add(i);
        room -= size;
      }
      for (const i of selected) {
        const row = rows[i];
        const allowance = Math.min(800, Math.floor(room / (selected.size - visible.length)) - 1);
        const preview = row.preview && allowance > 1 ? `\n${clipped(row.preview, allowance)}` : "";
        room -= preview.length;
        visible.push(row.header + preview);
      }
      text = visible.length ? visible.join("\n\n") : "Search results were too long to display.";
    }
    return result(text + notice, {
      fullContentRef: ref, resultCount: rows.length, omittedResultCount: rows.length - selected.size,
      truncated: full.length > limit || rows.some(row => row.replacement || row.preview.length > 800),
      results: snapshot.results.map((hit, i) => ({ resultIndex: i + 1, visible: selected.has(i), titleChars: hit.title.length, urlChars: hit.url.length, contentChars: hit.content.length })),
      appliedProfile,
    });
  }

  async function fetchPage(url: string, ctx: WebContext, signal?: AbortSignal): Promise<WebResult> {
    online();
    const session = state;
    const active = readProfiles(ctx);
    const input = validatePageUrl(url);
    const run = async (abort: AbortSignal): Promise<PageSnapshot & { kind: "fetch" }> => ({ kind: "fetch", ...await provider.fetch(input, abort) });
    const abort = operationSignal(session, signal);
    const page = await run(abort);
    if (abort.aborted) throw new Error("DeepSeek request cancelled.");
    const ref = session.refs.remember(page, active.replay ? run : undefined);
    const budget = active.profile.maxOutputChars;
    const title = oneLine(page.title);
    const header = title ? `${clipped(title, Math.min(240, Math.floor(budget / 4)))}\n\n` : "";
    const footer = `\n\nFetch ref: ${ref} (deepseek_web_read_full).`;
    const shown = prefix(page.content, budget - header.length - footer.length);
    const truncated = shown !== page.content || title !== page.title || (title.length > 0 && header.length < title.length + 2);
    return result((header + shown || "No page text returned.") + footer, {
      fullContentRef: ref, truncated, titleChars: page.title.length, contentChars: page.content.length,
      appliedProfile: { origin: active.origin, maxOutputChars: budget },
    });
  }

  async function read(input: ReadRequest, ctx: WebContext, signal?: AbortSignal): Promise<WebResult> {
    if (!input || typeof input.ref !== "string" || !input.ref.trim() || input.ref.length > 128) throw new Error("A valid retrieval ref is required.");
    const session = state;
    const page = await session.refs.read({ ...input, ref: input.ref.trim() }, { cwd: ctx.cwd, signal: operationSignal(session, signal) });
    if (page.mode === "file") {
      const suffix = page.temporary ? " (removed at session shutdown)." : ".";
      return result(`Exported section to ${JSON.stringify(page.path)}${suffix}`, page);
    }
    const { text, ...details } = page;
    const note = page.nextOffset === null ? "" : `\n\nContinue with offset=${page.nextOffset}.`;
    return result((text || "No text in this range.") + note, details);
  }

  return {
    search, fetchPage, read, readProfiles, close,
    async reset() {
      await close();
      state = { refs: createRetrieval(), controller: new AbortController() };
    },
  };
}
