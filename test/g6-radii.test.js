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
  // MERGE (design winners): the mockup + Get-the-app rules were deleted
  // with their elements (live iframe replaces the mockup), so the counts
  // fall from 12×3px/1×2px to the story section's own 3×3px/0×2px. The
  // spec — no non-spec radii — is unchanged and still enforced above.
  assert.equal((CSS.match(/border-radius: 3px;/g) || []).length, 3);
  assert.equal((CSS.match(/border-radius: 2px;/g) || []).length, 0);
});
