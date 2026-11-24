# Ollama reference: features, tests, and DeepSeek port assessment

This is input to the extension spec, not an agreed v1 contract. The reference is [`cltec/pi-ollama-web-search` at `9c150e4`][upstream] (`@cltec/pi-ollama-web-search@1.0.0`). The comparison uses the documented standalone [DeepSeek Search & Fetch APIs][deepseek], not the web tools built into DeepSeek model conversations.

**Bottom line:** Reuse the reference tests as behavioral acceptance cases, not as an unchanged suite. The compact search → targeted fetch workflow, output budgets, and any retained retrieval behavior transfer well. A simple rename would silently return the wrong number of results, show empty search bodies, and advertise a fetch links field that DeepSeek does not return. Profiles, replay, and file exports account for a substantial part of the suite; retaining their tests is a product decision, not a requirement for switching providers.

## Baseline verification

Ran the reference from a clean temporary checkout with Node 22.22.3 and its locked dependencies (Vitest 4.1.5, TypeScript 5.9.3, Pi peer 0.74.0). Dependency installation used the npm registry; checks ran with a temporary home and no provider credentials. Results:

```text
npm run typecheck   # exit 0
npm test
  Test Files  10 passed (10)
       Tests  168 passed (168)
```

The [reference CI][ci] runs typecheck and Vitest on Linux with Node 20 and 22. The client tests use a loopback HTTP server as well as injected fakes. Search/fetch pipeline tests inject `fetch`; extension tests capture Pi registrations with fakes and invoke handlers directly, using temporary config and export fixtures. Retrieval unit tests mock file operations. The suite does not launch Pi, verify a packed extension load, or exercise the live Ollama provider. The DeepSeek comparison is based on first-party docs, not authenticated API calls. This project's [existing test layers](TESTING.md) and Pi pin remain unchanged.

## Feature and test inventory

| Reference feature | Existing automated evidence | Port decision |
| --- | --- | --- |
| **Search** (`ollama_web_search`): compact title/URL/content, empty-results state, and per-result metadata plus a ref for follow-up. | [Search pipeline][t-search] (8): key check before I/O, response and ref metadata, output budgets, truncation notices, and no ref on empty results. | Retain the discovery and empty-result cases. Rewrite the response fixtures and decide which text backs the preview and each retrieval section. |
| **Fetch** (`ollama_web_fetch`): read a known URL; show page title, content, and discovered links within the budget. | [Fetch pipeline][t-fetch] (6): key check, normalization, source URL forwarded for replay, ref metadata and bounded output. | Retain the single-URL and Markdown cases. Replace URL assumptions and drop provider-supplied links assertions. |
| **HTTP and normalization**: JSON POST with bearer auth, payload validation, typed HTTP/network/JSON errors, abort propagation. | [Transport][t-client] (11) and [normalization][t-normalize] (12): URL/headers/body, HTTP failure, malformed JSON, abort during request/body read, invalid fields, whitespace, optional links. | Keep the assertion patterns. Replace wire expectations, field fixtures and error cases. Verify Markdown does not lose meaningful formatting. |
| **Context budget**: clip initial search/fetch text, report omitted/truncated results, and expose visibility/size metadata for selective reads. | [Formatter][t-format] (13): output within the character limit, intact search title/URL when presented, order under tight budgets, truncation notices and visibility metadata. | Port the invariants first. Exact strings, field order, character counts, and recommendation thresholds depend on the new output contract. |
| **Follow-up reads** (`ollama_web_read_full`): resolve opaque refs; select one field with optional `offset`/`maxChars`; search uses a 1-based result index. Reference fields are search `title`/`url`/`content` and fetch `title`/`content`/`links`. | [Read dispatcher][t-read] (8), [search store][t-store] (16), and [fetch retrieval][t-retrieval] (30): validation, slicing, byte-budget eviction, fetch entry-count eviction, stale refs, replay, and file operations. | Keep validation, slicing and retention tests for whatever ref service we agree on. Drop `links` and any compatibility aliases we do not ship. Add a hard default inline limit if we want every follow-up bounded: the reference returns the rest of a section when `maxChars` is omitted. |
| **Replay and file export**: reissue the original request after payload eviction; preserve the ref and report `cache` or `replay`. Search replay remaps by URL occurrence, not current rank. Fetch can export to a temp file or a caller path with explicit overwrite; only temp files are cleaned at shutdown. | Same [store][t-store], [retrieval][t-retrieval], and [extension][t-extension] suites: reorder/duplicate/missing hits, fetch replay deduplication and cancellation, no late refill of cleared state, overwrite and real temp-file cleanup. | Separate options. Keep cache/retrieval tests without replay if refs just expire. If shipping exports, keep real filesystem tests for overwrite refusal, cleanup after abort, temp deletion and explicit-file retention. |
| **Config and model profiles**: `OLLAMA_API_KEY`; auto-created, versioned global config (3 results, 12,000 visible characters); project override; exact model > specific glob > default; invalid config warns and falls back. | [Config][t-config] (28): auth, defaults, create-without-overwrite, precedence, version warnings, profile fallback; [extension][t-extension] checks effective profile choices. | Reuse key handling. Port file/profile tests only if we select that config surface; don't inherit legacy defaults or writes by accident. |
| **Pi wiring and debug entry points**: three tools, three dev-gated slash commands, startup warnings/store reset, and shutdown cleanup. | [Extension][t-extension] (36): fake registration and handler invocation, dev gating, result/details shape, config, replay and export through registered handlers. | Reuse the fake-registration pattern in `node:test`. Keep startup/shutdown and debug tests only for the chosen lifecycle. Real-Pi loading still needs this repo's separate smoke checks. |

Counts are per file; suites cited on multiple rows overlap. The reference [tool registrations][wiring] and tests are the source of truth when older repo guidance disagrees. The reference caps formatted text, but [its tool `details` also carry normalized result bodies][wiring]. Specify and test bounds for model-facing text, structured details and retained bytes separately instead of assuming a formatter assertion covers them all.

## DeepSeek differences that require changed or new tests

| Documented API difference | Port and acceptance impact |
| --- | --- |
| Both endpoints use JSON POST and bearer auth, but paths are `/v1/tools/search` and `/v1/tools/fetch` on `api.deepseek.com`. DeepSeek examples use `DEEPSEEK_API_KEY`. The [Ollama client][client] sends `max_results`; DeepSeek expects integer `count` (1–50, default 10) and ignores unknown fields. [Search reference][ds-search] | Assert the exact outbound body and path, including **no `max_results`**. Test invalid counts, missing key with no I/O, and that the key isn't forwarded anywhere except the provider's auth header or exposed in output. |
| Search requires a nonblank query of 1–128 Unicode characters and supports query operators. `ori_question` and IP `localization` are optional. [Guide][deepseek] | Test blank, 128/129-character and non-ASCII boundaries, and preservation of operators. Decide separately if we ever send the original user question or a localization IP; don't inherit either by default. |
| Search returns `snippet` and model-oriented `summary`; `content` is empty by default and may be unavailable even with `need_content: true`. Results also include ranking and site/date metadata. An empty `results` array is success. [Search reference][ds-search] | Choose preview/fallback fields and whether to request full search content. Add fixtures with empty `content`, snippet/summary, nullable metadata, and zero hits. Ensure a useful preview and do not advertise unavailable sections. Leave ranking and metadata display to the spec. |
| Fetch requires an HTTP(S) URL with host, no username/password, and at most 8,192 characters. It returns only `{title, content}`, with an empty title when unavailable and content as Markdown. [Fetch reference][ds-fetch] | Replace the Ollama bare-domain passthrough case with an explicit reject-or-normalize decision. Test scheme, credentials, limits, empty title and Markdown. Remove `links` from formatting and retrieval schemas unless we deliberately implement link extraction. |
| DeepSeek documents 401 (auth), 402 (balance), 403 (fetch policy), 404 (fetch yielded no usable page), 429 (rate limit), and timeouts. Successful standalone requests are billed per request. [Errors, billing and limits][deepseek] | Make these failures distinguishable without echoing raw bodies, keys, or query/URL content. Test timeout and cancellation during request/body read. Decide if retry is allowed before adding it. If replay is enabled, test that it preserves the original request options (including `count`/`need_content` if used), uses no network on a cache hit, and handles changed/missing upstream results. Successful replay can incur another charge. |

Use docs-shaped fixtures in the default offline suite. Port the reference loopback client assertions to injected `fetch` in `node:test` so the test runner opens no sockets. Agree on a separate opt-in, budgeted live contract check if needed; a mocked provider won't catch upstream drift. For any retained part of the reference, corroborate the ref and tool schemas against the pinned Pi host. If we copy substantial source or test code, preserve the upstream [MIT copyright and permission notice][mit] alongside those portions without changing this project's `LICENSE`.

## Suggested spec starting point

Start with **compact search → selected URL fetch** as the core acceptance journey. The agent gets usable titles, URLs, and bounded preview text, then fetches one source as Markdown for evidence; it does not fetch every result or turn a provider failure into “no results.” Use DeepSeek summaries/snippets as the default discovery candidate rather than requesting all page bodies up front. The open scope decision is how the agent reads past a truncated fetch: a bounded, session-local `read_full` is closest to the reference without paid replay or filesystem side effects. Treat search refs, replay, file export, profile files, and debug commands as independently selectable. Once scope is decided, port the applicable assertions before implementing the provider adapter; leave the rest documented, not as skipped tests.

[upstream]: https://github.com/cltec/pi-ollama-web-search/tree/9c150e4c047b197bed8bac3c9626248e46b6cde8
[ci]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/.github/workflows/test.yml
[wiring]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/src/index.ts#L226-L414
[client]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/src/client.ts#L92-L116
[mit]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/LICENSE
[t-search]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/search.test.ts
[t-fetch]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/fetch.test.ts
[t-client]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/client.test.ts
[t-normalize]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/normalize.test.ts
[t-format]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/format.test.ts
[t-read]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/read-full.test.ts
[t-store]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/store.test.ts
[t-retrieval]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/retrieval.test.ts
[t-config]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/config.test.ts
[t-extension]: https://github.com/cltec/pi-ollama-web-search/blob/9c150e4c047b197bed8bac3c9626248e46b6cde8/test/extension.test.ts
[deepseek]: https://api-docs.deepseek.com/guides/search/
[ds-search]: https://api-docs.deepseek.com/api/search.md
[ds-fetch]: https://api-docs.deepseek.com/api/fetch.md
