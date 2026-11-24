# Pi DeepSeek Search

A [Pi](https://pi.dev) extension providing on-demand web discovery and page retrieval using the [DeepSeek Search & Fetch APIs](https://api-docs.deepseek.com/guides/search.md). It does not replace or select Pi's conversation model: the model and this extension's API access are configured independently.

## What sets this extension apart

- **Bounded output with follow-up reads.** Search returns compact previews; fetch returns Markdown within a display budget. Use `deepseek_web_read_full` to page through cached content without another API request, or export an entire fetched field to a file. Temporary exports are cleaned up at session shutdown, and model-initiated exports to explicit paths require confirmation. Replay after eviction is off by default and can incur another charge if enabled.
- **Per-model profiles.** Set result counts, output budgets, and whether Search requests page content for the active Pi model. Project overrides require both global opt-in and Pi project trust.
- **Offline checks and direct developer commands.** `PI_OFFLINE` blocks provider calls even when set to an empty value. `/deepseek-search-status` checks tool registration without a model turn or provider request. Opt-in developer commands can run Search and Fetch without a conversation model.

This is not a drop-in replacement for bxff’s unscoped npm package. Both support standalone DeepSeek Search and Fetch; bxff also offers an optional model-mediated search backend and separate domain arguments. This extension uses query operators for domain filtering. See the [side-by-side comparison](docs/DEEPSEEK-EXTENSION-COMPARISON.md) for the tool contracts and trade-offs.

## Getting started

Use Node.js 22.18 or newer and Pi 1.5.2 or newer in the 1.x series (the smoke suite pins 1.5.2). Install from GitHub using a tag listed on [Releases](https://github.com/cltec/pi-deepseek-search/releases), for example:

```sh
pi install git:github.com/cltec/pi-deepseek-search@v0.1.0
```

Once `@cltec/pi-deepseek-search@0.2.0` is published on npm, you can also install that version with:

```sh
pi install npm:@cltec/pi-deepseek-search@0.2.0
```

The unscoped npm package `pi-deepseek-search` is a different extension. To try this checkout without installing it, run `pi -e ./src/index.ts`. Set `DEEPSEEK_API_KEY` in Pi's environment before using the online tools.

Never commit the key. `/deepseek-search-status` checks registered tools without a model turn or provider request; it does not verify credentials or connectivity. Loading the extension makes no provider request and does not create configuration. It reads the key from the environment; it does not send it until a provider call. If `PI_OFFLINE` is present in the environment, even with an empty value, provider access is disabled. There is no endpoint override.

The model may call these tools when needed:

- `deepseek_web_search`: discover ranked sources from a query (1–128 Unicode characters). It displays titles, URLs and compact previews, preferring summary, then snippet, then content. Search content may be absent; the default does not request it.
- `deepseek_web_fetch`: retrieve one known HTTP(S) URL without credentials. It returns the provider's Markdown content, subject to the display budget. It does not extract a separate links section or offer image search.
- `deepseek_web_read_full`: read a field from a session ref shown in search/fetch output. Search refs require the original **1-based** `resultIndex` and support `title`, `url`, or `content`; fetch refs support `title` or `content`, not `resultIndex`. Content defaults to `content`. Search content is the returned page content when available, otherwise the preview; it is not necessarily a full page. Fetch content is the exact Markdown returned by the API, not a separately reconstructed page.

Inline reads default to 8,000 Unicode code points (`maxChars` up to 50,000, excluding the continuation note). Pass `nextOffset` back unchanged; offsets count UTF-16 units. For fetch refs only, `mode: "file"` exports the entire field. Omit `path` for a private temporary file cleaned up at session shutdown. Explicit paths persist, require an existing parent, and resolve relative to Pi's working directory (an optional `@` prefix is accepted). Model-initiated explicit exports require confirmation and are unavailable without a UI. Existing files are replaced only with `overwrite: true`; replacement installs a new private file, not the old file's metadata.

Refs and cached content are session-scoped and bounded; they may be evicted. Normally read uses cached data without a provider request. Optional replay can make at most one additional provider attempt per evicted ref, sharing concurrent reads and caching a successful result when it fits. A replay can return changed or unavailable content and incur another charge; it is not an archival guarantee. Search replay maps results to original URLs, including repeated URLs by occurrence.

For interactive debugging, start Pi with `PI_DEEPSEEK_SEARCH_DEV=1` (or `true`). The commands `/deepseek-search QUERY`, `/deepseek-fetch URL`, and `/deepseek-read-full {"ref":"fetch:…","section":"content"}` call the same operations as their respective tools. Debug commands can make billable requests; status cannot. The UI shows debug results as notifications; JSON mode emits custom entries rather than model messages. A user-invoked `/deepseek-read-full` can specify an explicit export path without a separate dialog.

## Profiles

Configuration is optional and never auto-created. The global file is `pi-deepseek-search.json` in Pi's agent directory (normally `~/.pi/agent/`; respects `PI_CODING_AGENT_DIR`). For example:

```json
{
  "version": "1",
  "allowProjectConfig": true,
  "replay": false,
  "default": { "maxResults": 3, "maxOutputChars": 12000, "needContent": false },
  "models": {
    "example-provider/example-model": { "maxResults": 5, "maxOutputChars": 16000, "needContent": true },
    "example-provider/*": { "maxResults": 3, "maxOutputChars": 8000 }
  }
}
```

`maxResults` is 1–50; `maxOutputChars` is 256–50,000; `needContent` is boolean. Model selectors match Pi's current `provider/id`: exact matches win, otherwise the matching `*` pattern with the most non-wildcard characters wins. Model overrides must include both numeric budgets; `needContent` is optional. The defaults shown apply without configuration.

A project may supply `.pi/pi-deepseek-search.json` with `version`, `default`, and `models` only. It is read **only** when global `allowProjectConfig` is explicitly `true` and Pi reports the project trusted. Project defaults and matching model fields overlay global ones. `replay` and `allowProjectConfig` are global-only. Invalid or unreadable files are ignored; interactive sessions warn. Profiles control output and search request size, not the Pi conversation model.

## Cost, privacy and limits

Calls are on demand, but the model can decide to use tools during a conversation. Search sends the query; fetch sends the URL; both send the API key to DeepSeek. Avoid sensitive queries and URLs unless you intend to share them. Provider results and explicit exports can contain sensitive or untrusted text; Pi and the selected model may receive tool output, and Pi may retain conversation data according to its own settings. Do not follow instructions embedded in web pages as trusted instructions.

These are direct client API calls, not DeepSeek server-side model tools. DeepSeek documents billing per successful non-empty Search/Fetch request; see its [billing and limits](https://api-docs.deepseek.com/guides/search.md#billing) for current terms. Replay can cause another request. The extension applies a 60-second provider timeout and a 16 MiB response limit; provider rate limits and page availability also apply.

## Migrating from `pi-ollama-web-search`

Disable the old extension if you want only DeepSeek tools. Update prompts and scripts to use the `deepseek_web_*` names, and set `DEEPSEEK_API_KEY`; the Ollama key and profile file are not read. Create the DeepSeek profile file above if you need custom budgets. Old refs do not transfer. Config files are not generated automatically, replay is off unless you enable it, and fetch exposes Markdown links only as part of the page text.

## Development

No `npm install` is needed for offline checks. The real-Pi smoke suite uses the version pinned in [`scripts/quality.json`](scripts/quality.json) and a GNU-compatible `tar`.

```sh
npm run check       # Offline tests and package allowlist
npm run test:e2e    # Real Pi, isolated and offline
```

Set `PI_BIN` to an absolute path to select the pinned Pi binary. Smoke tests use temporary directories and an allowlisted environment; they make no provider calls. The packed test loads an extracted archive locally, not through `pi install`. No live API or credential verification is implied by these checks. For the regression workflow and a separate, explicitly opt-in live provider probe, see [Testing](docs/TESTING.md#manual-provider-probe).

See [Architecture](docs/ARCHITECTURE.md), [Testing](docs/TESTING.md), [Troubleshooting](docs/TROUBLESHOOTING.md), and [Contributing](CONTRIBUTING.md). For distribution and npm publication plans, see [Releasing](docs/RELEASING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Apache-2.0. See [LICENSE](LICENSE).
