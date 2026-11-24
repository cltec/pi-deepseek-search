# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Security Advisories:

https://github.com/cltec/pi-deepseek-search/security/advisories/new

Do not open a public issue for a vulnerability.

Include:

- The affected version.
- Pi and Node.js versions, the operating system, and whether the extension was loaded from a checkout or a package.
- A minimal reproduction, if possible.
- Impact and any suggested fix.
- Relevant output with credentials, prompts, and private session content removed.

Do not send API keys, access tokens, or user data. Redact paths and environment values that identify a person or machine.

## Scope

Extensions run inside the Pi process with the same operating-system permissions as Pi. A malicious or compromised extension can read files, run commands, and observe prompts that Pi can observe. This extension reads `DEEPSEEK_API_KEY` from the environment and, on demand, sends queries or URLs and the key to fixed DeepSeek API endpoints. Loading makes no provider request and creates no configuration. Presence of `PI_OFFLINE` disables provider access. Optional replay can make an additional request for an evicted ref. Pi and its independently configured conversation model may receive tool output; consult their own privacy settings and the provider's terms.

Security-relevant areas include:

- Provider authentication, request validation, response handling, cancellation, and redaction of transport errors.
- Profile files, explicit global project opt-in and Pi project trust, session retrieval caches, replay, and file exports.
- The extension entry point, tools, and command handlers.
- Anything that expands the extension's file, process, network, or configuration access.
- Package contents, including accidental inclusion of agent instructions, tests, environment files, credentials, or development artifacts.
- Dependencies, if a fork adds any.
- Documentation that promises isolation, offline behavior, or data preservation the code does not provide.
- The e2e harness, which launches Pi, inspects and extracts tarballs with system `tar`, writes temporary Pi settings, and handles temporary homes. It does not exercise `pi install` or registry installation, so those paths need separate review if a fork relies on them.

Web content is untrusted and may contain prompt injection. Explicit exports persist and can contain sensitive page text; temporary exports are removed on session shutdown, subject to filesystem cleanup succeeding. No-clobber is the default. Model-initiated writes to explicit paths require an affirmative UI confirmation, with a 30-second timeout. Users can invoke the developer command directly to authorize their own explicit writes. Headless debug output is stored as custom entries, not model messages; these entries can still be retained in a Pi session. Review changes to tools, network access, configuration, or export behavior for trust and permission implications.

## What to expect

- Acknowledgment within 7 days.
- Triage and a remediation plan after validation.
- A GitHub Security Advisory and patched release when appropriate.
- Credit in the advisory unless you ask to remain anonymous.

## Safe harbor

Good-faith security research that follows this policy will not be pursued or reported as abuse. Do not access, modify, or exfiltrate data that is not yours. Stop testing and report promptly if you encounter third-party data or a service you do not own.

## Hardening notes

- Never commit credentials, sensitive queries, fetched pages, or exported files. Review any change to what is sent to the provider.
- Keep packaging as an allowlist. The agent-facing files under `AGENTS.md`, `docs/`, `test/`, and `e2e/` are development material and must not be packed.
- Run tests in temporary homes and working directories. Never point tests at a real `~/.pi` configuration. Tooling fixtures belong under `os.tmpdir()` and must be removed in `finally`.
- Do not inherit provider credentials into the e2e Pi process. Pass an explicit environment allowlist.
- The packed e2e path loads an extracted local directory through temporary Pi settings; it does not run `pi install`. Do not treat that as proof that the `pi install` command or registry resolution is safe.
- Treat extension output and external command output as untrusted. Do not interpolate untrusted text into a shell command; pass arguments to `spawn`.
- Review dependency additions, install scripts, and optional dependencies before merging.
