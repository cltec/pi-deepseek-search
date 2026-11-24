export type SearchRequest = { query: string; count: number; needContent: boolean };
export type SearchHit = { title: string; url: string; content: string; snippet: string; summary: string };
export type FetchedPage = { title: string; content: string };

export const MISSING_KEY_MESSAGE = "DeepSeek API key is missing. Set DEEPSEEK_API_KEY.";
const MAX_BODY = 16 * 1024 * 1024;
class ProviderError extends Error {}

export function validateSearchRequest(request: SearchRequest): SearchRequest {
  if (!request || typeof request.query !== "string") throw new Error("Search query must contain 1 to 128 Unicode characters.");
  const query = request.query.trim();
  if (!query || Array.from(query).length > 128) throw new Error("Search query must contain 1 to 128 Unicode characters.");
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 50) throw new Error("Search count must be an integer between 1 and 50.");
  if (typeof request.needContent !== "boolean") throw new Error("Search needContent must be a boolean.");
  return { query, count: request.count, needContent: request.needContent };
}

export function validatePageUrl(url: string): string {
  if (typeof url !== "string") throw new Error("URL must be an absolute HTTP(S) URL without credentials (maximum 8192 characters).");
  const value = url.trim();
  try {
    if (value.length > 8192 || !/^https?:\/\//i.test(value)) throw new Error();
    const parsed = new URL(value);
    if (!parsed.hostname || parsed.username || parsed.password || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error();
    // URL normalizes empty userinfo away, but it is still credentials syntax.
    const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0];
    if (!authority || authority.includes("@")) throw new Error();
    return value;
  } catch {
    throw new Error("URL must be an absolute HTTP(S) URL without credentials (maximum 8192 characters).");
  }
}

const statusAdvice: Record<number, string> = {
  400: "Check the request.", 401: "Check the API key.", 402: "Top up the account balance.",
  403: "The request was rejected by the security policy.", 404: "No usable page content was available.",
  408: "Try again later.", 413: "Reduce the request size.", 429: "Rate limit exceeded; try again later.",
  500: "Provider error; try again later.", 504: "Provider timed out; try again later.",
};

export function createProvider(options: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("Timeout must be a positive finite number of milliseconds.");

  async function post<T>(endpoint: "search" | "fetch", body: object, parse: (data: any) => T, signal?: AbortSignal): Promise<T> {
    if (!options.apiKey?.trim()) throw new Error(MISSING_KEY_MESSAGE);
    if (signal?.aborted) throw new Error("DeepSeek request cancelled.");
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    const checkDeadline = () => {
      if (signal?.aborted) throw new ProviderError("DeepSeek request cancelled.");
      if (performance.now() >= deadline) throw new ProviderError("DeepSeek request timed out.");
    };
    let reason = "DeepSeek request cancelled.";
    let rejectAbort: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => { controller.abort(); rejectAbort(new Error(reason)); };
    const onAbort = () => cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { reason = "DeepSeek request timed out."; cancel(); }, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const work = async () => {
        const response = await fetchImpl(`https://api.deepseek.com/v1/tools/${endpoint}`, {
          method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), redirect: "error", signal: controller.signal,
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new ProviderError("DeepSeek request cancelled.");
        }
        try { checkDeadline(); } catch (error) {
          void response.body?.cancel().catch(() => {});
          throw error;
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const status = response.status;
          throw new ProviderError(`DeepSeek API HTTP ${status}. ${statusAdvice[status] ?? (status >= 500 ? "Provider error; try again later." : "Check the request and provider documentation.")}`);
        }
        if (!response.body) throw new ProviderError("DeepSeek returned an invalid response.");
        reader = response.body.getReader();
        let bytes = new Uint8Array(0);
        let size = 0;
        let reads = 0;
        while (true) {
          const part = await reader.read();
          checkDeadline();
          if (part.done) break;
          const nextSize = size + part.value.byteLength;
          if (nextSize > MAX_BODY) throw new ProviderError("DeepSeek response exceeded the size limit.");
          if (nextSize > bytes.length) {
            const grown = new Uint8Array(Math.min(MAX_BODY, Math.max(nextSize, bytes.length * 2, 1024)));
            grown.set(bytes.subarray(0, size));
            bytes = grown;
          }
          bytes.set(part.value, size);
          size = nextSize;
          // A stream of immediately resolved reads must not starve cancellation or timers.
          if (++reads % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        let data: unknown;
        try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))); }
        catch { checkDeadline(); throw new ProviderError("DeepSeek returned an invalid response."); }
        checkDeadline();
        let result: T;
        try { result = parse(data); } catch (error) { checkDeadline(); throw error; }
        checkDeadline();
        return result;
      };
      // Wrap transport failures separately so their messages can never escape.
      const safeWork = work().catch((error: unknown) => {
        if (error instanceof ProviderError) throw error;
        throw new Error("DeepSeek request failed. Check your connection and try again.");
      });
      return await Promise.race([safeWork, aborted]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (reader) void reader.cancel().catch(() => {});
    }
  }

  return {
    async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchHit[]> {
      const input = validateSearchRequest(request);
      return post("search", { query: input.query, count: input.count, need_content: input.needContent }, data => {
        if (!data || !Array.isArray(data.results)) throw new ProviderError("DeepSeek returned an invalid response.");
        return data.results.slice(0, input.count).map((item: any) => {
          const content = input.needContent ? item?.content : "";
          if (!item || [item.title, item.url, content, item.snippet, item.summary].some(value => typeof value !== "string")) throw new ProviderError("DeepSeek returned an invalid response.");
          let url: string;
          try { url = validatePageUrl(item.url); } catch { throw new ProviderError("DeepSeek returned an invalid response."); }
          return { title: item.title, url, content, snippet: item.snippet, summary: item.summary };
        });
      }, signal);
    },
    async fetch(url: string, signal?: AbortSignal): Promise<FetchedPage> {
      return post("fetch", { url: validatePageUrl(url) }, data => {
        if (!data || typeof data.title !== "string" || typeof data.content !== "string") throw new ProviderError("DeepSeek returned an invalid response.");
        return { title: data.title, content: data.content };
      }, signal);
    },
  };
}
