// Deal-workspace tests (LEGENDARY Phase 2, spec 03).
// All live legs run against the same dependency-injection pattern as the
// rest of the suite: production wires live transports, tests wire the
// fixture transports from fixtures.js. Production code never imports this
// file. No live keys are used anywhere here; the live-trial evidence
// (real Qloo runs + replayed receipts) is therefore an OWED item listed
// in the Phase 2 report, not something these tests pretend to provide.
// One fixture quirk is normalised in the helpers below, and labelled:
// the fixture REST transport returns canned requestHash values, while the
// real REST client hashes method + URL. The helper rewrites REST receipt
// hashes to the value the real client would have recorded (hash of the
// replay payload's path + params), exactly what verifyWorkspace checks.
// MCP receipt hashes need no rewriting: the pipeline computes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnEphemeralBackend } from './ephemeral-backend.js';
import { readFile } from 'node:fs/promises';
import { runVerdict } from '../backend/src/pipeline.js';
import { breakEven } from '../backend/src/breakeven.js';
import { argsHashFor, requestHashFor } from '../backend/src/receipts.js';
import { OfferError } from '../backend/src/errors.js';
import {
  verifyWorkspace, computeWorkspaceId, buildWorkspace, restUrlFor,
  computeRenegotiation, computeEnvelope, computeSettlement,
  runReplacement, runRouting, runComparison,
  SETTLEMENT_PROVES, SETTLEMENT_DOES_NOT_PROVE, COMPARE_SORT_NOTE,
} from '../backend/src/workspace.js';
import { baseDeps, baseInput, mcpFixture } from './fixtures.js';

const BASE_URL = 'https://hackathon.api.qloo.com';

function fixRestHashes(verdict) {
  for (const r of verdict.receipts || []) {
    if (r.replay?.kind === 'rest') {
      r.requestHash = requestHashFor('GET', restUrlFor(r.replay.path, r.replay.params || {}, BASE_URL));
    }
  }
  return verdict;
}

async function pipelineWorkspace(overrides = {}) {
  const verdict = await runVerdict(baseInput(overrides), baseDeps());
  fixRestHashes(verdict);
  return buildWorkspace(verdict, baseInput(overrides));
}

// Hand-built workspace with exactly-known terms + one valid MCP receipt.
// Lets renegotiation / envelope / settle / verify be tested against
// hand-computed numbers without a pipeline run.
function manualWorkspace({ guarantee, ticketPrice, variableCost = null, capacity = null, capacitySource = null } = {}) {
  const provided = typeof variableCost === 'number';
  const be = breakEven({ guarantee, ticketPrice, variableCost: provided ? variableCost : 0, capacity });
  const args = { entity: 'Test Act', type: 'artist' };
  const receipts = [{
    claim: 'headliner description', operation: 'qloo_describe',
    requestHash: argsHashFor('qloo_describe', args), requestId: null, resultCount: 1,
    ids: ['test-entity-x'], entityIds: ['test-entity-x'],
    replay: { kind: 'mcp', tool: 'qloo_describe', args },
  }];
  const baseOffer = {
    artist: 'Test Act', city: 'Test City', venue: null, guarantee, ticketPrice,
    variableCost: provided ? variableCost : null, variableCostProvided: provided,
    capacity, capacitySource,
  };
  const baseVerdict = {
    tickets: be.tickets, net: be.net, verdict: be.verdict,
    capacityState: capacity === null ? 'unknown' : 'known',
    capacityCause: capacity === null ? 'no_field' : null,
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

const clone = (v) => JSON.parse(JSON.stringify(v));
// Sync-or-async safe: several step functions throw synchronously, and
// assert.rejects does not catch a synchronous throw from the function.
const rejectsInvalid = async (fn) => {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof OfferError && e.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${e?.code}: ${e?.message}`);
    return;
  }
  assert.fail('expected INVALID_INPUT to be thrown');
};

// ---------------- verify ----------------

test('verify: pipeline-derived workspace verifies with all three checks true', async () => {
  const ws = await pipelineWorkspace();
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verified');
  assert.equal(report.schemaOk, true);
  assert.equal(report.arithmeticOk, true);
  assert.equal(report.receiptHashesOk, true);
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.recomputedWorkspaceId, ws.workspaceId);
});

test('verify: tampered break-even number fails with the arithmetic mismatch named', async () => {
  const ws = await pipelineWorkspace();
  ws.baseVerdict.tickets += 1;
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verification_failed');
  assert.equal(report.arithmeticOk, false);
  const m = report.mismatches.find((x) => x.field === 'baseVerdict.tickets');
  assert.ok(m, 'tickets mismatch must be named');
  assert.equal(m.expected, 2084);
});

test('verify: tampered receipt replay payload fails with the receipt hash named', async () => {
  const ws = await pipelineWorkspace();
  const rec = ws.baseVerdict.receipts.find((r) => r.replay?.kind === 'mcp');
  assert.ok(rec);
  rec.replay.args = { ...rec.replay.args, limit: 999 };
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verification_failed');
  assert.equal(report.receiptHashesOk, false);
  assert.ok(report.mismatches.some((x) => x.field.includes('requestHash')), 'hash mismatch must be named');
});

test('verify: edited baseOffer reusing the old workspaceId fails with the ID named', async () => {
  const ws = await pipelineWorkspace();
  ws.baseOffer.city = 'Los Angeles';
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verification_failed');
  assert.ok(report.mismatches.some((x) => x.field === 'workspaceId'), 'ID mismatch must be named');
});

test('verify: REST receipt hash is recomputed from path + params', async () => {
  const ws = manualWorkspace({ guarantee: 12000, ticketPrice: 120, capacity: null });
  const params = { query: 'Test Act', take: 5 };
  ws.baseVerdict.receipts.push({
    claim: 'REST name resolution', operation: 'rest:/search',
    requestHash: requestHashFor('GET', restUrlFor('/search', params, BASE_URL)),
    requestId: null, resultCount: 1,
    replay: { kind: 'rest', path: '/search', params },
  });
  ws.workspaceId = computeWorkspaceId(ws.baseOffer, ws.baseVerdict.receipts);
  assert.equal(verifyWorkspace(ws, { baseUrl: BASE_URL }).status, 'verified');
  ws.baseVerdict.receipts[1].replay.params = { query: 'Someone Else', take: 5 };
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verification_failed');
  assert.ok(report.mismatches.some((x) => x.field.includes('requestHash')));
});

test('verify: non-allowlisted replay tool/path is rejected at the boundary', async () => {
  const ws = manualWorkspace({ guarantee: 12000, ticketPrice: 120 });
  ws.baseVerdict.receipts[0].replay = { kind: 'mcp', tool: 'qloo_not_a_tool', args: {} };
  ws.baseVerdict.receipts[0].requestHash = argsHashFor('qloo_not_a_tool', {});
  ws.workspaceId = computeWorkspaceId(ws.baseOffer, ws.baseVerdict.receipts);
  const report = verifyWorkspace(ws, { baseUrl: BASE_URL });
  assert.equal(report.status, 'verification_failed');
  assert.ok(report.mismatches.some((x) => x.field.includes('replay.tool')));
});

test('verify: malformed workspace is flagged malformed; unseeded workspace fails', async () => {
  assert.equal(verifyWorkspace(null).malformed, true);
  assert.equal(verifyWorkspace('nope').malformed, true);
  const ws = await pipelineWorkspace();
  ws.baseVerdict = null;
  assert.equal(verifyWorkspace(ws, { baseUrl: BASE_URL }).status, 'verification_failed');
  assert.throws(() => buildWorkspace({ status: 'verdict_withheld' }, {}), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => buildWorkspace({ status: 'price_unknown' }, {}), (e) => e.code === 'INVALID_INPUT');
  assert.throws(() => buildWorkspace({ status: 'needs_input' }, {}), (e) => e.code === 'INVALID_INPUT');
});

test('verify: every step refuses 400 on an unverified workspace', async () => {
  const ws = await pipelineWorkspace();
  ws.baseVerdict.tickets += 5;
  await rejectsInvalid(() => computeRenegotiation(ws, {}, { baseUrl: BASE_URL }));
  await rejectsInvalid(() => computeEnvelope(ws, { maxGuarantee: 1000 }, { baseUrl: BASE_URL }));
  await rejectsInvalid(() => computeSettlement(ws, { actualAttendance: 1 }, { baseUrl: BASE_URL }));
  await rejectsInvalid(() => runReplacement(ws, { replacementArtist: 'X' }, baseDeps()));
  await rejectsInvalid(() => runRouting(ws, { candidateCities: ['Chicago'] }, baseDeps()));
  await rejectsInvalid(() => runComparison(ws, { offers: [{ artist: 'X', city: 'Y', guarantee: 1 }] }, async () => baseDeps()));
});

// ---------------- renegotiation ----------------

test('renegotiate: known-capacity default target, hand-computed levers, held-fixed labels', async () => {
  const ws = await pipelineWorkspace({ capacity: 600 });
  assert.equal(ws.baseVerdict.tickets, 2084);
  const out = computeRenegotiation(ws, {}, { baseUrl: BASE_URL });
  assert.equal(out.status, 'ok');
  assert.equal(out.result.targetTickets, 600);
  assert.equal(out.result.targetSource, 'known capacity');
  assert.equal(out.result.levers.lowerGuarantee.value, 72000);
  assert.equal(out.result.levers.lowerGuarantee.reduction, 178000);
  assert.equal(out.result.levers.lowerGuarantee.holdsFixed, 'holding price and costs fixed');
  assert.equal(out.result.levers.higherPrice.value, 416.67);
  assert.equal(out.result.levers.higherPrice.holdsFixed, 'holding guarantee and costs fixed');
  assert.match(out.result.levers.higherPrice.roundingRule, /rounded up to the smallest currency unit/);
  assert.equal(out.result.levers.differentCity.action.includes('routing'), true);
  assert.ok(!('value' in out.result.levers.differentCity), 'different-city lever returns NO number');
  assert.equal(out.result.baseRef.recordedAt, ws.baseVerdict.recordedAt);
  assert.equal(out.result.baseRef.receiptCount, ws.baseVerdict.receipts.length);
  assert.deepEqual(out.receipts, [], 'renegotiation mints NO receipt');
});

test('renegotiate: promoter-supplied target, rounding UP to the cent, blank-cost label on every row', async () => {
  const ws = manualWorkspace({ guarantee: 1000, ticketPrice: 7, variableCost: 1, capacity: 30 });
  // net 6; target 30 -> G* = 180; P* = 1 + 1000/30 = 34.333... -> 34.34 up.
  const out = computeRenegotiation(ws, { targetTickets: 30 }, { baseUrl: BASE_URL });
  assert.equal(out.result.targetSource, 'promoter-supplied');
  assert.equal(out.result.levers.lowerGuarantee.value, 180);
  assert.equal(out.result.levers.higherPrice.value, 34.34);
  assert.ok(Math.abs(out.result.levers.higherPrice.increase - 27.34) < 1e-9, 'increase is 27.34 within float tolerance');
  const wsBlank = await pipelineWorkspace({ capacity: 600 });
  const outBlank = computeRenegotiation(wsBlank, {}, { baseUrl: BASE_URL });
  for (const row of Object.values(outBlank.result.levers)) {
    assert.equal(row.costNote, 'before variable costs');
  }
});

test('renegotiate: unknown capacity + no target is 400; net <= 0 is 400; guarantee 0 notes no lever', async () => {
  const wsUnknown = await pipelineWorkspace();
  assert.equal(wsUnknown.baseOffer.capacity, null);
  await rejectsInvalid(() => computeRenegotiation(wsUnknown, {}, { baseUrl: BASE_URL }));
  // Net <= 0 cannot be built through breakEven (it throws there); instead
  // take a valid workspace and edit its terms so recomputation fails.
  const wsBadNet = manualWorkspace({ guarantee: 1000, ticketPrice: 120, capacity: 100 });
  wsBadNet.baseOffer.ticketPrice = 50;
  wsBadNet.baseOffer.variableCost = 60;
  wsBadNet.baseOffer.variableCostProvided = true;
  wsBadNet.workspaceId = computeWorkspaceId(wsBadNet.baseOffer, wsBadNet.baseVerdict.receipts);
  await rejectsInvalid(() => computeRenegotiation(wsBadNet, { targetTickets: 10 }, { baseUrl: BASE_URL }));
  const wsZero = manualWorkspace({ guarantee: 0, ticketPrice: 120, capacity: 100 });
  const out = computeRenegotiation(wsZero, {}, { baseUrl: BASE_URL });
  assert.match(out.result.note, /no lever applies/);
  assert.equal(out.result.levers, null);
});

// ---------------- envelope ----------------

test('envelope: maxGuarantee inverse, fit / no-fit / unknown branches, blank-cost label', async () => {
  const ws = await pipelineWorkspace({ capacity: 600 });
  const fit = computeEnvelope(ws, { maxGuarantee: 72000 }, { baseUrl: BASE_URL });
  assert.equal(fit.result.ticketsNeeded, 600);
  assert.equal(fit.result.fits, true);
  const noFit = computeEnvelope(ws, { maxGuarantee: 250000 }, { baseUrl: BASE_URL });
  assert.equal(noFit.result.ticketsNeeded, 2084);
  assert.equal(noFit.result.fits, false);
  assert.match(noFit.result.note, /Cannot break even in this room at this guarantee/);
  const wsUnknown = await pipelineWorkspace();
  const unknown = computeEnvelope(wsUnknown, { maxGuarantee: 72000 }, { baseUrl: BASE_URL });
  assert.equal(unknown.result.fits, null);
  assert.match(unknown.result.note, /room fit unknown — capacity unknown/);
  assert.equal(unknown.result.costNote, 'before variable costs');
  assert.deepEqual(unknown.receipts, []);
});

test('envelope: targetTickets inverse agrees with renegotiation lower-guarantee lever', async () => {
  const ws = await pipelineWorkspace({ capacity: 600 });
  const env = computeEnvelope(ws, { targetTickets: 600 }, { baseUrl: BASE_URL });
  const ren = computeRenegotiation(ws, { targetTickets: 600 }, { baseUrl: BASE_URL });
  assert.equal(env.result.maxAffordableGuarantee, 72000);
  assert.equal(env.result.maxAffordableGuarantee, ren.result.levers.lowerGuarantee.value);
  await rejectsInvalid(() => computeEnvelope(ws, { maxGuarantee: 1, targetTickets: 2 }, { baseUrl: BASE_URL }));
  await rejectsInvalid(() => computeEnvelope(ws, {}, { baseUrl: BASE_URL }));
});

// ---------------- settlement ----------------

test('settle: gap + money-gap arithmetic, met and missed assessments', async () => {
  const ws = await pipelineWorkspace();
  const met = computeSettlement(ws, { actualAttendance: 2084 }, { baseUrl: BASE_URL });
  assert.equal(met.result.gapTickets, 0);
  assert.equal(met.result.covered, true);
  assert.equal(met.result.moneyGap, 80);
  assert.equal(met.result.assessment, 'reported sales met the recorded break-even threshold');
  assert.equal(met.result.sourceLabel, 'promoter-reported, unverified');
  const missed = computeSettlement(ws, { actualAttendance: 2000 }, { baseUrl: BASE_URL });
  assert.equal(missed.result.gapTickets, -84);
  assert.equal(missed.result.covered, false);
  assert.equal(missed.result.moneyGap, -10000);
  assert.match(missed.result.assessment, /missed the recorded break-even threshold by 84 tickets \(\$10000 at the settled net\)/);
});

test('settle: attendance over capacity flags (not errors); second settlement corrects; base untouched; proves text verbatim in meaning', async () => {
  const ws = await pipelineWorkspace({ capacity: 600 });
  const flagged = computeSettlement(ws, { actualAttendance: 700 }, { baseUrl: BASE_URL });
  assert.equal(flagged.status, 'ok');
  assert.deepEqual(flagged.result.flags, ['reported attendance exceeds recorded capacity — check the count']);
  const before = clone(ws);
  const ws2 = clone(ws);
  ws2.steps.settlements = [{ recordedAt: '2026-01-01T00:00:00.000Z', actualAttendance: 700 }];
  const second = computeSettlement(ws2, { actualAttendance: 100 }, { baseUrl: BASE_URL });
  assert.equal(second.result.corrects, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(ws, before, 'settle must not mutate the submitted workspace');
  assert.match(second.result.proves, /whether the promoter-reported attendance reached the ticket threshold/);
  assert.match(second.result.proves, /arithmetic comparison between a recorded threshold and a reported outcome/);
  assert.match(second.result.doesNotProve, /that Qloo affinity caused the sales/);
  assert.match(second.result.doesNotProve, /not validation of a prediction method/);
  const json = JSON.stringify(second);
  assert.ok(!/accuracy|win rate/i.test(json), 'no accuracy percentage or win rate, ever');
  assert.equal(second.result.proves, SETTLEMENT_PROVES);
  assert.equal(second.result.doesNotProve, SETTLEMENT_DOES_NOT_PROVE);
  await rejectsInvalid(() => computeSettlement(ws, { actualAttendance: -1 }, { baseUrl: BASE_URL }));
  await rejectsInvalid(() => computeSettlement(ws, { actualAttendance: 1.5 }, { baseUrl: BASE_URL }));
});

// ---------------- replacement ----------------

test('replacement: carried terms, delta arithmetic, new receipts only, workspaceId unchanged', async () => {
  const ws = await pipelineWorkspace();
  const before = clone(ws);
  const out = await runReplacement(ws, { replacementArtist: 'Taylor Swift' }, baseDeps());
  assert.equal(out.status, 'ok');
  assert.equal(out.step, 'replacement');
  assert.equal(out.workspaceId, ws.workspaceId);
  assert.equal(out.result.tickets, 2084);
  assert.equal(out.result.net, 120);
  assert.equal(out.result.deltaTickets, 0);
  assert.equal(out.result.deltaDirection, 'same');
  assert.equal(out.result.deltaMoney, 0);
  assert.equal(out.result.deltaMoneyLabel, 'arithmetic on the two break-evens at the recorded net — not a forecast of money made or lost');
  assert.ok(out.receipts.length > 0, 'replacement carries its own new receipts');
  assert.deepEqual(ws, before, 'replacement must not mutate the submitted workspace');
  await rejectsInvalid(() => runReplacement(ws, { replacementArtist: 'X', guarantee: 1 }, baseDeps()));
  await rejectsInvalid(() => runReplacement(ws, { replacementArtist: 'X', ticketPrice: 99 }, baseDeps()));
  await rejectsInvalid(() => runReplacement(ws, { replacementArtist: 'X', city: 'Chicago' }, baseDeps()));
  await rejectsInvalid(() => runReplacement(ws, {}, baseDeps()));
});

test('replacement: required-leg failure is a step refusal with NO numbers, base intact', async () => {
  const ws = await pipelineWorkspace();
  const badDeps = baseDeps({ mcpCall: mcpFixture({ qloo_where_popular: { status: 'ok', results: [] } }) });
  const out = await runReplacement(ws, { replacementArtist: 'Taylor Swift' }, badDeps);
  assert.equal(out.status, 'step_refused');
  assert.equal(out.step, 'replacement');
  assert.equal(out.priorStepsIntact, true);
  assert.equal(out.writesNothing, true);
  assert.ok(!('tickets' in out) && !('net' in out) && !('deltaTickets' in out), 'refusal carries no numbers');
  assert.equal(verifyWorkspace(ws, { baseUrl: BASE_URL }).status, 'verified', 'base workspace still verifies after a refused replacement');
});

// ---------------- routing ----------------

function routeDeps(handlers) {
  const deps = baseDeps();
  deps.mcpCall = async (tool, args) => {
    assert.equal(tool, 'qloo_where_popular');
    return handlers(args.within, args);
  };
  return deps;
}

test('routing: rank by matched-area count, Qloo-order tie-break, unranked rows carry no rank', async () => {
  const ws = await pipelineWorkspace();
  const deps = routeDeps((city) => {
    if (city === 'Los Angeles') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    if (city === 'Chicago') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }] };
    if (city === 'Boston') return { status: 'ok', results: [{ name: 'A' }, { name: 'B' }] };
    if (city === 'Nowhere') return { status: 'empty', results: [] };
    throw new Error('unexpected city');
  });
  const out = await runRouting(ws, { candidateCities: ['Chicago', 'Boston', 'Los Angeles', 'Nowhere'] }, deps);
  assert.equal(out.status, 'ok');
  const rows = out.result.candidates;
  assert.equal(rows[0].city, 'Los Angeles');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].matchedAreasCount, 3);
  assert.ok(rows[0].receiptRef && rows[0].receiptRef.replay.tool === 'qloo_where_popular', 'every ranked row carries its receipt');
  assert.equal(rows[1].city, 'Chicago');
  assert.equal(rows[2].city, 'Boston');
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[2].rank, 3);
  const unranked = rows[3];
  assert.equal(unranked.city, 'Nowhere');
  assert.equal(unranked.rank, null);
  assert.equal(unranked.status, 'empty');
  assert.ok(!rows.some((r) => r.city === 'Atlantis'), 'an unsubmitted city never appears in output');
  assert.equal(out.result.label, 'affinity-ranked, not demand-proven');
  assert.match(out.result.note, /not a sales forecast/);
  assert.match(out.result.note, /not an attendance estimate/);
  const json = JSON.stringify(out);
  for (const forbidden of ['expected tickets', 'projected sales', 'demand score', 'sellout %', 'audience size', 'recommended city']) {
    assert.ok(!json.toLowerCase().includes(forbidden), `forbidden output string present: ${forbidden}`);
  }
});

test('routing: base city refused; 0 and 11 candidates refused; headliner by name labelled', async () => {
  const ws = await pipelineWorkspace();
  const deps = routeDeps(() => ({ status: 'ok', results: [{ name: 'A' }] }));
  await rejectsInvalid(() => runRouting(ws, { candidateCities: ['New York'] }, deps));
  await rejectsInvalid(() => runRouting(ws, { candidateCities: [] }, deps));
  await rejectsInvalid(() => runRouting(ws, { candidateCities: Array.from({ length: 11 }, (_, i) => `City${i}`) }, deps));
  // By-name path: strip ordered IDs from the base receipts (hashes are
  // unaffected — they come from replay payloads) and re-derive the ID.
  const wsName = clone(ws);
  for (const r of wsName.baseVerdict.receipts) { delete r.ids; delete r.entityIds; }
  wsName.workspaceId = computeWorkspaceId(wsName.baseOffer, wsName.baseVerdict.receipts);
  assert.equal(verifyWorkspace(wsName, { baseUrl: BASE_URL }).status, 'verified');
  let seenEntity = null;
  const depsName = routeDeps(() => ({ status: 'ok', results: [{ name: 'A' }] }));
  const orig = depsName.mcpCall;
  depsName.mcpCall = async (tool, args) => { seenEntity = args.entity; return orig(tool, args); };
  const out = await runRouting(wsName, { candidateCities: ['Chicago'] }, depsName);
  assert.equal(seenEntity, 'Billie Eilish');
  assert.equal(out.result.headlinerRefLabel, 'headliner by name — ID not resolved in the base run');
});

test('routing: first-call failure refuses the whole step; later failure is an unranked row; guard trip refuses whole step', async () => {
  const ws = await pipelineWorkspace();
  const failFirst = routeDeps(() => { throw new Error('transport down'); });
  await assert.rejects(() => runRouting(ws, { candidateCities: ['Chicago', 'Boston'] }, failFirst));
  let n = 0;
  const failLater = routeDeps(() => {
    n += 1;
    if (n === 2) throw new Error('one city failed');
    return { status: 'ok', results: [{ name: 'A' }] };
  });
  const out = await runRouting(ws, { candidateCities: ['Chicago', 'Boston'] }, failLater);
  assert.equal(out.result.candidates[0].status, 'ok');
  assert.equal(out.result.candidates[1].status, 'error');
  assert.equal(out.result.candidates[1].rank, null);
  const guardDeps = routeDeps(() => { throw new OfferError('QUOTA_FLOOR', 503, 'floor'); });
  await assert.rejects(() => runRouting(ws, { candidateCities: ['Chicago'] }, guardDeps), (e) => e.code === 'QUOTA_FLOOR');
});

// ---------------- comparison ----------------

test('routing: client disconnect mid-run yields no rows (cancelled error, not a partial table)', async () => {
  const ws = await pipelineWorkspace();
  const deps = routeDeps(() => ({ status: 'ok', results: [{ name: 'A' }] }));
  deps.isCancelled = () => true;
  await assert.rejects(() => runRouting(ws, { candidateCities: ['Chicago'] }, deps), (e) => e.cancelled === true);
});

test('comparison: base row 0 never re-run, comparison rows sorted by tickets, exact sort note, no winner/best', async () => {
  const ws = await pipelineWorkspace();
  const out = await runComparison(ws, {
    offers: [
      { artist: 'Big Act', city: 'Chicago', guarantee: 300000, ticketPrice: 120 },
      { artist: 'Small Act', city: 'Boston', guarantee: 120000, ticketPrice: 120 },
    ],
  }, async () => baseDeps());
  assert.equal(out.status, 'ok');
  const rows = out.result.rows;
  assert.equal(rows[0].offerIndex, 0);
  assert.equal(rows[0].artist, 'Billie Eilish');
  assert.equal(rows[0].tickets, 2084);
  assert.deepEqual(rows[0].receipts, [], 'base row cites receipts by count, not re-stated');
  assert.equal(rows[0].receiptCount, ws.baseVerdict.receipts.length);
  assert.equal(rows[1].tickets, 1000);
  assert.equal(rows[2].tickets, 2500);
  assert.equal(out.result.sortNote, COMPARE_SORT_NOTE);
  assert.equal(out.result.sortNote, 'Sorted by tickets needed to break even. This is not a ranking of which offer will succeed.');
  assert.ok(!/winner|best/i.test(JSON.stringify(out)), 'no winner/best string anywhere in the response');
});

test('comparison: per-row refusal leaves other rows intact with numbers; duplicate and cap rejected', async () => {
  const ws = await pipelineWorkspace();
  const makeDeps = async (offer) => {
    if (offer.artist === 'Withheld Act') {
      return baseDeps({ mcpCall: mcpFixture({ qloo_where_popular: { status: 'ok', results: [] } }) });
    }
    return baseDeps();
  };
  const out = await runComparison(ws, {
    offers: [
      { artist: 'Withheld Act', city: 'Chicago', guarantee: 120000, ticketPrice: 120 },
      { artist: 'Good Act', city: 'Boston', guarantee: 120000, ticketPrice: 120 },
    ],
  }, makeDeps);
  const refused = out.result.rows.find((r) => r.artist === 'Withheld Act');
  const good = out.result.rows.find((r) => r.artist === 'Good Act');
  assert.equal(refused.status, 'refused');
  assert.ok(!('tickets' in refused) && !('net' in refused) && !('guarantee' in refused), 'refused row carries no numbers');
  assert.equal(good.status, 'verdict');
  assert.equal(good.tickets, 1000);
  await rejectsInvalid(() => runComparison(ws, {
    offers: [{ artist: 'Billie Eilish', city: 'New York', guarantee: 250000, ticketPrice: 120 }],
  }, async () => baseDeps()));
  await rejectsInvalid(() => runComparison(ws, {
    offers: Array.from({ length: 6 }, (_, i) => ({ artist: `Act${i}`, city: 'Chicago', guarantee: 1000, ticketPrice: 120 })),
  }, async () => baseDeps()));
});

test('comparison: guard failure before any offer refuses the whole step; disconnect mid-run yields no entry', async () => {
  const ws = await pipelineWorkspace();
  const noKeyDeps = baseDeps({ config: { qlooKeyConfigured: false } });
  await assert.rejects(() => runComparison(ws, {
    offers: [{ artist: 'X', city: 'Y', guarantee: 1, ticketPrice: 120 }],
  }, async () => noKeyDeps), (e) => e.code === 'NOT_CONFIGURED');
  let cancelled = false;
  let calls = 0;
  const makeDeps = async () => {
    calls += 1;
    if (calls === 2) cancelled = true;
    return baseDeps();
  };
  await assert.rejects(() => runComparison(ws, {
    offers: [
      { artist: 'Act One', city: 'Chicago', guarantee: 120000, ticketPrice: 120 },
      { artist: 'Act Two', city: 'Boston', guarantee: 120000, ticketPrice: 120 },
    ],
  }, makeDeps, { isCancelled: () => cancelled }), (e) => e.cancelled === true);
});

// ---------------- workspace sizes (§3.8) ----------------

test('workspace sizes: base-only, base+replacement, base+full 5-offer comparison (spec §3.8 measurement)', async () => {
  const ws = await pipelineWorkspace();
  const baseSize = Buffer.byteLength(JSON.stringify(ws), 'utf8');
  const replacement = await runReplacement(ws, { replacementArtist: 'Taylor Swift' }, baseDeps());
  const wsReplacement = clone(ws);
  wsReplacement.steps.replacements.push(replacement.result);
  const replacementSize = Buffer.byteLength(JSON.stringify(wsReplacement), 'utf8');
  const comparison = await runComparison(ws, {
    offers: Array.from({ length: 5 }, (_, i) => ({ artist: `Act${i}`, city: 'Chicago', guarantee: 60000 * (i + 1), ticketPrice: 120 })),
  }, async () => baseDeps());
  const wsComparison = clone(ws);
  wsComparison.steps.comparison = comparison.result;
  const comparisonSize = Buffer.byteLength(JSON.stringify(wsComparison), 'utf8');
  console.log(`workspace sizes (bytes): base-only=${baseSize} base+replacement=${replacementSize} base+full-comparison=${comparisonSize} readBody-limit=65536`);
  assert.ok(baseSize < 65536, `base-only workspace must fit the 64KB body limit (got ${baseSize})`);
  assert.ok(replacementSize < 65536, `base+replacement workspace must fit the 64KB body limit (got ${replacementSize})`);
  assert.ok(comparisonSize < 65536, `base+full-comparison workspace must fit the 64KB body limit (got ${comparisonSize})`);
});

// ---------------- server wiring (static) + live-server smoke ----------------

test('server wiring: workspace routes + webmanifest type present; no new fs writes in step handlers', async () => {
  const src = await readFile(new URL('../backend/server.js', import.meta.url).pathname, 'utf8');
  for (const route of ['/api/workspace/verify', '/api/workspace/replacement', '/api/workspace/renegotiate', '/api/workspace/route', '/api/workspace/envelope', '/api/workspace/compare', '/api/workspace/settle', '/api/verdict/stream']) {
    assert.ok(src.includes(route), `server.js must serve ${route}`);
  }
  assert.ok(src.includes("'.webmanifest': 'application/manifest+json'"), 'CONTENT_TYPES must map .webmanifest');
  const wsSrc = await readFile(new URL('../backend/src/workspace.js', import.meta.url).pathname, 'utf8');
  assert.ok(!/writeFile|appendFile|createWriteStream|fs\./.test(wsSrc), 'workspace.js performs zero disk writes');
  assert.ok(!wsSrc.includes('fixtures'), 'workspace.js never references test fixtures');
});

test('live server smoke (no keys): pure steps verify over HTTP; replacement refuses closed; stream emits an error event', { timeout: 30000 }, async () => {
  const { child, port } = await spawnEphemeralBackend({
    ...process.env,
    QLOO_API_KEY: '',
    TICKETMASTER_API_KEY: '',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i += 1) {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const ws = await pipelineWorkspace({ capacity: 600 });
    const post = async (path, body) => {
      const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json() };
    };
    const verified = await post('/api/workspace/verify', { workspace: ws });
    assert.equal(verified.status, 200);
    assert.equal(verified.json.status, 'verified');
    const ren = await post('/api/workspace/renegotiate', { workspace: ws, stepInput: {} });
    assert.equal(ren.status, 200);
    assert.equal(ren.json.result.levers.lowerGuarantee.value, 72000);
    const env = await post('/api/workspace/envelope', { workspace: ws, stepInput: { targetTickets: 600 } });
    assert.equal(env.json.result.maxAffordableGuarantee, 72000);
    const settled = await post('/api/workspace/settle', { workspace: ws, stepInput: { actualAttendance: 2084 } });
    assert.equal(settled.json.result.covered, true);
    const refused = await post('/api/workspace/replacement', { workspace: ws, stepInput: { replacementArtist: 'Taylor Swift' } });
    assert.equal(refused.status, 503);
    assert.equal(refused.json.status, 'step_refused');
    assert.equal(refused.json.error.code, 'NOT_CONFIGURED');
    assert.equal(refused.json.priorStepsIntact, true);
    assert.equal(refused.json.writesNothing, true);
    const streamRes = await fetch(`${base}/api/verdict/stream?artist=Billie%20Eilish&city=New%20York&guarantee=250000&ticketPrice=120`);
    assert.equal(streamRes.headers.get('content-type'), 'text/event-stream');
    const streamText = await streamRes.text();
    assert.match(streamText, /event: error/);
    assert.match(streamText, /NOT_CONFIGURED/);
    assert.ok(!streamText.includes('event: leg'), 'no leg event may precede the key-gate error — no call completed');
  } finally {
    child.kill('SIGTERM');
  }
});
