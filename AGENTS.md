<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->

# AGENTS.md

**Precedence:** the closest `AGENTS.md` to the files you are changing wins. This file holds global defaults. Explicit user prompts override these files.

## Commands

Source: `package.json` and the repository scripts. No lint, typecheck, or build is configured; do not invent one.

| Task | Command | Notes |
| --- | --- | --- |
| Unit, wiring, and tooling tests | `npm test` | Offline, no install, no Pi process |
| Package allowlist check | `npm run check:package` | Asserts `npm pack` contents |
| Full local check | `npm run check` | `npm test && npm run check:package` |
| End-to-end (real Pi) | `npm run test:e2e` | Separate; checkout RPC, headless JSON, and packed archive |
| Single test file | `node --test test/extension.test.ts` | Replace with the file you are changing |

- `npm test` and `npm run check:package` need no dependency installation.
- Node.js 22.18+ is required. CI runs the same checks on Node 22 and 24 on Linux; local runs in this repository use Node 22.
- Pi 1.5.2 is the baseline in `scripts/quality.json`. E2E uses `pi` from `PATH`, or `PI_BIN` as an absolute path. The selected binary's version must equal the baseline unless `PI_VERSION` sets the exact stable version. Both variables are for temporary compatibility experiments; adopting a version means updating `scripts/quality.json` and the docs.
- CI's initial pinned Pi install requires network. Test execution itself stays offline.
- `npm run check` is `npm test && npm run check:package`; it does not run e2e.

## Workflow

1. Read this file and the nearest scoped `AGENTS.md`.
2. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the relevant part of [`docs/TESTING.md`](docs/TESTING.md).
3. Make the smallest change that solves the problem.
4. Run the smallest relevant check while iterating; run `npm run check` before claiming done.
5. Run `npm run test:e2e` when changing wiring, the command contract, package contents, or the Pi baseline.
6. Paste command output as evidence. Never say "tested" or "all green" without it.
7. For release requests, read [`docs/RELEASING.md`](docs/RELEASING.md). Version and changelog changes need a reviewed pull request; local/manual tagging requires explicit user authorization; reviewed stable version increases on main use the configured automatic release workflow. Never tag or publish as part of an unrelated task.

## File map

| Path | Purpose |
| --- | --- |
| `src/` | Extension source. Wiring and pure logic: [`src/AGENTS.md`](src/AGENTS.md). |
| `test/` | Offline `node:test` suites: [`test/AGENTS.md`](test/AGENTS.md). |
| `e2e/` | Real-Pi smoke harness (RPC and headless JSON) and its isolation rules: [`e2e/AGENTS.md`](e2e/AGENTS.md). |
| `scripts/` | Package allowlist, release checks, e2e summary, and isolation helpers. `scripts/quality.json` pins the Pi baseline. |
| `docs/` | Architecture, testing, troubleshooting, ADRs, and release guide. |
| `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/` | User and contributor documentation, CI, and the pull request template. |
| `package.json` | Package metadata, scripts, Pi manifest, and package allowlist. |

## Invariants

- Provider requests are on demand, go only to DeepSeek's fixed Search/Fetch endpoints, and are disabled by `PI_OFFLINE`. Replay requires global opt-in. Loading makes no provider requests and writes no configuration.
- Keep `src/index.ts` as thin Pi wiring. Put provider I/O and independently testable logic in separate modules.
- Use `import type` for host types. Runtime imports from Pi host peers are legitimate because Pi supplies them; host packages stay peer dependencies.
- Automated tests are offline and deterministic. `npm test` may use temporary fixtures and isolated local Node subprocesses for the release CLI; it must not launch Pi, run `npm pack`, or use the network. Only e2e launches Pi in automated tests. For manual verification, follow the [verification skill](.cursor/skills/verify-pi-deepseek-search/SKILL.md); a live probe requires fresh user authorization.
- E2E uses a temporary home, config directory, and working directory; passes an explicit environment allowlist; makes no provider calls; bounds shutdown; cleans up; and writes only a sanitized schema-1 result (default `artifacts/e2e-result.json`, or `E2E_RESULT_PATH`).
- The packed e2e scenario inspects and extracts the tarball with a system GNU-compatible `tar` (regular files and directories only), then loads the extracted directory through a temporary Pi `settings.json` `packages` entry. It does not run `pi install` or contact a registry; those paths are a known coverage limit. `PACKAGE_ARCHIVE` may point at an exact checked release tarball instead of repacking.
- Node.js 22.18+ and the `scripts/quality.json` Pi baseline are the compatibility floor. Do not claim Windows, macOS, or other OS coverage without evidence.
- Packaging is an allowlist: `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, plus non-hidden `src/**/*.ts` excluding `*.test.ts`, `*.spec.ts`, and `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`. Agent docs, tests, e2e files, docs, secrets, and tarballs are not packed.
- `LICENSE` is Apache-2.0 and must not be modified.

## Boundaries

### Always

- Run and paste the relevant command output.
- Add a regression test for a bug fix and behavior tests for new wiring.
- Preserve files, messages, and configuration outside the intended change. Do not rewrite user data as a side effect.
- Update `README.md`, the relevant `docs/` page, and `CHANGELOG.md` for user-visible changes.
- Update package contents and `npm run check:package` together when adding a publishable resource.
- Use conventional commits: `type(scope): subject`.

### Ask first

- Add any dependency, optional dependency, or install script.
- Change the command name, output contract, `customType`, or UI/headless behavior.
- Add resources, configuration, network access, tools, or persistent state.
- Change the Pi baseline, Node requirement, CI matrix, or release configuration.
- Enable publishing, remove `"private": true`, or add automatic tagging.

### Never

- Commit `node_modules`, tarballs, e2e artifacts, secrets, or generated logs.
- Edit `LICENSE`.
- Add a Pi host package to `dependencies`; it stays a peer dependency.
- Weaken cancellation, cleanup, environment isolation, or package allowlisting.
- Inherit provider credentials into an e2e Pi process or write tests against a real home directory.
- Tag or publish without explicit authorization.
- Claim test or platform coverage that the evidence does not show.

## Codebase state

- Registers DeepSeek search, fetch, read-full, and offline status. See [`src/AGENTS.md`](src/AGENTS.md) for wiring constraints and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for provider, profile, and retrieval behavior.
- There is no build, lint, or typecheck. CI runs the checks on Node 22 and 24 on Linux and installs the pinned Pi version from `scripts/quality.json` into a temporary prefix outside the checkout; that install needs network, while the checks themselves are offline.
- TypeScript is stripped, not typechecked. Avoid parameter properties, enums, and namespaces.
- The checkout is loaded with `-e`; the packed archive is extracted and loaded as a local directory through the Pi manifest in `package.json`. E2E does not exercise the `pi install` command or registry installation.
- Release publishing is disabled by `"private": true` and the `ENABLE_NPM_PUBLISH` repository variable; reviewed stable version increases on main trigger exact-commit verification, immutable stable `vX.Y.Z` tagging, and explicit Release dispatch. Unchanged versions skip automation. No auto-merge is configured; publication gates still apply. The release workflow runs source smoke, then packs the final `release/package.tgz`, re-runs e2e with `PACKAGE_ARCHIVE` pointed at it, and publishes those checked bytes. E2E and offline checks may create temporary packs; only the final release tarball is preserved and published.

## Scoped AGENTS.md

- [`src/AGENTS.md`](src/AGENTS.md) — source layout, API contract, and extension conventions.
- [`test/AGENTS.md`](test/AGENTS.md) — offline unit, wiring, and tooling test rules.
- [`e2e/AGENTS.md`](e2e/AGENTS.md) — real-Pi isolation, cleanup, and artifact rules.
