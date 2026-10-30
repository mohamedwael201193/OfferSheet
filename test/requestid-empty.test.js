// RequestId '' -> '—' fix: the five displayed app.js render sites plus the
// workspace.js rule treat an empty-string requestId exactly like a missing
// one. The CSV download site is deliberately NOT treated: buildVerdictCsv
// feeds a machine-readable download, where a '—' would corrupt the column.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const appJs = fs.readFileSync(path.join(process.cwd(), 'frontend/app.js'), 'utf-8');
const wsJs = fs.readFileSync(path.join(process.cwd(), 'frontend/workspace.js'), 'utf-8');

test('requestid-empty: five displayed app.js sites + workspace rule treat empty as missing', () => {
  const pattern = "r.requestId == null || r.requestId === '' ? '—' : r.requestId";
  assert.equal(appJs.split(pattern).length - 1, 5, 'app.js must carry the empty-string treatment at exactly the 5 displayed sites');
  assert.equal(wsJs.split(pattern).length - 1, 1, 'workspace.js must carry the empty-string treatment at its rule');
  // The rule itself, applied to the three missing shapes and a real id.
  const render = (r) => (r.requestId == null || r.requestId === '' ? '—' : r.requestId);
  assert.equal(render({ requestId: '' }), '—');
  assert.equal(render({ requestId: null }), '—');
  assert.equal(render({}), '—');
  assert.equal(render({ requestId: 'req_123' }), 'req_123');
});

test('requestid-empty: CSV download keeps the raw requestId (no display treatment)', () => {
  const csvSection = appJs.slice(appJs.indexOf('function buildVerdictCsv'));
  const csvBody = csvSection.slice(0, csvSection.indexOf('function downloadFile'));
  assert.ok(csvBody.includes('r.requestId'), 'CSV rows must still carry the raw requestId');
  assert.ok(!csvBody.includes("r.requestId == null || r.requestId === ''"), 'CSV rows must not gain the display treatment');
});
