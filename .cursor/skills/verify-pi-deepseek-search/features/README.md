# Pi DeepSeek Search verification map

Use this map to select the user journey. Read the [verification skill](../SKILL.md) for launch, doctor, drive, and cleanup commands.

## Preconditions and driving conventions

- Use the pinned Pi binary and a fresh isolated run. Do not connect to an existing Pi instance.
- Run the real-Pi smoke harness once for all mapped entry points. Check each named record independently; a pass through one path does not cover a failure or skip in another.
- Report the invoked command and its result or failure category alongside the path to the sanitized artifact. Keep raw protocol and traces out of the artifact.

## Features

- [Check extension status](status.md) — verifies product tool registration from the checkout in RPC and headless JSON and from the extracted package in RPC.

Tool execution is covered separately by offline `node:test` fixture pipeline tests. Interactive TUI rendering, `pi install`, registry installation, and live DeepSeek requests are not covered.
