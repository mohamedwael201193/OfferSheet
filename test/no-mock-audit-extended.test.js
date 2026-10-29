// D10 — T16 extension: the original audit scans backend/src/ ONLY, but
// backend/server.js is also verdict path (it builds the deps and serves
// /api/verdict + /api/replay). A silent-mock branch added to server.js would
// have escaped T16. This file closes that gap: it scans server.js with the
// same rules, and it asserts the scanned set EQUALS the full set of backend
// JS files, so a future backend file cannot silently escape the audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BACKEND = new URL('../backend/', import.meta.url).pathname;
const SRC = new URL('../backend/src/', import.meta.url).pathname;

function stripStringsAndComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

async function backendJsFiles() {
  const top = (await readdir(BACKEND)).filter((f) => f.endsWith('.js'));
  const src = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  return { top, src };
}

test('D10: audit scope covers every backend JS file (no file escapes)', async () => {
  const { top, src } = await backendJsFiles();
  assert.ok(top.includes('server.js'), 'server.js must exist at backend root');
  assert.ok(src.length > 0, 'backend/src must hold modules');
  // The scanned set is server.js + mcp-server.js + every src module: exactly the backend tree.
  const scanned = ['server.js', 'mcp-server.js', ...src.map((f) => `src/${f}`)];
  const actual = [...top, ...src.map((f) => `src/${f}`)];
  assert.deepEqual(scanned.sort(), actual.sort());
});

test('D10: server.js contains no mock/fake/stub/fixture identifiers outside strings/comments', async () => {
  const content = await readFile(join(BACKEND, 'server.js'), 'utf8');
  const stripped = stripStringsAndComments(content);
  const m = stripped.match(/\b(mock|fake|stub|fixture)\b/i);
  assert.ok(!m, `server.js contains banned identifier outside strings/comments: ${m?.[0]}`);
});

test('D10: server.js never imports from test/ or a fixtures module', async () => {
  const content = await readFile(join(BACKEND, 'server.js'), 'utf8');
  assert.ok(!/from\s+['"]\.\.\/test\//.test(content), 'server.js imports from test/');
  assert.ok(!/^\s*import\s+[^;]*fixtures/m.test(content), 'server.js imports fixtures');
  assert.ok(!/from\s+['"][^'"]*fixtures['"]/.test(content), 'server.js imports from a fixtures module');
});

test('D10: server.js assigns no literal key value', async () => {
  const content = await readFile(join(BACKEND, 'server.js'), 'utf8');
  for (const line of content.split('\n')) {
    assert.ok(
      !/(QLOO_API_KEY|TICKETMASTER_API_KEY|LLM_API_KEY)\s*=\s*['"][^'"]+['"]/.test(line),
      `server.js assigns a literal key value: ${line.trim()}`,
    );
  }
});

test('D10: server.js fail-closed wiring is present (replay + verdict gated on key)', async () => {
  const content = await readFile(join(BACKEND, 'server.js'), 'utf8');
  assert.ok(content.includes('notConfigured'), 'server.js must gate on notConfigured');
  assert.ok(content.includes('/api/replay'), 'server.js must serve the replay endpoint');
  assert.ok(content.includes('/api/verdict'), 'server.js must serve the verdict endpoint');
});

// D10 extension (LEGENDARY): mcp-server.js joined the backend root. The scope
// test above now includes it, and the same content rules apply to it here.
test('D10: mcp-server.js contains no mock/fake/stub/fixture identifiers outside strings/comments', async () => {
  const content = await readFile(join(BACKEND, 'mcp-server.js'), 'utf8');
  const stripped = stripStringsAndComments(content);
  const m = stripped.match(/\b(mock|fake|stub|fixture)\b/i);
  assert.ok(!m, `mcp-server.js contains banned identifier outside strings/comments: ${m?.[0]}`);
});

test('D10: mcp-server.js never imports from test/ or a fixtures module', async () => {
  const content = await readFile(join(BACKEND, 'mcp-server.js'), 'utf8');
  assert.ok(!/from\s+['"]\.\.\/test\//.test(content), 'mcp-server.js imports from test/');
  assert.ok(!/^\s*import\s+[^;]*fixtures/m.test(content), 'mcp-server.js imports fixtures');
  assert.ok(!/from\s+['"][^'"]*fixtures['"]/.test(content), 'mcp-server.js imports from a fixtures module');
});

test('D10: mcp-server.js assigns no literal key value', async () => {
  const content = await readFile(join(BACKEND, 'mcp-server.js'), 'utf8');
  for (const line of content.split('\n')) {
    assert.ok(
      !/(QLOO_API_KEY|TICKETMASTER_API_KEY|LLM_API_KEY)\s*=\s*['"][^'"]+['"]/.test(line),
      `mcp-server.js assigns a literal key value: ${line.trim()}`,
    );
  }
});

test('D10: mcp-server.js fail-closed wiring is present (key gate + tools/list)', async () => {
  const content = await readFile(join(BACKEND, 'mcp-server.js'), 'utf8');
  assert.ok(content.includes('notConfigured()'), 'mcp-server.js must gate on notConfigured()');
  assert.ok(content.includes("'tools/list'"), 'mcp-server.js must serve tools/list');
});
