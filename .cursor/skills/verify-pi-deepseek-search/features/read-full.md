# Read or export a fetched page

Session refs let users read more content or export a fetch field after the first preview, without a second request when cached.

## Sub-features

- Page by `nextOffset` without splitting a Unicode character; search refs use original one-based result indices.
- Create a temporary fetch export removed on shutdown, or keep a user-authorized explicit export with no-clobber as the default.
- Expire refs on reset. Replay of evicted content is global opt-in and can make a billable request.

## How to get to it (user POV)

Use a search or fetch result's ref with `deepseek_web_read_full`, or use `/deepseek-read-full` with JSON when developer mode is enabled. Explicit model-initiated file exports require UI confirmation.

## Driving it with offline fixtures and the provider probe

- Run `node --test test/extension.test.ts test/retrieval.test.ts`. Require the fetched preview and cached pages to reconstruct the Markdown, with no extra provider calls. Verify the file contents, no-clobber and approval outcomes, expiry of old refs, and temporary file removal. Replay regression fixtures cover eviction, cancellation, deduplication and URL-occurrence matching.
- For authorized live compatibility only, the [provider probe](search-fetch.md#driving-it-with-offline-fixtures-and-the-provider-probe) compares a read from the fetched ref with the page still in the same RPC session. It does not request exports or exercise replay.

## Gotchas

- Return `nextOffset` unchanged as `offset`; offsets are UTF-16 indices while `maxChars` counts code points.
- Use the same session for fetch and read. A ref from another Pi process is not a valid test input.
- Run export scenarios against test fixtures. The real-Pi smoke does not prove TUI confirmation rendering.
