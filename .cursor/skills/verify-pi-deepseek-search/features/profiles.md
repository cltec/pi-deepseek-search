# Apply optional model and project profiles

Profiles set search and output budgets without changing the conversation model. Missing or invalid configuration falls back without creating a file.

## Sub-features

- Exact model match takes precedence over the most-specific matching glob, then defaults.
- Project settings require both global opt-in and Pi project trust. Replay is global-only.

## How to get to it (user POV)

Create the optional global `pi-deepseek-search.json` in the Pi agent directory. For an opted-in, trusted checkout, add `.pi/pi-deepseek-search.json` in the project. Use a search or fetch with the intended Pi model selected. See [README profiles](../../../../README.md#profiles) for the schema and examples.

## Driving it with offline fixtures

Run `node --test test/config.test.ts test/extension.test.ts`. Require precedence, trust and opt-in checks, bounded invalid-file fallback, and no config file creation. The tool journey checks that the configured display budget actually limits search and fetch output. Use only disposable profile fixtures.

## Gotchas

- Do not opt the user's actual project in or change trust for verification.
- The live provider probe intentionally uses fresh defaults; it does not verify custom profiles or the interactive invalid-profile warning.
