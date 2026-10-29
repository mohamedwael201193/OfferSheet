// Needs-input picker + formula-anchor regressions (live browser judge, 29 Oct 2026).
// Defect 1: a needs_input run with zero candidates rendered a dead card —
// "pick the one you mean" with nothing to pick and no Try again. The backend
// contract is already covered (verdict-gating S1: candidates carried;
// input-validation D2: empty candidates still needs_input, never a guess),
// so these tests prove the FRONTEND card: options render, Try again works,
// and the empty case is honest instead of a dead end.
// Defect 2: the #formula anchor pointed at an element that did not exist
// until a verdict rendered. The formula section must now exist, unhidden,
// with an honest pre-verdict worked-example note.
// No DOM library: app.js is sliced (declarations only, up to submitVerdict)
// and run in node:vm against a minimal fake document.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const appJs = readFileSync(fileURLToPath(new URL('../frontend/app.js', import.meta.url)), 'utf8');
const indexHtml = readFileSync(fileURLToPath(new URL('../frontend/app.html', import.meta.url)), 'utf8');

function makeButton(attrs) {
  const handlers = {};
  return {
    attrs,
    getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]),
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    click: () => { if (handlers.click) handlers.click(); },
  };
}

function makeDocument() {
  const elements = {};
  const el = (id) => {
    if (!elements[id]) {
      const e = { id, hidden: false, textContent: '', className: '', _html: '', _buttons: [] };
      e.addEventListener = () => {};
      e.scrollIntoView = () => { e.scrolled = true; };
      e.focus = () => { e.focused = true; };
      if (id === 'status') {
        Object.defineProperty(e, 'innerHTML', {
          get: () => e._html,
          set: (html) => {
            e._html = html;
            e._buttons = [];
            const re = /<button\b([^>]*)>/g;
            let m;
            while ((m = re.exec(html))) {
              const tag = m[1];
              const attr = (name) => {
                const mm = tag.match(new RegExp(`${name}="([^"]*)"`));
                return mm ? mm[1] : null;
              };
              e._buttons.push(makeButton({ 'data-entity': attr('data-entity'), id: attr('id') }));
            }
          },
        });
      }
      elements[id] = e;
    }
    return elements[id];
  };
  return {
    getElementById: (id) => {
      const fromStatus = (elements.status?._buttons || []).find((b) => b.attrs.id === id);
      return fromStatus || el(id);
    },
    querySelectorAll: (sel) => {
      if (sel === '[data-entity]') {
        return (elements.status?._buttons || []).filter((b) => b.attrs['data-entity'] !== null);
      }
      return [];
    },
    _elements: elements,
  };
}

// Evaluate app.js declarations (up to submitVerdict, which the tests stub)
// and return a harness: the real renderNeedsInput + a submitVerdict recorder.
function loadRenderNeedsInput() {
  const cut = appJs.indexOf('async function submitVerdict');
  assert.ok(cut > 0, 'submitVerdict marker must exist for slicing');
  const calls = [];
  const doc = makeDocument();
  const sandbox = {
    document: doc,
    submitVerdict: (...args) => { calls.push(args); },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${appJs.slice(0, cut)}\n;globalThis.__renderNeedsInput = renderNeedsInput;`, sandbox);
  return { render: sandbox.__renderNeedsInput, calls, doc };
}

const NEEDS_MESSAGE = 'The headliner name matched multiple entities. Pick the one you mean — the verdict never guesses.';

test('needs_input with candidates renders pickable options + Try again', () => {
  const { render, doc } = loadRenderNeedsInput();
  render({
    status: 'needs_input',
    message: NEEDS_MESSAGE,
    candidates: [
      { id: 'e1', name: 'Xyzzy Qqq (singer)' },
      { id: 'e2', name: 'Xyzzy Qqq (band)' },
    ],
  });
  const html = doc._elements.status._html;
  assert.ok(html.includes('More than one match — pick the one you mean.'));
  assert.ok(html.includes('data-entity="e1"') && html.includes('Xyzzy Qqq (singer)'));
  assert.ok(html.includes('data-entity="e2"') && html.includes('Xyzzy Qqq (band)'));
  assert.ok(html.includes('id="needsTryAgainBtn"') && html.includes('Try again'));
  assert.equal(doc._elements.qlooBadge.textContent, 'Qloo configured — awaiting your pick');
});

test('needs_input candidate click re-runs with the picked entity; Try again focuses the artist field', () => {
  const { render, calls, doc } = loadRenderNeedsInput();
  render({
    status: 'needs_input',
    message: NEEDS_MESSAGE,
    candidates: [{ id: 'e1', name: 'Xyzzy Qqq (singer)' }],
  });
  const picked = doc.querySelectorAll('[data-entity]');
  assert.equal(picked.length, 1);
  picked[0].click();
  assert.deepEqual(calls, [[false, 'e1']]);
  const tryAgain = doc.getElementById('needsTryAgainBtn');
  assert.ok(tryAgain, 'Try again button must be reachable after render');
  tryAgain.click();
  assert.equal(doc._elements.artist.scrolled, true);
  assert.equal(doc._elements.artist.focused, true);
});

test('needs_input with zero candidates is honest, never a dead card', () => {
  const { render, doc } = loadRenderNeedsInput();
  render({ status: 'needs_input', message: NEEDS_MESSAGE, candidates: [] });
  const html = doc._elements.status._html;
  assert.ok(html.includes('No candidates to pick from.'));
  assert.ok(html.includes('no candidate entities for this name'));
  assert.ok(!html.includes('pick the one you mean'), 'empty case must not ask the user to pick from nothing');
  assert.equal(doc.querySelectorAll('[data-entity]').length, 0);
  assert.ok(html.includes('id="needsTryAgainBtn"'));
  doc.getElementById('needsTryAgainBtn').click();
  assert.equal(doc._elements.artist.focused, true);
});

test('needs_input with a missing candidates field behaves as empty, not a crash', () => {
  const { render, doc } = loadRenderNeedsInput();
  render({ status: 'needs_input', message: NEEDS_MESSAGE });
  const html = doc._elements.status._html;
  assert.ok(html.includes('No candidates to pick from.'));
  assert.ok(html.includes('id="needsTryAgainBtn"'));
});

test('candidate names are escaped in the picker', () => {
  const { render, doc } = loadRenderNeedsInput();
  render({
    status: 'needs_input',
    message: NEEDS_MESSAGE,
    candidates: [{ id: 'e9', name: '<img src=x onerror=alert(1)>' }],
  });
  const html = doc._elements.status._html;
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
});

test('formula section exists unhidden with an honest pre-verdict worked-example note', () => {
  assert.ok(indexHtml.includes('<section id="formula" class="sheet crop" aria-label="Formula">'));
  assert.ok(!indexHtml.includes('id="formulaSection"'), 'old id must be gone');
  assert.ok(indexHtml.includes('<p id="workedExample" class="num">Run a verdict to see its worked example here.</p>'));
  assert.equal((indexHtml.match(/href="#formula"/g) || []).length, 2, 'nav + tool links must both resolve');
});

test('formula visibility is no longer verdict-gated, but verdicts still populate the worked example', () => {
  assert.ok(!appJs.includes("$('formula').hidden = true"), 'nothing may re-hide the formula section');
  assert.ok(!appJs.includes('formulaSection'), 'old id must be gone from JS');
  assert.ok(appJs.includes("$('workedExample').textContent"), 'verdicts must still populate the worked example');
  assert.ok(appJs.includes('ceil('), 'worked example must still show the live ceil computation');
});
