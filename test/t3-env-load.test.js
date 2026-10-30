// Track3 patch 04 proof: numeric env vars are read fresh at import and bad
// values fall back instead of poisoning the config with NaN/negatives.
// Config is read at import time, so each case runs in a fresh subprocess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function loadConfig(env) {
  const configUrl = pathToFileURL(path.join(process.cwd(), 'backend/src/config.js')).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { config } from ${JSON.stringify(configUrl)}; console.log(JSON.stringify({ monthlyCallBudget: config.monthlyCallBudget, perVisitorDailyCap: config.perVisitorDailyCap, perRunCallCap: config.perRunCallCap, verdictBudgetMs: config.verdictBudgetMs }));`],
    { env: { ...process.env, ...env }, encoding: 'utf-8', timeout: 30000 });
  return JSON.parse(out.trim());
}

test('t3-04: bad numeric env falls back to 1500/20/40/90000', () => {
  const c = loadConfig({
    MONTHLY_CALL_BUDGET: 'abc',
    PER_VISITOR_DAILY_CAP: '-5',
    PER_RUN_CALL_CAP: 'NaN',
    VERDICT_BUDGET_MS: 'zzz',
  });
  assert.equal(c.monthlyCallBudget, 1500);
  assert.equal(c.perVisitorDailyCap, 20);
  assert.equal(c.perRunCallCap, 40);
  assert.equal(c.verdictBudgetMs, 90000);
});

test('t3-04: good numeric env is honoured', () => {
  const c = loadConfig({
    MONTHLY_CALL_BUDGET: '2000',
    PER_VISITOR_DAILY_CAP: '30',
    PER_RUN_CALL_CAP: '50',
    VERDICT_BUDGET_MS: '60000',
  });
  assert.equal(c.monthlyCallBudget, 2000);
  assert.equal(c.perVisitorDailyCap, 30);
  assert.equal(c.perRunCallCap, 50);
  assert.equal(c.verdictBudgetMs, 60000);
});
