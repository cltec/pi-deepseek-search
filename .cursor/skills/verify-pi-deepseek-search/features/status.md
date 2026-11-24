# Check extension status

`/deepseek-search-status` confirms that Pi loaded the extension and registered its product tools without making a model turn. The exact response is `DeepSeek Search loaded. Tools: deepseek_web_search, deepseek_web_fetch, deepseek_web_read_full.`

## Sub-features

- `status-checkout` shows an info notification when loaded directly from the checkout in RPC.
- `status-json` emits a visible custom message and exits successfully in headless JSON.
- `status-packed` discovers and runs the same command from the package manifest in RPC.

## How to get to it (user POV)

- Load the checkout with `pi -e ./src/index.ts` and enter `/deepseek-search-status`. UI modes show a notification; the harness covers the RPC notification, not TUI rendering.
- Run `pi --mode json -p -e ./src/index.ts /deepseek-search-status` for the headless JSON entry point.
- Load an extracted package directory through Pi's `settings.json` `packages` list and enter `/deepseek-search-status`.

## Driving it with the real-Pi smoke harness

Preconditions: [Launch and Doctor](../SKILL.md) pass. Use the harness, which adds isolation flags and temporary configuration; do not run the user commands against the real profile.

- **Checkout RPC (`checkout`).** Run `npm run test:e2e` with the skill's [Drive](../SKILL.md#drive) environment. The harness uses `get_commands` to find the extension command with `top-level` origin, sends `{"type":"prompt","message":"/deepseek-search-status"}`, and requires `handled`, one info notification containing the status text, and an idle state with no messages.
- **Headless JSON (`headless-json`).** In that same run, the harness passes `/deepseek-search-status` as the argument to Pi in JSON print mode. Require exit code `0`, exactly one visible `deepseek-search-status` custom message with the status text, and no agent events.
- **Packed RPC (`packed-archive`).** In that same run, the harness packs and validates the archive, extracts it, and points a disposable `settings.json` at it. `get_commands` must report `package` origin; invoking the command must produce the same notification and idle, empty transcript as checkout RPC.
- **Proof.** Each of those three records must pass, list `deepseek-search-status` under `commands`, and report clean teardown. Retain the artifact after cleanup.

## Gotchas

- The runtime-generated tool list proves registration, not execution. Verify search, fetch, and read-full behavior with offline `node:test` fixture pipeline tests; do not add provider keys, mocks, or live calls to e2e.
- A successful `pi --version` only qualifies the binary; it does not verify command discovery or handling.
- The packed journey tests a local extracted package, not `pi install` or registry resolution.
- A follow-up model response or a transcript message in RPC is unexpected, even if the status notification was correct.
- Do not add a key or send a normal prompt to work around a failure. Report the failing check and its category instead.
