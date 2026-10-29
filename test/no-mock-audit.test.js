// T16 — no-mock static audit over the verdict path (backend/src ONLY, never test/).
// This is a tripwire, not proof: T10 is the behavioral guarantee (a no-key run
// must serve a visible 503). The audit fails the build if production code ever
// imports a test fixture, names a mock/fake/stub/fixture outside strings and
// comments, drops the NOT_CONFIGURED / VERDICT_WITHHELD branches, or assigns a
// literal key value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = new URL('../backend/src/', import.meta.url).pathname;

function stripStringsAndComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

test('T16: production code never imports test fixtures', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const content = await readFile(join(SRC, f), 'utf8');
    assert.ok(!/from\s+['"]\.\.\/test\//.test(content), `${f} imports from test/`);
    // Import statements only: a documentation comment may mention the word
    // "fixtures" (as pipeline.js does) without importing anything.
    assert.ok(!/^\s*import\s+[^;]*fixtures/m.test(content), `${f} imports fixtures`);
    assert.ok(!/from\s+['"][^'"]*fixtures['"]/.test(content), `${f} imports from a fixtures module`);
  }
});

test('T16: no mock/fake/stub/fixture identifiers outside strings and comments', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const content = await readFile(join(SRC, f), 'utf8');
    const stripped = stripStringsAndComments(content);
    const m = stripped.match(/\b(mock|fake|stub|fixture)\b/i);
    assert.ok(!m, `${f} contains banned identifier outside strings/comments: ${m?.[0]}`);
  }
});

test('T16: fail-closed branches are present (NOT_CONFIGURED + verdict_withheld)', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  let all = '';
  for (const f of files) all += await readFile(join(SRC, f), 'utf8');
  assert.ok(all.includes('NOT_CONFIGURED'), 'NOT_CONFIGURED branch missing');
  assert.ok(all.includes('verdict_withheld'), 'verdict_withheld branch missing');
});

test('T16: no literal key value is assigned in production code', async () => {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const content = await readFile(join(SRC, f), 'utf8');
    for (const line of content.split('\n')) {
      assert.ok(
        !/(QLOO_API_KEY|TICKETMASTER_API_KEY|LLM_API_KEY)\s*=\s*['"][^'"]+['"]/.test(line),
        `${f} assigns a literal key value: ${line.trim()}`,
      );
    }
  }
});
