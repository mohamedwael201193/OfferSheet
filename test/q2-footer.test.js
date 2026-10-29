// Q2 — footer presence, overflow safety, and link resolution (landing + app).
//
// What this file covers:
//   (1) A <footer> element exists on both frontend/index.html and
//       frontend/app.html. (2) No inline style forces horizontal overflow:
//       the <footer> tag itself carries no style attribute, and no style
//       attribute inside the footer sets a fixed pixel width, a min-width,
//       or nowrap text (each of which can push content past a narrow
//       viewport). (3) Every footer link resolves by the same rule as the
//       nav test: in-page "#fragment" to an existing id, relative ".html"
//       to an existing frontend file, absolute https to a well-formed URL.
//   The link set is deliberately NOT pinned: earlier tests pin the exact
//   footer copy, this file pins the resolution rule, so a redesign that
//   renames a footer link passes if it renames the target too.
// What this file does NOT cover:
//   Browser rendering, measured overflow at any viewport width, live
//   verdicts, real devices, or whether an absolute link is reachable over
//   the network (well-formed is asserted; reachability is a parent-side
//   live check, not a node test). Stylesheet rules that could overflow
//   are the CSS tests' surface, not this file's: this file covers inline
//   styles only, and says so.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frontendUrl = (name) => fileURLToPath(new URL(`../frontend/${name}`, import.meta.url));
const read = (name) => readFileSync(frontendUrl(name), 'utf8');

const idsOf = (html) => new Set([
  ...html.matchAll(/id="([^"]+)"/g),
  ...html.matchAll(/id='([^']+)'/g),
].map((m) => m[1]));

function footerOf(html) {
  const m = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/);
  assert.ok(m, 'page must contain a <footer> element');
  return m;
}

function assertLinkResolves(page, html, href) {
  if (href.startsWith('#')) {
    assert.ok(idsOf(html).has(href.slice(1)), `${page} footer href ${href} must resolve to an existing id`);
  } else if (/^https?:\/\//.test(href)) {
    const url = new URL(href);
    assert.ok(url.hostname.length > 0, `${page} footer href ${href} must have a host`);
  } else {
    const [file, fragment] = href.split('#');
    assert.ok(file.length > 0, `${page} footer href ${href} must name a file`);
    assert.ok(existsSync(frontendUrl(file)), `${page} footer href ${href} must resolve to an existing frontend file`);
    if (fragment !== undefined) {
      assert.ok(idsOf(read(file)).has(fragment),
        `${page} footer href ${href} fragment must resolve to an existing id in ${file}`);
    }
  }
}

for (const page of ['index.html', 'app.html']) {
  test(`${page}: a footer exists and carries at least one link`, () => {
    const m = footerOf(read(page));
    const hrefs = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1])
      .concat([...m[1].matchAll(/href='([^']+)'/g)].map((x) => x[1]));
    assert.ok(hrefs.length >= 1, `${page} footer must contain at least one link, otherwise resolution is vacuous`);
  });

  test(`${page}: no inline style on or in the footer forces horizontal overflow`, () => {
    const html = read(page);
    const m = footerOf(html);
    const openingTag = m[0].slice(0, m[0].indexOf('>') + 1);
    assert.ok(!/style\s*=/.test(openingTag), `${page} <footer> tag itself must not carry an inline style`);
    const styles = [...m[0].matchAll(/style="([^"]*)"/g)].map((x) => x[1])
      .concat([...m[0].matchAll(/style='([^']*)'/g)].map((x) => x[1]));
    for (const style of styles) {
      assert.ok(!/min-width\s*:/.test(style), `${page} footer inline style must not set min-width: ${style}`);
      assert.ok(!/width\s*:\s*\d+px/.test(style), `${page} footer inline style must not set a fixed pixel width: ${style}`);
      assert.ok(!/white-space\s*:\s*nowrap/.test(style), `${page} footer inline style must not set nowrap: ${style}`);
    }
  });

  test(`${page}: every footer link resolves`, () => {
    const html = read(page);
    const m = footerOf(html);
    const hrefs = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1])
      .concat([...m[1].matchAll(/href='([^']+)'/g)].map((x) => x[1]));
    assert.ok(hrefs.length >= 1, `${page} footer must contain at least one link`);
    for (const href of hrefs) assertLinkResolves(page, html, href);
  });
}
