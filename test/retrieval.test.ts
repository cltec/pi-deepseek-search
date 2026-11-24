import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetrieval } from '../src/retrieval.ts';

const cwd = tmpdir();
const page = { kind: 'fetch' as const, title: 'A title', content: '# Heading\n\n**Markdown**\n' };
const results = { kind: 'search' as const, results: [
  { title: 'First', url: 'https://example.test/a', content: 'first body' },
  { title: 'Second', url: 'https://example.test/b', content: 'second body' },
  { title: 'Third', url: 'https://example.test/a', content: 'third body' },
] };

test('refs are distinct and kind-prefixed; inline pagination preserves Markdown', async () => {
  const store = createRetrieval();
  try {
    const ref = store.remember(page);
    assert.match(ref, /^fetch:/);
    assert.notEqual(ref, store.remember(page));
    assert.match(store.remember(results), /^search:/);
    assert.deepEqual(await store.read({ ref, section: 'content', offset: 2, maxChars: 7 }, { cwd }), {
      mode: 'inline', text: page.content.slice(2, 9), totalChars: page.content.length,
      offset: 2, nextOffset: 9, servedFrom: 'cache',
    });
    const end = await store.read({ ref, section: 'content', offset: 9 }, { cwd });
    assert.equal(end.mode, 'inline');
    if (end.mode === 'inline') {
      assert.equal(end.text, page.content.slice(9));
      assert.equal(end.nextOffset, null);
    }
    const long = store.remember({ kind: 'fetch', title: '', content: 'x'.repeat(60000) });
    const first = await store.read({ ref: long, section: 'content' }, { cwd });
    assert.equal(first.mode, 'inline');
    if (first.mode === 'inline') assert.equal(first.text.length, 8000);
    const capped = await store.read({ ref: long, section: 'content', maxChars: 50000 }, { cwd });
    assert.equal(capped.mode, 'inline');
    if (capped.mode === 'inline') assert.equal(capped.text.length, 50000);
  } finally { await store.close(); }
});

test('search uses original one-based slots and validates sections and pagination', async () => {
  const store = createRetrieval();
  try {
    const ref = store.remember(results);
    for (const section of ['title', 'url', 'content'] as const) {
      const value = await store.read({ ref, resultIndex: 2, section }, { cwd });
      assert.equal(value.mode, 'inline');
      if (value.mode === 'inline') assert.equal(value.text, results.results[1][section]);
    }
    for (const request of [
      { ref, resultIndex: 0, section: 'content' },
      { ref, resultIndex: 4, section: 'content' },
      { ref, resultIndex: 1.5, section: 'content' },
      { ref, resultIndex: 1, section: 'links' },
      { ref, resultIndex: 1, section: 'content', offset: -1 },
      { ref, resultIndex: 1, section: 'content', maxChars: 0 },
      { ref, resultIndex: 1, section: 'content', maxChars: 50001 },
    ]) await assert.rejects(store.read(request, { cwd }));
    const fetch = store.remember(page);
    await assert.rejects(store.read({ ref: fetch, section: 'url' }, { cwd }));
    await assert.rejects(store.read({ ref, section: 'content', resultIndex: 1, mode: 'file' }, { cwd }));
  } finally { await store.close(); }
});

test('evicted search payload remaps original URL occurrences rather than rank', async () => {
  const store = createRetrieval({ maxBytes: 1, maxRecords: 20 });
  try {
    let calls = 0;
    const ref = store.remember(results, async () => {
      calls++;
      return { kind: 'search', results: [
        { title: 'B new', url: 'https://example.test/b', content: 'b replay' },
        { title: 'A first', url: 'https://example.test/a', content: 'a first replay' },
        { title: 'A second', url: 'https://example.test/a', content: 'a second replay' },
      ] };
    });
    const value = await store.read({ ref, resultIndex: 3, section: 'content' }, { cwd });
    assert.equal(value.mode, 'inline');
    if (value.mode === 'inline') {
      assert.equal(value.text, 'a second replay');
      assert.equal(value.servedFrom, 'replay');
    }
    assert.equal(calls, 1);
    const missing = store.remember(results, async () => ({ kind: 'search', results: [results.results[1]] }));
    await assert.rejects(store.read({ ref: missing, resultIndex: 1, section: 'content' }, { cwd }));
    const absent = store.remember(page);
    await assert.rejects(store.read({ ref: absent, section: 'content' }, { cwd }));
  } finally { await store.close(); }
});

test('record retention is bounded and replay errors do not leak provider text', async () => {
  const store = createRetrieval({ maxBytes: 1, maxRecords: 2 });
  try {
    const old = store.remember(page, async () => page);
    store.remember(page);
    store.remember(page);
    await assert.rejects(store.read({ ref: old, section: 'content' }, { cwd }));
    const ref = store.remember(page, async () => { throw new Error('secret-provider-input'); });
    await assert.rejects(store.read({ ref, section: 'content' }, { cwd }), (error: Error) => {
      assert.doesNotMatch(error.message, /secret-provider-input/);
      return true;
    });
    await assert.rejects(store.read({ ref: 'secret-ref-input', section: 'content' }, { cwd }), (error: Error) => {
      assert.doesNotMatch(error.message, /secret-ref-input/);
      return true;
    });
  } finally { await store.close(); }
});

test('file export cleans temporary files and protects explicit paths and symlink targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retrieval-test-'));
  const store = createRetrieval();
  try {
    const ref = store.remember(page);
    const temp = await store.read({ ref, section: 'content', mode: 'file' }, { cwd: dir });
    assert.equal(temp.mode, 'file');
    if (temp.mode !== 'file') throw new Error('expected file');
    assert.equal(temp.temporary, true);
    assert.equal(await readFile(temp.path, 'utf8'), page.content);
    const destination = join(dir, 'out.md');
    await writeFile(destination, 'original');
    await assert.rejects(store.read({ ref, section: 'content', mode: 'file', path: 'out.md' }, { cwd: dir }));
    assert.equal(await readFile(destination, 'utf8'), 'original');
    const exported = await store.read({ ref, section: 'content', mode: 'file', path: 'out.md', overwrite: true }, { cwd: dir });
    assert.equal(exported.mode, 'file');
    if (exported.mode === 'file') {
      assert.equal(exported.path, destination);
      assert.equal(exported.temporary, false);
    }
    assert.equal(await readFile(destination, 'utf8'), page.content);
    const target = join(dir, 'target');
    await writeFile(target, 'untouched');
    await symlink(target, join(dir, 'link'));
    try { await store.read({ ref, section: 'content', mode: 'file', path: 'link', overwrite: true }, { cwd: dir }); } catch { /* rejection is also safe */ }
    assert.equal(await readFile(target, 'utf8'), 'untouched');
    await store.close();
    await assert.rejects(readFile(temp.path));
    assert.equal(await readFile(destination, 'utf8'), page.content);
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('abort prevents export and close rejects late replay results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retrieval-abort-'));
  const store = createRetrieval({ maxBytes: 1, maxRecords: 10 });
  try {
    let resolveReplay!: (value: typeof page) => void;
    let replaySignal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const ref = store.remember(page, async signal => {
      replaySignal = signal;
      started();
      return new Promise(resolve => { resolveReplay = resolve; });
    });
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(store.read({ ref, section: 'content', mode: 'file', path: 'out' }, { cwd: dir, signal: aborted.signal }));
    await assert.rejects(readFile(join(dir, 'out')));
    const pending = store.read({ ref, section: 'content' }, { cwd });
    const outcome = pending.then(() => 'resolved', () => 'rejected');
    await ready;
    await store.close();
    assert.equal(replaySignal?.aborted, true);
    resolveReplay(page);
    assert.equal(await outcome, 'rejected');
    await assert.rejects(store.read({ ref, section: 'content' }, { cwd }));
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});


test('saved search URLs paginate without replay even when payload is absent', async () => {
  const store = createRetrieval({ maxBytes: 0 });
  try {
    let calls = 0;
    const ref = store.remember(results, async () => { calls++; return results; });
    const url = results.results[1].url;
    const first = await store.read({ ref, resultIndex: 2, section: 'url', offset: 3, maxChars: 4 }, { cwd });
    assert.deepEqual(first, { mode: 'inline', text: url.slice(3, 7), totalChars: url.length, offset: 3, nextOffset: 7, servedFrom: 'cache' });
    const end = await store.read({ ref, resultIndex: 2, section: 'url', offset: url.length + 2 }, { cwd });
    assert.equal(end.mode, 'inline');
    if (end.mode === 'inline') { assert.equal(end.text, ''); assert.equal(end.nextOffset, null); }
    assert.equal(calls, 0);
  } finally { await store.close(); }
});

test('cached search replay retains original slots and missing results stay missing', async () => {
  const store = createRetrieval({ maxBytes: 600 });
  try {
    let calls = 0;
    const ref = store.remember(results, async () => { calls++; return { kind: 'search', results: [results.results[1]] }; });
    store.remember({ kind: 'fetch', title: '', content: 'x'.repeat(550) });
    const second = await store.read({ ref, resultIndex: 2, section: 'content' }, { cwd });
    assert.equal(second.mode, 'inline');
    if (second.mode === 'inline') assert.equal(second.text, 'second body');
    await assert.rejects(store.read({ ref, resultIndex: 1, section: 'content' }, { cwd }), /unavailable/i);
    const again = await store.read({ ref, resultIndex: 2, section: 'title' }, { cwd });
    assert.equal(again.mode, 'inline');
    if (again.mode === 'inline') assert.equal(again.text, 'Second');
    assert.equal(calls, 1);
  } finally { await store.close(); }
});

test('concurrent replay shares work and cancelling one waiter does not cancel another', async () => {
  const store = createRetrieval({ maxBytes: 0 });
  try {
    let calls = 0;
    let finish!: (value: typeof page) => void;
    let started!: () => void;
    let replaySignal!: AbortSignal;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const ref = store.remember(page, signal => {
      calls++; replaySignal = signal; started();
      return new Promise(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const first = store.read({ ref }, { cwd, signal: controller.signal });
    const firstOutcome = assert.rejects(first, { name: 'AbortError' });
    await ready;
    const second = store.read({ ref }, { cwd });
    controller.abort();
    await firstOutcome;
    assert.equal(replaySignal.aborted, false);
    finish(page);
    const value = await second;
    assert.equal(value.mode, 'inline');
    if (value.mode === 'inline') assert.equal(value.text, page.content);
    assert.equal(calls, 1);
  } finally { await store.close(); }
});

test('last cancelled replay cannot be retried or reinserted after late completion', async () => {
  const store = createRetrieval({ maxBytes: 100 });
  try {
    let calls = 0;
    let finish!: (value: typeof page) => void;
    let started!: () => void;
    let replaySignal!: AbortSignal;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const ref = store.remember({ ...page, content: 'x'.repeat(200) }, signal => {
      calls++; replaySignal = signal; started();
      if (calls > 1) return Promise.resolve(page);
      return new Promise(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const pending = store.read({ ref }, { cwd, signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await ready;
    controller.abort();
    await rejected;
    assert.equal(replaySignal.aborted, true);
    finish(page);
    await Promise.resolve();
    await assert.rejects(store.read({ ref }, { cwd }));
    assert.equal(calls, 1);
  } finally { await store.close(); }
});

test('oversized replay or later eviction never triggers a second paid replay', async () => {
  for (const maxBytes of [1, 200]) {
    const store = createRetrieval({ maxBytes });
    try {
      let calls = 0;
      const ref = store.remember({ ...page, content: 'z'.repeat(300) }, async () => { calls++; return page; });
      const first = await store.read({ ref, maxChars: 2 }, { cwd });
      assert.equal(first.mode, 'inline');
      if (first.mode === 'inline') assert.equal(first.nextOffset, 2);
      store.remember({ ...page, content: 'y'.repeat(150) });
      await assert.rejects(store.read({ ref, offset: 2 }, { cwd }));
      assert.equal(calls, 1);
    } finally { await store.close(); }
  }
});

test('invalid export destinations do not consume the one replay attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-replay-export-'));
  const store = createRetrieval({ maxBytes: 1 });
  try {
    let replays = 0;
    const snapshot = { kind: 'fetch' as const, title: 'Title', content: 'page body' };
    const ref = store.remember(snapshot, async () => { replays++; return snapshot; });
    await writeFile(join(dir, 'existing'), 'original');
    for (const path of ['@', 'missing/page.md', 'existing']) {
      await assert.rejects(store.read({ ref, mode: 'file', path }, { cwd: dir }));
    }
    assert.equal(replays, 0);
    await store.read({ ref, mode: 'file', path: 'new.md' }, { cwd: dir });
    assert.equal(replays, 1);
    assert.equal(await readFile(join(dir, 'existing'), 'utf8'), 'original');
    assert.equal(await readFile(join(dir, 'new.md'), 'utf8'), 'page body');
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit export normalizes @, requires existing parent, and only true overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retrieval-path-'));
  const store = createRetrieval();
  try {
    const ref = store.remember(page);
    await assert.rejects(store.read({ ref, mode: 'file', path: '@missing/out' }, { cwd: dir }));
    const destination = join(dir, 'out');
    await writeFile(destination, 'original');
    await assert.rejects(store.read({ ref, mode: 'file', path: '@out', overwrite: 'true' as unknown as boolean }, { cwd: dir }));
    assert.equal(await readFile(destination, 'utf8'), 'original');
    const exported = await store.read({ ref, mode: 'file', path: '@out', overwrite: true }, { cwd: dir });
    assert.equal(exported.mode, 'file');
    if (exported.mode === 'file') assert.equal(exported.path, destination);
    assert.equal(await readFile(destination, 'utf8'), page.content);
    await assert.rejects(store.read({ ref, mode: 'file', path: 'a'.repeat(10000) }, { cwd: dir }), (error: Error) => {
      assert.doesNotMatch(error.message, /ENAMETOOLONG|aaaaa/);
      return true;
    });
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
