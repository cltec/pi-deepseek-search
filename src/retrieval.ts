import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, lstat, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type PageSnapshot =
  | { kind: 'search'; results: Array<{ title: string; url: string; content: string }> }
  | { kind: 'fetch'; title: string; content: string };
export type ReadRequest = { ref: string; section?: string; resultIndex?: number; offset?: number; maxChars?: number; mode?: 'inline' | 'file'; path?: string; overwrite?: boolean };
export type ReadResult =
  | { mode: 'inline'; text: string; totalChars: number; offset: number; nextOffset: number | null; servedFrom: 'cache' | 'replay' }
  | { mode: 'file'; path: string; temporary: boolean; servedFrom: 'cache' | 'replay' };

type Stored = { kind: 'fetch'; title: string; content: string } | { kind: 'search'; results: Array<{ title: string; url: string; content: string } | null> };
type Flight = { controller: AbortController; promise: Promise<Stored>; waiters: number };
type Entry = { kind: PageSnapshot['kind']; identities?: string[]; metadata: number; payload?: Stored; bytes: number; replay?: (signal: AbortSignal) => Promise<PageSnapshot>; attempted: boolean; flight?: Flight };
const aborted = () => new DOMException('The operation was aborted.', 'AbortError');

export function createRetrieval(limits: { maxBytes?: number; maxRecords?: number } = {}) {
  // Payloads default to 32 MiB; metadata totals at most 4 MiB (1 MiB per record).
  // At most 64 reads, 32 temporary exports and 64 MiB of temporary export data.
  const maxBytes = limits.maxBytes ?? 32 * 1024 * 1024;
  const maxRecords = limits.maxRecords ?? 256;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('Invalid retrieval limits.');
  const records = new Map<string, Entry>();
  const payloads = new Map<string, Entry>();
  const controllers = new Set<AbortController>();
  // Count even detached providers until they actually settle, including those ignoring abort.
  const flights = new Set<Flight>();
  const pending = new Set<Promise<unknown>>();
  const temporary = new Map<string, number>();
  const staging = new Map<string, number>();
  let bytes = 0, metadataBytes = 0, tempBytes = 0, tempCount = 0, stageBytes = 0, stageCount = 0;
  let closed = false;
  let closing: Promise<void> | undefined;

  function evict(entry: Entry, ref: string) {
    bytes -= entry.bytes; entry.bytes = 0; entry.payload = undefined; payloads.delete(ref);
  }
  function remove(ref: string, entry: Entry) {
    evict(entry, ref); metadataBytes -= entry.metadata; records.delete(ref); entry.flight?.controller.abort();
  }
  function cache(ref: string, entry: Entry, snapshot: Stored) {
    if (entry.payload) evict(entry, ref);
    const size = Buffer.byteLength(JSON.stringify(snapshot));
    if (size > maxBytes) return;
    entry.payload = snapshot; entry.bytes = size; bytes += size; payloads.set(ref, entry);
    while (bytes > maxBytes) {
      const [key, oldest] = payloads.entries().next().value!;
      evict(oldest, key);
    }
  }
  function remember(snapshot: PageSnapshot, replay?: (signal: AbortSignal) => Promise<PageSnapshot>): string {
    if (closed) throw new Error('Retrieval is closed.');
    const copy = structuredClone(snapshot);
    const identities = copy.kind === 'search' ? copy.results.map(result => result.url) : undefined;
    const metadata = identities ? Buffer.byteLength(JSON.stringify(identities)) : 0;
    if (metadata > 1024 * 1024) throw new Error('Search metadata is too large.');
    while (records.size >= maxRecords || metadataBytes + metadata > 4 * 1024 * 1024) {
      const [key, oldest] = records.entries().next().value!; remove(key, oldest);
    }
    const ref = `${copy.kind}:${randomBytes(16).toString('hex')}`;
    const entry: Entry = { kind: copy.kind, identities, metadata, bytes: 0, replay, attempted: false };
    records.set(ref, entry); metadataBytes += metadata; cache(ref, entry, copy);
    return ref;
  }
  function startReplay(ref: string, entry: Entry): Flight {
    if (!entry.replay || entry.attempted) throw new Error('Retrieval payload is unavailable.');
    if (flights.size >= 64) throw new Error('Retrieval concurrency limit exceeded.');
    entry.attempted = true;
    const controller = new AbortController();
    const flight: Flight = { controller, waiters: 0, promise: undefined as unknown as Promise<Stored> };
    entry.flight = flight;
    flights.add(flight);
    flight.promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted || closed || records.get(ref) !== entry) throw aborted();
      const response = await entry.replay!(controller.signal);
      if (controller.signal.aborted || closed || records.get(ref) !== entry) throw aborted();
      const copy = structuredClone(response);
      if (copy.kind !== entry.kind) throw new Error('Invalid replay.');
      let mapped: Stored = copy;
      if (copy.kind === 'search') {
        const groups = new Map<string, typeof copy.results>();
        for (const item of copy.results) {
          const group = groups.get(item.url) ?? []; group.push(item); groups.set(item.url, group);
        }
        const counts = new Map<string, number>();
        mapped = { kind: 'search', results: entry.identities!.map(url => {
          const index = counts.get(url) ?? 0; counts.set(url, index + 1);
          return groups.get(url)?.[index] ?? null;
        }) };
      }
      cache(ref, entry, mapped);
      return mapped;
    }).catch(error => {
      if (controller.signal.aborted || closed) throw aborted();
      throw new Error('Retrieval replay failed.');
    }).finally(() => { flights.delete(flight); if (entry.flight === flight) entry.flight = undefined; });
    // A cancelled last waiter may detach from a replay which ignores its signal.
    void flight.promise.catch(() => {});
    return flight;
  }
  async function replay(ref: string, entry: Entry, signal: AbortSignal): Promise<Stored> {
    if (signal.aborted || closed) throw aborted();
    const flight = entry.flight ?? startReplay(ref, entry);
    flight.waiters++;
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      if (--flight.waiters === 0 && entry.flight === flight) flight.controller.abort();
    };
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => { detach(); reject(aborted()); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([flight.promise, cancelled]); }
    finally { signal.removeEventListener('abort', onAbort); detach(); }
  }
  async function cleanup(path: string, recursive = false): Promise<boolean> {
    try { await rm(path, { recursive, force: true }); return true; } catch { return false; }
  }
  async function perform(request: ReadRequest, options: { cwd: string; signal?: AbortSignal }, controller: AbortController): Promise<ReadResult> {
    const signal = controller.signal;
    const check = () => { if (signal.aborted || closed) throw aborted(); };
    check();
    const entry = records.get(request.ref);
    if (!entry) throw new Error('Retrieval reference not found.');
    const section = request.section ?? 'content';
    if (!(entry.kind === 'search' ? ['title', 'url', 'content'] : ['title', 'content']).includes(section)) throw new Error('Unsupported section.');
    if (entry.kind === 'search') {
      if (!Number.isSafeInteger(request.resultIndex) || request.resultIndex! < 1 || request.resultIndex! > entry.identities!.length) throw new Error('Invalid resultIndex.');
    } else if (request.resultIndex !== undefined) throw new Error('resultIndex is not supported for fetch.');
    if (request.mode !== undefined && request.mode !== 'inline' && request.mode !== 'file') throw new Error('Invalid mode.');
    if (request.mode === 'file' && entry.kind !== 'fetch') throw new Error('File export requires a fetch reference.');
    if (request.mode !== 'file' && (request.path !== undefined || request.overwrite !== undefined)) throw new Error('File options require file mode.');
    if (request.overwrite !== undefined && (typeof request.overwrite !== 'boolean' || request.path === undefined)) throw new Error('Overwrite requires an explicit export path and a boolean value.');
    if (request.mode === 'file' && (request.offset !== undefined || request.maxChars !== undefined)) throw new Error('Pagination is only supported for inline reads.');
    const offset = request.offset ?? 0, maxChars = request.maxChars ?? 8000;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 50000) throw new Error('Invalid pagination.');
    let explicit: string | undefined;
    if (request.path !== undefined) {
      if (typeof request.path !== 'string' || request.path.length > 4096) throw new Error('Invalid export path.');
      const path = request.path.startsWith('@') ? request.path.slice(1) : request.path;
      if (!path.trim() || path.includes('\0')) throw new Error('Invalid export path.');
      explicit = resolve(options.cwd, path);
      try {
        const parent = dirname(explicit);
        if (!(await stat(parent)).isDirectory()) throw new Error();
        await access(parent, constants.W_OK | constants.X_OK);
        const existing = await lstat(explicit).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (existing && (!request.overwrite || (!existing.isFile() && !existing.isSymbolicLink()))) throw new Error();
      } catch {
        check();
        throw new Error('File export destination is unavailable.');
      }
      check();
      if (records.get(request.ref) !== entry) throw new Error('Retrieval reference not found.');
    }
    let servedFrom: 'cache' | 'replay' = 'cache';
    let text: string;
    if (entry.kind === 'search' && section === 'url') text = entry.identities![request.resultIndex! - 1];
    else {
      let snapshot = entry.payload;
      if (snapshot) { payloads.delete(request.ref); payloads.set(request.ref, entry); }
      else { servedFrom = 'replay'; snapshot = await replay(request.ref, entry, signal); check(); }
      if (snapshot.kind === 'search') {
        const item = snapshot.results[request.resultIndex! - 1];
        if (!item) throw new Error('Search result is unavailable.');
        text = item[section as 'title' | 'url' | 'content'];
      } else text = snapshot[section as 'title' | 'content'];
    }
    if (typeof text !== 'string') throw new Error('Retrieval payload is invalid.');
    check();
    if (request.mode !== 'file') {
      const char = text.charCodeAt(offset), previous = text.charCodeAt(offset - 1);
      if (char >= 0xdc00 && char <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) throw new Error('Offset falls inside a Unicode character.');
      // Offsets are UTF-16 indices; maxChars counts Unicode code points.
      let end = offset;
      for (let count = 0; count < maxChars && end < text.length; count++) end += text.codePointAt(end)! > 0xffff ? 2 : 1;
      return { mode: 'inline', text: text.slice(offset, end), totalChars: text.length, offset, nextOffset: end < text.length ? end : null, servedFrom };
    }
    const isTemporary = explicit === undefined;
    const size = Buffer.byteLength(text);
    if ((isTemporary && (tempCount >= 32 || tempBytes + size > 64 * 1024 * 1024)) || stageCount >= 32 || stageBytes + size > 64 * 1024 * 1024) throw new Error('Temporary export limit exceeded.');
    if (isTemporary) { tempCount++; tempBytes += size; }
    stageCount++; stageBytes += size;
    let directory: string | undefined, stage: string | undefined, published = false;
    try {
      if (isTemporary) { directory = await mkdtemp(join(tmpdir(), 'retrieval-')); temporary.set(directory, size); }
      check();
      const destination = explicit ?? join(directory!, 'content.txt');
      // A private directory in the destination filesystem owns the staging file.
      stage = await mkdtemp(join(dirname(destination), '.retrieval-')); staging.set(stage, size);
      const source = join(stage, 'content');
      await writeFile(source, text, { encoding: 'utf8', flag: 'wx', mode: 0o600, signal });
      check();
      if (request.overwrite === true && !isTemporary) await rename(source, destination);
      else await link(source, destination);
      published = true;
      // Publication is the commit point: cancellation afterwards cannot undo it.
      return { mode: 'file', path: destination, temporary: isTemporary, servedFrom };
    } catch {
      if (signal.aborted || closed) throw aborted();
      throw new Error('File export failed.');
    } finally {
      if (!stage || await cleanup(stage, true)) {
        if (stage) staging.delete(stage);
        stageCount--; stageBytes -= size;
      }
      if (isTemporary && !published) {
        if (!directory || await cleanup(directory, true)) {
          if (directory) temporary.delete(directory);
          tempCount--; tempBytes -= size;
        }
      }
    }
  }
  function read(request: ReadRequest, options: { cwd: string; signal?: AbortSignal }): Promise<ReadResult> {
    if (pending.size >= 64) return Promise.reject(new Error('Retrieval concurrency limit exceeded.'));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (closed || options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    controllers.add(controller);
    const operation = perform(request, options, controller).finally(() => {
      options.signal?.removeEventListener('abort', cancel); controllers.delete(controller); pending.delete(operation);
    });
    pending.add(operation); return operation;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    for (const controller of controllers) controller.abort();
    for (const flight of flights) flight.controller.abort();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      records.clear(); payloads.clear(); bytes = 0; metadataBytes = 0;
      for (const [path, size] of temporary) if (await cleanup(path, true)) { temporary.delete(path); tempCount--; tempBytes -= size; }
      for (const [path, size] of staging) if (await cleanup(path, true)) { staging.delete(path); stageCount--; stageBytes -= size; }
      if (temporary.size || staging.size) throw new Error('Temporary export cleanup failed.');
    })().catch(error => { closing = undefined; throw error; });
    return closing;
  }
  return { remember, read, close };
}
