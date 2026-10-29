// T10 (security + fail-closed): the caller-supplied packPath argument of
// offersheet_trial_pack_verify is bounded and silent about paths.
// The argument itself is preserved (the tamper-check workflow passes a
// copy path — see test/mcp-server.test.js tool 21), because this channel
// is the operator's own stdio host, not a remote API. What must NOT
// happen: an unbounded file slurped into memory, or an error that echoes
// the caller-supplied path (a filesystem-layout oracle).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpServer } from '../backend/mcp-server.js';
import { Guards } from '../backend/src/guards.js';
import { ReceiptStore } from '../backend/src/receipts.js';

async function call(server, name, args = {}) {
  const res = await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { isError: Boolean(res.result.isError), payload: JSON.parse(res.result.content[0].text) };
}

function makeServer() {
  return createMcpServer({
    config: {
      qlooKeyConfigured: false, tmKeyConfigured: false,
      qlooBaseUrl: 'https://hackathon.api.qloo.com', ticketmasterBaseUrl: 'https://app.ticketmaster.com/discovery/v2',
      osmBaseUrl: 'https://nominatim.openstreetmap.org', wikidataBaseUrl: 'https://www.wikidata.org/w/api.php',
      monthlyCallBudget: 1500, perVisitorDailyCap: 20, perRunCallCap: 40,
      mcpTimeoutMs: 60000, restTimeoutMs: 25000, verdictBudgetMs: 90000,
    },
    guards: new Guards(),
    receipts: new ReceiptStore(),
    llmConfigured: false,
  });
}

test('T10 pack: oversize packPath is refused with a generic error that never echoes the path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offersheet-pack-big-'));
  const bigPath = path.join(dir, 'big-pack.json');
  try {
    fs.writeFileSync(bigPath, `{"version":"offersheet-trial-pack-1","pad":"${'x'.repeat(1100000)}"}`);
    const s = makeServer();
    const { isError, payload } = await call(s, 'offersheet_trial_pack_verify', { packPath: bigPath });
    assert.equal(isError, true);
    assert.equal(payload.code, 'NOT_FOUND');
    assert.equal(payload.message, 'Trial pack could not be read');
    assert.ok(!JSON.stringify(payload).includes(bigPath), 'error must not echo the caller-supplied path');
    assert.ok(!JSON.stringify(payload).includes(dir), 'error must not echo the directory either');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T10 pack: unreadable packPath is refused with the same generic error (no path oracle)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offersheet-pack-missing-'));
  const missingPath = path.join(dir, 'no-such-pack.json');
  try {
    const s = makeServer();
    const { isError, payload } = await call(s, 'offersheet_trial_pack_verify', { packPath: missingPath });
    assert.equal(isError, true);
    assert.equal(payload.code, 'NOT_FOUND');
    assert.equal(payload.message, 'Trial pack could not be read');
    assert.ok(!JSON.stringify(payload).includes(missingPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T10 pack: a directory as packPath is refused, not read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offersheet-pack-dir-'));
  try {
    const s = makeServer();
    const { isError, payload } = await call(s, 'offersheet_trial_pack_verify', { packPath: dir });
    assert.equal(isError, true);
    assert.equal(payload.code, 'NOT_FOUND');
    assert.equal(payload.message, 'Trial pack could not be read');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
