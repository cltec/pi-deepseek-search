# Changelog

Notable changes to Pi DeepSeek Search are recorded here.

## Unreleased

- Improve README onboarding, tool and command navigation, troubleshooting, and CI and license badges.

## [0.2.0]

- Prepare the first npm distribution as `@cltec/pi-deepseek-search`. The unscoped npm package is a different extension. GitHub installation remains supported, and tool behavior is unchanged.

## [0.1.0]

- First GitHub distribution of Pi DeepSeek Search. Added DeepSeek web search, Markdown fetch, and session-scoped paging and fetch exports, with optional developer commands.
- Added optional model profiles, trusted opt-in project configuration, bounded retrieval and opt-in replay, and `PI_OFFLINE` provider suppression. Loading makes no provider request and creates no configuration.
- Added `/deepseek-search-status` to verify tool registration without credentials, network calls, or a model turn.
- Kept the template's offline checks, package allowlist, isolated real-Pi smoke tests, and gated release workflows. Added a project verification skill and a separate, opt-in provider probe. Offline checks do not verify live credentials or API behavior.
