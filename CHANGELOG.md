# Changelog

Notable changes to Pi DeepSeek Search are recorded here.

## [Unreleased]

- Added DeepSeek web search, Markdown fetch, and session-scoped read, paging, and fetch export tools, with optional developer commands.
- Added optional model profiles, trusted opt-in project configuration, bounded retrieval cache and opt-in replay, and `PI_OFFLINE` provider suppression. Loading does not make a provider request or create configuration.
- Documented direct API billing and privacy considerations; offline checks do not verify live credentials or API behavior.

## [0.1.0]

- Initialized the package from `cltec/pi-extension-template`, retaining offline checks, the package allowlist, isolated real-Pi smoke tests, and gated releases.
- Added `/deepseek-search-status` to verify loading without credentials, network calls, or a model turn. The DeepSeek integration is not yet implemented.
