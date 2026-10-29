// Q2 — single navigation (landing + app).
//
// What this file covers:
//   (1) Each page (frontend/index.html, frontend/app.html) carries exactly
//       ONE <nav> element, and (2) every link inside that single nav
//       resolves: an in-page "#fragment" resolves to an existing id on the
//       same page, a relative ".html" link resolves to an existing file in
//       frontend/, a relative link with a fragment resolves to both, and an
//       absolute https link is well-formed (scheme + host). It also pins
//       that no in-page jump target repeats inside one nav (the old
//       duplicated-link-set defect) and that the nav keeps a landmark label.
// What this file does NOT cover:
//   Browser rendering, keyboard focus order, live verdicts, real devices,
//   or whether an absolute link is reachable over the network (well-formed
//   is asserted; reachability is a parent-side live check, not a node test).
//   It does not re-assert the exact link list of any earlier test; it
//   asserts the resolution RULE, so a redesign that renames a section is
//   caught only if it leaves a dangling target, and passes if it renames
//   the target and the link together.
//
// Method note: HTML comments are stripped before counting <nav>. One page
// carries an explanatory comment that itself mentions a nav element; counting
// raw text would double-count it. A comment is not an element.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frontendUrl = (name) => fileURLToPath(new URL(`../frontend/${name}`, import.meta.url));
const read = (name) => readFileSync(frontendUrl(name), 'utf8');

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const idsOf = (html) => new Set([
  ...html.matchAll(/id="([^"]+)"/g),
  ...html.matchAll(/id='([^']+)'/g),
].map((m) => m[1]));
const navBlocks = (html) => [...stripComments(html).matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];
const hrefsOf = (navInner) => [...navInner.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  .concat([...navInner.matchAll(/href='([^']+)'/g)].map((m) => m[1]));

const PAGES = ['index.html', 'app.html'];

for (const page of PAGES) {
  test(`${page}: exactly one <nav> element`, () => {
    const blocks = navBlocks(read(page));
    assert.equal(blocks.length, 1, `${page} must contain exactly one <nav>, found ${blocks.length}`);
    assert.ok(hrefsOf(blocks[0][1]).length >= 1, `${page} nav must contain at least one link`);
  });

  test(`${page}: the single nav keeps a landmark label`, () => {
    const block = navBlocks(read(page))[0][0];
    const label = block.match(/aria-label="([^"]+)"/) || block.match(/aria-label='([^']+)'/);
    assert.ok(label && label[1].trim().length > 0, `${page} nav must carry a non-empty aria-label`);
  });

  test(`${page}: every nav link resolves, and no in-page target repeats`, () => {
    const html = read(page);
    const ids = idsOf(html);
    const hrefs = hrefsOf(navBlocks(html)[0][1]);
    const inPage = hrefs.filter((h) => h.startsWith('#'));
    assert.equal(new Set(inPage).size, inPage.length,
      `${page} nav in-page targets must not repeat: ${inPage.join(', ')}`);
    for (const h of hrefs) {
      if (h.startsWith('#')) {
        assert.ok(ids.has(h.slice(1)), `${page} nav href ${h} must resolve to an existing id`);
      } else if (/^https?:\/\//.test(h)) {
        const url = new URL(h);
        assert.ok(url.hostname.length > 0, `${page} nav href ${h} must have a host`);
      } else {
        const [file, fragment] = h.split('#');
        assert.ok(file.length > 0, `${page} nav href ${h} must name a file`);
        assert.ok(existsSync(frontendUrl(file)), `${page} nav href ${h} must resolve to an existing frontend file`);
        if (fragment !== undefined) {
          assert.ok(idsOf(read(file)).has(fragment),
            `${page} nav href ${h} fragment must resolve to an existing id in ${file}`);
        }
      }
    }
  });
}

test('both pages: nav link sets do not share a duplicated second nav', () => {
  // Regression shape for the old defect: a second nav element duplicating
  // the first nav's targets. The per-page count test above already fails
  // on two <nav> elements; this test names the failure mode explicitly so
  // a future two-nav regression is diagnosed, not just counted.
  for (const page of PAGES) {
    const blocks = navBlocks(read(page));
    assert.equal(blocks.length, 1, `${page} must not regain a second nav`);
  }
});
