---
name: verify-pi-deepseek-search
description: Verify the Pi DeepSeek Search CLI extension after a behavior or packaging change, for regression checks, or for explicitly approved live Search and Fetch checks.
---

# Verify Pi DeepSeek Search

Select the affected journeys in the [feature map](features/README.md). Use their targeted fixture commands while iterating, then run the offline fixture/package gate and isolated real-Pi smoke gate. The smoke gate proves loading and registration; the fixtures prove tool behavior, not live compatibility. Choose the optional provider probe only for the coverage it adds.

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

The temporary Pi bootstrap (if needed) uses the npm registry; the offline gates do not. The smoke harness starts Pi on demand without development commands. RPC is ready only when `get_commands` returns the expected `deepseek-search-status` registration and origin. Headless JSON is a one-shot invocation: it must receive the expected message and exit successfully. The harness owns process shutdown.

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

### Fixture and package gate

Run the full local gate after the targeted fixtures in the selected journey. Require a zero exit and the package allowlist count; live service availability never decides this gate.

```bash
env -i PATH="$PATH" HOME="$run_root/home" TMPDIR="$run_root/scratch" \
  npm_config_cache="$run_root/npm-cache" npm_config_offline=true \
  npm_config_update_notifier=false npm run check
```

### Real-Pi smoke gate

Run all three [status entry points](features/status.md) without user profiles or credentials. Use the fresh pack here; the isolated parent environment drops `PI_VERSION` and `PACKAGE_ARCHIVE`.

```bash
smoke=(env -i PATH="$PATH" HOME="$run_root/home" TMPDIR="$run_root/scratch"
  npm_config_cache="$run_root/npm-cache" npm_config_offline=true npm_config_update_notifier=false
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

### Provider probe

After a provider or debug-command change, verify [offline suppression in real Pi](features/search-fetch.md#driving-it-with-offline-fixtures-and-the-provider-probe). `--offline` requires no credential and proves the commands are handled and refuse network access. `--live` is a separate manual check: ask for explicit authorization for each fresh run, with a budget of at most one Search and one Fetch request. No model turn or replay is needed. Follow the feature's live preconditions before invoking it.

```bash
# Offline suppression:
env -i PATH="$PATH" HOME="$run_root/home" PI_BIN="$PI_BIN" TMPDIR="$run_root/scratch" \
  scripts/probe-deepseek.mjs --offline | tee "$evidence_dir/provider-offline.json"
# Only when a fresh live run is authorized and DEEPSEEK_API_KEY is exported:
PI_BIN="$PI_BIN" TMPDIR="$run_root/scratch" scripts/probe-deepseek.mjs --live \
  | tee "$evidence_dir/provider-live.json"
```

## Evidence

```bash
test -s "$E2E_RESULT_PATH"
env -u GITHUB_STEP_SUMMARY node scripts/summarize-e2e.mjs
```

For smoke, require `outcome: "pass"`, `cleanup: "clean"`, and all three entry-point checks passing with `deepseek-search-status` in `commands`; the [status journey](features/status.md) specifies the observations. For provider probes, require the requested `mode`, `outcome: "pass"`, `cleanup: "clean"`, and the checks listed in the [search/fetch journey](features/search-fetch.md). Retain only the sanitized JSON in `artifacts/` (ignored by Git); never save raw protocol, traces, prompts, fetched text, refs, or credentials. Report the gate, commands, coverage, and artifact path; for a failure report its scenario and category instead of substituting a passing entry point. Distinguish a live run not authorized or not attempted from a passing offline gate.

## Cleanup

The harness closes, terminates if needed, and reaps only the Pi processes it started. It removes each scenario's home, working directory, and package files in teardown. After the drive returns, check for residual scenario roots, remove the disposable setup, and confirm the evidence survived:

```bash
test -z "$(find "$run_root/scratch" -maxdepth 1 -name 'pi-e2e-*' -print -quit)"
rm -rf -- "$run_root"
trap - EXIT
test ! -e "$run_root"
test -s "$E2E_RESULT_PATH"
for artifact in "$evidence_dir"/provider-*.json; do
  [[ ! -e $artifact ]] || test -s "$artifact"
done
printf 'Cleanup complete; evidence retained: %s\n' "$evidence_dir"
```

After a failed step, exit the disposable shell so its `EXIT` trap removes setup scratch. A harness cleanup failure is a failed verification; diagnose it before retrying. Never kill processes by name or remove another run's scratch or evidence.

## Helpers

Use `npm run check` for fixtures and package, `npm run test:e2e` and `node scripts/summarize-e2e.mjs` for smoke, and `scripts/probe-deepseek.mjs --offline|--live` for the separate provider probe, as invoked above. Keep the journeys current with `/maintain-verification-skill`.
