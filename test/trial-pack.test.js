// Item 6: the frozen, checksummed trial pack pins bench/results.json.
// Recompute every checksum + every break-even from the ledger itself;
// the pack must match field-for-field or the suite fails (frozen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
};

test('item 6: trial pack is frozen, checksummed, and labelled recorded', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'trial-pack.json'), 'utf8'));
  const bench = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'results.json'), 'utf8'));
  const runs = bench.runs;
  assert.equal(pack.version, 'offersheet-trial-pack-1');
  assert.match(pack.label, /recorded, not live/);
  assert.equal(pack.trials.length, runs.length);
  assert.equal(pack.trials.length, 3);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const trial = pack.trials[i];
    assert.deepEqual(trial.inputs, run.input);
    assert.equal(trial.breakEvenTickets, run.breakEvenTickets);
    assert.equal(trial.graphPick, run.graphPick);
    assert.equal(trial.recordedAt, run.recordedAt);
    // Arithmetic re-verified without any fresh Qloo call.
    assert.equal(Math.ceil(run.input.guarantee / run.input.ticketPrice), run.breakEvenTickets);
    // Checksum recomputed from the ledger's own fields.
    const core = { inputs: run.input, breakEvenTickets: run.breakEvenTickets, graphPick: run.graphPick, recordedAt: run.recordedAt };
    assert.equal(trial.sha256, sha(canon(core)));
  }
  assert.equal(pack.packSha256, sha(pack.trials.map((t) => t.sha256).join('')));
});
