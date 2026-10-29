// T10 (security + fail-closed): malformed workspace imports and malformed
// stored workspaces must fail closed — never execute, never overwrite a
// good workspace, never brick the panel.
// Pattern follows test/phase3-routing.test.js: frontend/workspace.js is
// rendered in a minimal DOM stub via node:vm, with a stub FileReader so
// the import handler can be driven directly. A good workspace is seeded
// in the stub store first; a malformed import must leave that store byte
// identical and report rejection. A poisoned stored workspace must load
// as "no workspace" (inert in storage, recoverable by seeding) instead of
// throwing during render — on unpatched code the poisoned-load case
// throws out of runInContext, which is the bug this file pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { breakEven } from '../backend/src/breakeven.js';
import { argsHashFor } from '../backend/src/receipts.js';
import { computeWorkspaceId } from '../backend/src/workspace.js';

function goodWorkspace() {
  const guarantee = 250000, ticketPrice = 120;
  const be = breakEven({ guarantee, ticketPrice, variableCost: 0, capacity: null });
  const args = { entity: 'Test Act', type: 'artist' };
  const receipts = [{
    claim: 'headliner description', operation: 'qloo_describe',
    requestHash: argsHashFor('qloo_describe', args), requestId: null, resultCount: 1,
    ids: ['test-entity-x'], entityIds: ['test-entity-x'],
    replay: { kind: 'mcp', tool: 'qloo_describe', args },
  }];
  const baseOffer = {
    artist: 'Test Act', city: 'Test City', venue: null, guarantee, ticketPrice,
    variableCost: null, variableCostProvided: false, capacity: null, capacitySource: null,
  };
  const baseVerdict = {
    tickets: be.tickets, net: be.net, verdict: be.verdict,
    capacityState: 'unknown', capacityCause: 'no_field',
    recordedAt: '2026-10-29T12:00:00.000Z', receipts,
    audience: { areas: [{ id: 'a1', name: 'Area One' }], areasCount: 1 },
    openers: { ranked: [], candidates: [], topPick: null },
    missTrial: null,
  };
  return {
    workspaceVersion: 1, workspaceId: computeWorkspaceId(baseOffer, receipts),
    baseOffer, baseVerdict,
    steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] },
  };
}

async function renderStored(storedJson) {
  const src = await readFile(new URL('../frontend/workspace.js', import.meta.url).pathname, 'utf8');
  const elements = new Map();
  const listeners = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        innerHTML: '', textContent: '', value: '', dataset: {}, files: null,
        addEventListener(type, fn) {
          if (!listeners.has(id)) listeners.set(id, {});
          listeners.get(id)[type] = fn;
        },
        querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  };
  const store = new Map();
  if (storedJson !== null) store.set('offersheet-workspace-v1', storedJson);
  const fileBox = { text: '' };
  class FakeReader {
    readAsText() {
      this.result = fileBox.text;
      if (typeof this.onload === 'function') this.onload();
    }
  }
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => el(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ dataset: {}, addEventListener() {} }),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    FileReader: FakeReader,
    console,
    // The import handler server-verifies verdict-bearing imports (T4
    // import-verify) via fetch, which browsers always provide; the vm
    // sandbox must provide it too or every valid import false-fails.
    // Stub verifies cleanly; assertions below are unchanged.
    fetch: async () => ({ status: 200, json: async () => ({ status: 'verified', mismatches: [] }) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return {
    elements, listeners, store, fileBox,
    fireChange(id) {
      const fn = listeners.get(id)?.change;
      assert.ok(typeof fn === 'function', `expected a change listener on ${id}`);
      fn();
    },
    text(id) { return elements.get(id)?.textContent ?? ''; },
    html(id) { return elements.get(id)?.innerHTML ?? ''; },
  };
}

test('T10 import: malformed import (steps list as a string) is rejected and the stored good workspace is untouched', async () => {
  const good = goodWorkspace();
  const before = JSON.stringify(good);
  const ctx = await renderStored(before);
  const bad = goodWorkspace();
  bad.steps.replacements = 'not-an-array';
  ctx.elements.get('wsImportFile').files = [{ size: 100 }];
  ctx.fileBox.text = JSON.stringify(bad);
  ctx.fireChange('wsImportFile');
  assert.equal(ctx.store.get('offersheet-workspace-v1'), before, 'rejected import must not overwrite stored state');
  assert.match(ctx.text('wsActionsOut'), /Import rejected/);
  assert.match(ctx.text('wsActionsOut'), /Nothing was overwritten/);
  assert.ok(ctx.html('wsHeader').includes('Test Act'), 'panel still shows the prior good workspace');
});

test('T10 import: malformed import (guarantee as a string) is rejected and the stored good workspace is untouched', async () => {
  const good = goodWorkspace();
  const before = JSON.stringify(good);
  const ctx = await renderStored(before);
  const bad = goodWorkspace();
  bad.baseOffer.guarantee = '250000';
  ctx.elements.get('wsImportFile').files = [{ size: 100 }];
  ctx.fileBox.text = JSON.stringify(bad);
  ctx.fireChange('wsImportFile');
  assert.equal(ctx.store.get('offersheet-workspace-v1'), before);
  assert.match(ctx.text('wsActionsOut'), /Import rejected/);
});

test('T10 import: oversize file is rejected without parsing and without touching stored state', async () => {
  const good = goodWorkspace();
  const before = JSON.stringify(good);
  const ctx = await renderStored(before);
  ctx.elements.get('wsImportFile').files = [{ size: 2000000 }];
  ctx.fileBox.text = JSON.stringify(goodWorkspace());
  ctx.fireChange('wsImportFile');
  assert.equal(ctx.store.get('offersheet-workspace-v1'), before);
  assert.match(ctx.text('wsActionsOut'), /over 1MB/);
  assert.match(ctx.text('wsActionsOut'), /Nothing was overwritten/);
});

test('T10 import: a valid import still succeeds and replaces the stored workspace', async () => {
  const good = goodWorkspace();
  const ctx = await renderStored(JSON.stringify(good));
  const next = goodWorkspace();
  next.baseOffer.artist = 'Second Act';
  next.baseOffer.city = 'Second City';
  next.workspaceId = computeWorkspaceId(next.baseOffer, next.baseVerdict.receipts);
  ctx.elements.get('wsImportFile').files = [{ size: 100 }];
  ctx.fileBox.text = JSON.stringify(next);
  ctx.fireChange('wsImportFile');
  // The handler's onload is async and awaits the fetch-verify round-trip,
  // so the success text lands after a macrotask; flush before asserting.
  // Assertions below are unchanged.
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.text('wsActionsOut'), 'Imported.');
  assert.ok(ctx.html('wsHeader').includes('Second Act'), 'panel shows the newly imported workspace');
  assert.equal(JSON.parse(ctx.store.get('offersheet-workspace-v1')).baseOffer.artist, 'Second Act');
});

test('T10 load: poisoned stored workspace (string steps list + null openers) loads as "no workspace" instead of throwing', async () => {
  const poison = goodWorkspace();
  poison.steps.replacements = 'not-an-array';
  poison.baseVerdict.openers = null;
  const poisonJson = JSON.stringify(poison);
  // On unpatched code this await rejects: render() throws out of the
  // script evaluation. On patched code load() returns null and the
  // empty state renders.
  const ctx = await renderStored(poisonJson);
  assert.ok(ctx.html('wsHeader').includes('no workspace'), 'poisoned load must render the empty state');
  assert.equal(ctx.store.get('offersheet-workspace-v1'), poisonJson, 'poisoned load must not delete stored data');
});

test('T10 load: stored workspace with a non-object steps container loads as "no workspace" instead of throwing', async () => {
  const poison = goodWorkspace();
  poison.steps = 'not-an-object';
  const poisonJson = JSON.stringify(poison);
  const ctx = await renderStored(poisonJson);
  assert.ok(ctx.html('wsHeader').includes('no workspace'));
  assert.equal(ctx.store.get('offersheet-workspace-v1'), poisonJson);
});
