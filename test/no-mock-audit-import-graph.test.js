// G42 — import-graph assertion (stronger than the T16 string grep): resolve
// every static + dynamic import in every production backend file
// (backend/src/*.js + backend/server.js) and assert the resolved target is
// never under test/ and never named fixtures.js. A comment or string that
// merely mentions fixtures cannot trip this; a real import edge always does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = fileURLToPath(new URL('../backend/', import.meta.url));

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

function importSpecifiers(code) {
  const clean = stripComments(code);
  const specs = [];
  for (const m of clean.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  for (const m of clean.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

test('G42: no production backend file imports test/ or fixtures.js (resolved import graph)', async () => {
  const srcFiles = (await readdir(join(BACKEND, 'src'))).filter((f) => f.endsWith('.js'));
  const files = [join(BACKEND, 'server.js'), ...srcFiles.map((f) => join(BACKEND, 'src', f))];
  assert.ok(files.length > 1);
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    const specs = importSpecifiers(code);
    // A file with no imports passes vacuously — it cannot import fixtures.
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue; // builtin / package imports cannot be test fixtures
      const target = resolve(dirname(file), spec);
      assert.ok(!target.split('/').includes('test'), `${file} imports a test/ path: ${spec} -> ${target}`);
      assert.ok(basename(target) !== 'fixtures.js', `${file} imports fixtures.js: ${spec}`);
    }
  }
});
