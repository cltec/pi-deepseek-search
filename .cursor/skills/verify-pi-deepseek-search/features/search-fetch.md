# Search the web and fetch a source

Pi can discover sources with `deepseek_web_search`, then inspect a selected source as Markdown with `deepseek_web_fetch` before citing it.

## Sub-features

- Search returns ranked URLs and bounded previews. Empty success is distinct from provider failure.
- Fetch accepts a selected HTTP(S) URL and exposes Markdown and a session ref.
- `PI_OFFLINE` blocks Search and Fetch even when its value is empty.

## How to get to it (user POV)

- In Pi with the extension loaded, ask for online research and explicitly request a search followed by a fetch of one of the results.
- With `PI_DEEPSEEK_SEARCH_DEV=1`, use `/deepseek-search QUERY` and `/deepseek-fetch URL` to run the same operations without a conversation model.

## Driving it with offline fixtures and the provider probe

- **Regression:** `node --test test/extension.test.ts test/provider.test.ts`. Require the search → selected fetch journey and exact endpoint/body assertions. Preserve the distinction between compact previews and Markdown content, and between empty results and sanitized errors. The suite uses fabricated responses and covers validation, deadlines, cancellation, and no retries.
- **Real Pi, offline:** run the skill's [provider probe](../SKILL.md#provider-probe) in `--offline` mode. Require checkout command discovery, `search-blocked-offline`, `fetch-blocked-offline`, and `idle-empty-transcript`. No key reaches Pi.
- **Real provider (optional):** get fresh authorization before each `--live` run. Export `DEEPSEEK_API_KEY` in the invoking environment; leave `PI_OFFLINE` unset. The probe sends a fixed, public NASA mission query, selects one relevant official NASA HTTPS result, fetches it, and reads the same ref from the cache. Require `search-returned-official-source`, `fetch-returned-mission-page`, `read-returned-cached-page-text`, and `idle-empty-transcript`. The probe invokes Search and Fetch at most once each through Pi RPC and stops on the first error; no model turn, retry, or replay is configured. Retain only the probe's sanitized report.

## Gotchas

- The live probe verifies real API compatibility through Pi's developer commands. It does not verify model tool selection, citation quality, or HTTP-level instrumentation. A model-driven run is a separate, explicitly approved trial; verify tool events and cited URL, not answer plausibility alone.
- Pi can replace global `fetch` during startup. Do not use a preloaded global `fetch` wrapper as evidence of an enforced network cap.
- No official result, changed source text, quota, auth, and provider failures are live-probe failures. Report the category; do not substitute a known URL, broaden the request budget, or retry automatically.
- Keep fixture gates offline regardless of provider availability; do not read or source credential files in the skill.
