<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->

# AGENTS.md — src

## Wiring contract

`src/index.ts` delegates Pi registration to `src/wiring.ts`. See [`../README.md`](../README.md) for tool and debug command behavior. `/deepseek-search-status` ignores arguments and reports `DeepSeek Search loaded. Tools: deepseek_web_search, deepseek_web_fetch, deepseek_web_read_full.` when all tools are registered in Pi.

- TUI and RPC (`ctx.hasUI`): `ctx.ui.notify(text, "info")`.
- Print and JSON: `pi.sendMessage({ customType: "deepseek-search-status", content: text, display: true }, { triggerTurn: false })`.

Do not start a model turn or write to stdout. Update the wiring tests and real-Pi smoke assertions together if this contract changes.

## Conventions

- Keep the factory thin and free of top-level side effects. Provider I/O belongs in `provider.ts`; `web.ts` coordinates profile, formatting, and retrieval.
- Unit tests import `wiring.ts` with a fake Pi API. Keep runtime host imports in `index.ts`; Pi supplies them at runtime.
- Use strip-compatible TypeScript; avoid parameter properties, enums, and namespaces.
- Before adding I/O, define cancellation and cleanup, including on error and shutdown. Keep secrets and query content out of diagnostics.
