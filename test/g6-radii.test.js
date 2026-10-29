// G6 (superiority): story/mockup layer radii follow the Studio 3px/2px
// spec. Scoped to frontend/landing-mobile.css only — oracle.css and
// workspace.css are out of scope and untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSS = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'landing-mobile.css'), 'utf8');

test('G6: landing-mobile.css carries no non-spec radii', () => {
  for (const r of ['16px', '32px', '40px']) {
    assert.doesNotMatch(CSS, new RegExp(`border-radius: ${r};`), `${r} must not remain in the story/mockup layer`);
  }
  assert.equal((CSS.match(/border-radius: 3px;/g) || []).length, 12);
  assert.equal((CSS.match(/border-radius: 2px;/g) || []).length, 1);
});
