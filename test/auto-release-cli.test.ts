import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/auto-release.mjs', import.meta.url));
const placeholder = {
  name: 'pi-extension-template', version: '0.1.0', private: true,
  repository: { type: 'git', url: 'git+https://github.com/OWNER/REPOSITORY.git' },
};

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'auto-release-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = join(cwd, 'github-output');
  const config = join(cwd, 'empty-git-config');
  writeFileSync(config, '');
  const env = {
    PATH: process.env.PATH, HOME: cwd,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const manifest = version => writeFileSync(join(cwd, 'package.json'), JSON.stringify({ ...placeholder, version }));
  const commit = () => {
    git('add', 'package.json', 'CHANGELOG.md', 'scripts/quality.json');
    git('commit', '-q', '--no-gpg-sign', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const plan = (before, after) => {
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [cli, 'plan'], {
      cwd, env: { ...env, BEFORE_SHA: before, GITHUB_SHA: after,
        GITHUB_REPOSITORY: 'acme/example-extension', GITHUB_OUTPUT: output },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(result.error);
    return { ...result, output: readFileSync(output, 'utf8') };
  };
  git('init', '-q');
  mkdirSync(join(cwd, 'scripts'));
  manifest('0.1.0');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '# Changelog\n\n## [0.1.1]\n\n- Fixture release.\n');
  writeFileSync(join(cwd, 'scripts/quality.json'), JSON.stringify({ piVersion: '1.5.2' }));
  const before = commit();
  return { git, manifest, commit, plan, before, cwd };
}

test('CLI plan rejects a bootstrap all-zero before SHA without producing release outputs', t => {
  const f = fixture(t);
  const result = f.plan('0'.repeat(40), f.before);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /real before\/after push range is required/);
  assert.equal(result.output, '');
});

test('CLI plan skips unchanged versions even with the private template placeholder manifest', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'CHANGELOG.md'), '# Changelog\n\n- Non-release change.\n');
  const result = f.plan(f.before, f.commit());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'action=skip\n');
});

test('CLI plan rejects a stable increase while repository metadata is still a template placeholder', t => {
  const f = fixture(t);
  f.manifest('0.1.1');
  const result = f.plan(f.before, f.commit());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repository still contains the OWNER\/REPOSITORY template placeholder/);
  assert.equal(result.output, '');
});

test('CLI plan rejects rewritten history before skipping an unchanged version', t => {
  const f = fixture(t);
  f.git('checkout', '-q', '--orphan', 'rewritten');
  writeFileSync(join(f.cwd, 'CHANGELOG.md'), '# Changelog\n\n- Rewritten root.\n');
  const after = f.commit();
  assert.notEqual(after, f.before);
  const result = f.plan(f.before, after);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /merge-base --is-ancestor/);
  assert.equal(result.output, '');
});
