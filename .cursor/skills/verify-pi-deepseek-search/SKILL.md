---
name: verify-pi-deepseek-search
description: Verify Pi DeepSeek Search in real Pi after changing tool registration, the status command, checkout loading, headless JSON output, or packaged extension loading, or when collecting proof of those paths.
---

# Verify Pi DeepSeek Search

Use the repo's real-Pi smoke harness, not a live Pi session or a mocked `ExtensionAPI`. Read the [feature map](features/README.md) and the matching journey before running it. The status command verifies product tool registration, not tool execution; use offline `node:test` fixture pipeline tests for execution behavior.

## Launch

Run the blocks in order in one disposable Bash shell from the repository root. Use Linux, Node.js 22.18+, npm, and GNU-compatible `tar`. No build, provider key, port, seed data, or shared Pi session is needed. A run can coexist with another run: its Pi state and evidence paths are unique.

```bash
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
cd "$repo"
baseline=$(node -p 'require("./scripts/quality.json").piVersion')
run_root=$(mktemp -d /tmp/pi-deepseek-verify.XXXXXXXX)
trap 'rm -rf -- "$run_root"' EXIT
mkdir -p "$run_root/home" "$run_root/scratch" "$repo/artifacts"
evidence_dir=$(mktemp -d "$repo/artifacts/verify-pi-deepseek-search.XXXXXXXX")
export E2E_RESULT_PATH="$evidence_dir/e2e-result.json"
printf 'Evidence: %s\n' "$E2E_RESULT_PATH"
# If PI_BIN is already set, Doctor checks that it is an absolute path to the pin.
if [[ -z ${PI_BIN:-} ]]; then
  (cd "$run_root" && env -i PATH="$PATH" HOME="$run_root/home" TMPDIR="$run_root/scratch" \
    npm_config_cache="$run_root/npm-cache" npm install --prefix "$run_root/pi" \
    --ignore-scripts --no-audit --no-fund "@earendil-works/pi-coding-agent@$baseline")
  PI_BIN="$run_root/pi/node_modules/.bin/pi"
fi
```

The temporary Pi bootstrap (if needed) uses the npm registry; the drive does not. The drive starts Pi on demand in the normal environment without development commands. RPC is ready only when `get_commands` returns the expected `deepseek-search-status` registration and origin. Headless JSON is a one-shot invocation: it must receive the expected message and exit successfully. The harness owns process shutdown.

## Doctor

Re-run this first if the drive looks wrong. This checks the selected binary and version in isolation without touching a real Pi profile or invoking a model. Stop on failure; do not override the version pin or use the user's open Pi session.

```bash
test "${PI_BIN:0:1}" = / && test -x "$PI_BIN"
actual=$(cd "$run_root/scratch" && env -i PATH="$PATH" HOME="$run_root/home" \
  PI_CODING_AGENT_DIR="$run_root/home/.pi/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 \
  PI_TELEMETRY=0 timeout 10s "$PI_BIN" --version)
if [[ $actual != "$baseline" ]]; then
  printf 'Doctor: expected Pi %s, got %s\n' "$baseline" "$actual" >&2
  exit 1
fi
printf 'Doctor: pinned Pi %s available\n' "$actual"
```

## Drive

Run the whole mapped feature with `npm run test:e2e`. The harness drives checkout RPC, headless JSON, and packed archive RPC without user profiles or credentials. Use the fresh pack here; the isolated parent environment intentionally drops `PI_VERSION` and `PACKAGE_ARCHIVE`.

```bash
smoke=(env -i PATH="$PATH" HOME="$run_root/home" TMPDIR="$run_root/scratch"
  npm_config_cache="$run_root/npm-cache" npm_config_offline=true
  PI_BIN="$PI_BIN" E2E_RESULT_PATH="$E2E_RESULT_PATH" npm run test:e2e)
"${smoke[@]}"
```

When proving that the run is offline, run this **instead of** `"${smoke[@]}"` on a Linux host with `strace` and permission to trace child processes. The temporary trace must not be attached as evidence. If tracing is unavailable, report that external network activity was not independently observed.

```bash
strace -f -qq -e trace=connect,sendto,sendmsg,sendmmsg -o "$run_root/network.trace" "${smoke[@]}"
test -r "$run_root/network.trace"
if grep -Eq 'sa_family=AF_INET6?[,}]' "$run_root/network.trace"; then
  printf '%s\n' 'Drive attempted an IPv4/IPv6 connection or send; offline proof failed.' >&2
  exit 1
fi
printf '%s\n' 'No IPv4/IPv6 connect or send observed during the drive.'
```

## Evidence

```bash
test -s "$E2E_RESULT_PATH"
env -u GITHUB_STEP_SUMMARY node scripts/summarize-e2e.mjs
```

Keep only the sanitized schema-1 JSON named by Launch (ignored by Git). Require a successful drive, `outcome: "pass"`, `cleanup: "clean"`, and all three named journey checks passing with `deepseek-search-status` in `commands`. Cite the evidence path, the entry points exercised, and the observable assertions from the feature map. The RPC checks require an idle agent and empty transcript after the notification; JSON requires no agent events and exactly one visible custom message. A version check, command listing, or unit test alone does not prove the action. On failure, report the scenario and category from the artifact, if produced; never save raw protocol output or substitute a passing entry point for a failing one.

## Cleanup

The harness closes, terminates if needed, and reaps only the Pi processes it started. It removes each scenario's home, working directory, and package files in teardown. After the drive returns, check for residual scenario roots, remove the disposable setup, and confirm the evidence survived:

```bash
test -z "$(find "$run_root/scratch" -maxdepth 1 -name 'pi-e2e-*' -print -quit)"
rm -rf -- "$run_root"
trap - EXIT
test ! -e "$run_root"
test -s "$E2E_RESULT_PATH"
printf 'Cleanup complete; evidence retained: %s\n' "$E2E_RESULT_PATH"
```

After a failed step, exit the disposable shell so its `EXIT` trap removes setup scratch. A harness cleanup failure is a failed verification; diagnose it before retrying. Never kill processes by name or remove another run's scratch or evidence.

## Helpers

No skill-local executable. Use `npm run test:e2e` to drive Pi and `node scripts/summarize-e2e.mjs` to render the sanitized result as shown above.
