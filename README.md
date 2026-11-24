# Pi DeepSeek Search

A [Pi](https://pi.dev) extension providing on-demand web discovery and page retrieval using the [DeepSeek Search & Fetch APIs](https://api-docs.deepseek.com/guides/search.md). It does not replace or select Pi's conversation model: the model and this extension's API access are configured independently.

[![CI](https://github.com/cltec/pi-deepseek-search/actions/workflows/ci.yml/badge.svg)](https://github.com/cltec/pi-deepseek-search/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Quick start

Requires Node.js 22.18 or newer and Pi 1.5.2 or newer in the 1.x series.

1. Install a tag listed on [Releases](https://github.com/cltec/pi-deepseek-search/releases):
   ```sh
   pi install git:github.com/cltec/pi-deepseek-search@v0.1.0
   ```
2. Set `DEEPSEEK_API_KEY` in Pi's environment, then start Pi. Never commit the key.
3. Run `/deepseek-search-status` in Pi to check tool registration. This does **not** verify credentials or connectivity.
4. Ask Pi, for example: “Search the web for recent Node.js release notes and summarize the sources.” The model can use search and return a summary with source URLs. Online calls may incur charges.

If `PI_OFFLINE` is present, even with an empty value, provider access is disabled. Loading the extension makes no provider request and creates no configuration. See [Cost, privacy and limits](#cost-privacy-and-limits) before sharing sensitive queries or URLs.

## What sets this extension apart

- **Bounded output with follow-up reads.** Search returns compact previews; fetch returns Markdown within a display budget. Use `deepseek_web_read_full` to page through cached content without another API request, or export an entire fetched field to a file. Temporary exports are cleaned up at session shutdown, and model-initiated exports to explicit paths require confirmation. Replay after eviction is off by default and can incur another charge if enabled.
- **Per-model profiles.** Set result counts, output budgets, and whether Search requests page content for the active Pi model. Project overrides require both global opt-in and Pi project trust.
- **Offline checks and direct developer commands.** `PI_OFFLINE` blocks provider calls even when set to an empty value. `/deepseek-search-status` checks tool registration without a model turn or provider request. Opt-in developer commands can run Search and Fetch without a conversation model.

This is not a drop-in replacement for bxff’s unscoped npm package. Both support standalone DeepSeek Search and Fetch; bxff also offers an optional model-mediated search backend and separate domain arguments. This extension uses query operators for domain filtering. See the [side-by-side comparison](docs/DEEPSEEK-EXTENSION-COMPARISON.md) for the tool contracts and trade-offs.

## Installation options


```sh
pi install npm:@cltec/pi-deepseek-search
```
Or:

```sh
pi install git:github.com/cltec/pi-deepseek-search
```

## Tools and commands

The model may call these tools when needed:

| Tool | Purpose |
| --- | --- |
| `deepseek_web_search` | Discover ranked sources from a query (1–128 Unicode characters), with titles, URLs and compact previews. |
| `deepseek_web_fetch` | Retrieve a known HTTP(S) URL (with no embedded credentials) as Markdown, subject to the display budget. |
| `deepseek_web_read_full` | Page through a field from a session ref, or export a fetched field to a file. |

| Command | Availability | Purpose |
| --- | --- | --- |
| `/deepseek-search-status` | Always | Check tool registration without a model turn or provider request. |
| `/deepseek-search QUERY`, `/deepseek-fetch URL`, `/deepseek-read-full JSON` | Developer mode | Invoke the corresponding operation directly. |

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


## Troubleshooting

- **Search or fetch fails:** Check that `DEEPSEEK_API_KEY` is set in Pi's environment and restart Pi after changing it. HTTP errors can also indicate balance, rate limits, or unavailable content.
- **Provider access is disabled:** Remove `PI_OFFLINE` from Pi's environment only when online requests are intended; even an empty value disables access.
- **Status command is missing:** Check that the extension loaded without a warning and is enabled in the current scope.

See [Troubleshooting](docs/TROUBLESHOOTING.md) for more symptoms and fixes.

## Development

No `npm install` is needed for offline checks. The real-Pi smoke suite uses the version pinned in [`scripts/quality.json`](scripts/quality.json) and a GNU-compatible `tar`.

```sh
npm run check       # Offline tests and package allowlist
npm run test:e2e    # Real Pi, isolated and offline
```

Set `PI_BIN` to an absolute path to select the pinned Pi binary. Smoke tests use temporary directories and an allowlisted environment; they make no provider calls. The packed test loads an extracted archive locally, not through `pi install`. No live API or credential verification is implied by these checks. For the regression workflow and a separate, explicitly opt-in live provider probe, see [Testing](docs/TESTING.md#manual-provider-probe).

See [Architecture](docs/ARCHITECTURE.md), [Testing](docs/TESTING.md), [Troubleshooting](docs/TROUBLESHOOTING.md), and [Contributing](CONTRIBUTING.md). For distribution and npm publication plans, see [Releasing](docs/RELEASING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Apache-2.0. See [LICENSE](LICENSE).
