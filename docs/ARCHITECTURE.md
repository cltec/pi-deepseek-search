# Architecture

Pi loads `src/index.ts` from the checkout or package manifest. `src/wiring.ts` registers three tools and the offline `/deepseek-search-status` command; optional developer commands invoke the same operations. The extension is independent of Pi's conversation model. Loading reads environment settings but creates no config and makes no provider requests. Session start resets retrieval and may read profiles and display warnings; presence of `PI_OFFLINE` suppresses provider access.

## Layers and data flow

- `config.ts` reads bounded JSON profiles from the agent directory and, only with explicit global opt-in and Pi project trust, the project `.pi` directory. It resolves defaults and model selectors; it never creates configuration.
- `provider.ts` validates queries and HTTP(S) URLs, sends authenticated POST requests to fixed DeepSeek Search and Fetch endpoints, validates responses, bounds responses to 16 MiB and requests to 60 seconds, propagates cancellation, and returns sanitized transport errors. There is no endpoint override.
- `web.ts` orchestrates calls, profiles, compact display budgets, and session refs. Discovery prefers summary then snippet, with content as fallback; fetching exposes the provider's Markdown, not a separate links collection. No image-search tool is registered.
- `retrieval.ts` stores bounded session snapshots and metadata. Read pages one field or exports a fetch field; explicit exports use staging and default to no-clobber, requiring existing parent directories. Temporary exports are cleaned up at session shutdown. Explicit model-initiated destinations require UI confirmation; user-invoked developer exports and approved model exports participate in Pi's file mutation queue. References reset with the session.

Retrieval defaults to 256 records, 32 MiB of cached payload, and 4 MiB of search identity metadata (at most 1 MiB per record). Other limits bound concurrent reads/replays and temporary exports. Evicted payloads are unavailable unless global replay was enabled when the ref was created. Replay makes at most one attempt per ref, deduplicates concurrent reads and caches a successful response when it fits. Search replay matches original URLs by occurrence, not current rank; a changed or missing result can be unavailable. Replays can make additional billable requests and cannot guarantee the original text. Search URL metadata can be read even when its payload is evicted. All refs disappear on reset/shutdown.

User queries and URLs are sent to DeepSeek only for requested operations (including optional replay). API results are untrusted. Provider calls use `DEEPSEEK_API_KEY`; the selected Pi conversation model may independently receive tool output. See [Security](../SECURITY.md) and [README](../README.md) for usage, costs, and trust boundaries. The pre-port [Ollama parity assessment](OLLAMA-PARITY-ASSESSMENT.md) records what the upstream reference originally supported.

## Verification and packaging

- `test/` exercises configuration, provider behavior using fakes, retrieval, wiring, and tooling offline. It does not launch Pi or contact the provider.
- `e2e/` exercises real Pi in checkout RPC, headless JSON, and packed-archive RPC modes, offline. It extracts the tarball with GNU-compatible `tar` and loads the local directory through its manifest; it does not exercise `pi install` or registry resolution.
- `scripts/quality.json` pins Pi for smoke tests. The package allowlist includes root metadata and non-hidden `src/**/*.ts` excluding tests, specs, and agent instructions. See [Testing](TESTING.md).
- Release workflows verify stable version changes; publication remains gated. See [Releasing](RELEASING.md). The template ADR's greeting example is historical.
