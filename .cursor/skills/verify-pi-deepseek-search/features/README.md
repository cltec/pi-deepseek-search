# Pi DeepSeek Search verification map

Use this map to select the user journey. Read the [verification skill](../SKILL.md) for launch, doctor, drive, and cleanup commands.

## Preconditions and driving conventions

- Use the pinned Pi binary and a fresh isolated run. Do not connect to an existing Pi instance.
- Run the targeted fixtures for each changed behavior, then the full offline gate. For smoke, check every named entry point independently before claiming coverage.
- On new behavior, add an offline regression or acceptance assertion at the public boundary, then add the entry point, command, observable outcome, and any coverage limit to its journey below. Use the separate live probe only when explicitly authorized.
- Report the invoked command, pass/failure category, and any sanitized artifact path. A fixture result is not live-provider proof.

## Features

- [Check extension status](status.md) — verifies product tool registration from the checkout in RPC and headless JSON and from the extracted package in RPC.
- [Search and fetch a source](search-fetch.md) — offline fixture tests; real-Pi offline suppression; optional live provider probe.
- [Read or export a fetched page](read-full.md) — cached paging, Unicode, export safety, lifecycle, and opt-in replay.
- [Apply profiles](profiles.md) — defaults, precedence, project trust, and tool output budgets.

Automated gates do not cover live APIs or model answers, interactive TUI rendering, `pi install`, or registry installation.
