// Deal workspace (OfferSheet LEGENDARY Phase 2) — spec:
// ~/workspace/qloo-hackathon/legendary-spec/03-deal-workspace-architecture.md
// Client-held workspace, server-recomputed and server-verified. The server
// stores NOTHING between requests: every function here takes the submitted
// workspace, validates + recomputes it, and returns a step result. No disk
// writes, no database, no session store. No predicted attendance, sales,
// headcount, or demand field exists anywhere in this module.
// Reuse only: breakEven (pure arithmetic), argsHashFor / requestHashFor /
// sha256 (receipt hashes), OfferError taxonomy, runVerdict (full pipeline),
// MCP_TOOLS / REST_PATHS (replay allowlists), isGuardTrip.
import { breakEven } from './breakeven.js';
import { argsHashFor, requestHashFor, sha256 } from './receipts.js';
import { invalidInput, isGuardTrip } from './errors.js';
import { runVerdict } from './pipeline.js';
import { MCP_TOOLS } from './mcp.js';
import { REST_PATHS } from './rest.js';

export const QLOO_DEFAULT_BASE_URL = 'https://hackathon.api.qloo.com';

export const SETTLEMENT_PROVES = 'What this check proves: whether the promoter-reported attendance reached the ticket threshold computed from the recorded guarantee, price, and costs. That is an arithmetic comparison between a recorded threshold and a reported outcome.';
export const SETTLEMENT_DOES_NOT_PROVE = 'What it does NOT prove: that Qloo affinity caused the sales; that affinity predicts sales; that this verdict method will be right next time; or that any other show will behave the same way. One settled show is one data point about one threshold, not validation of a prediction method. Affinity data describes taste match; it has never been a sales forecast in this product, and this check does not turn it into one.';
export const COMPARE_SORT_NOTE = 'Sorted by tickets needed to break even. This is not a ranking of which offer will succeed.';
export const ROUTING_LABEL = 'affinity-ranked, not demand-proven';
export const ROUTING_NOTE = 'Ranking reflects how many areas Qloo matched for this headliner in each city. It is not a sales forecast, not an attendance estimate, and not evidence the show will sell.';
export const DELTA_MONEY_LABEL = 'arithmetic on the two break-evens at the recorded net — not a forecast of money made or lost';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNullOrStr = (v) => v === null || typeof v === 'string';
const short = (v) => {
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return Array.isArray(v) ? `array[${v.length}]` : typeof v;
};

// Canonical baseOffer for the workspace ID (spec §1.4): keys sorted,
// artist/city/venue trimmed and lower-cased for the hash ONLY.
export function canonicalBaseOffer(baseOffer) {
  const out = {};
  for (const key of Object.keys(baseOffer).sort()) {
    const v = baseOffer[key];
    out[key] = (key === 'artist' || key === 'city' || key === 'venue') && typeof v === 'string'
      ? v.trim().toLowerCase()
      : v;
  }
  return JSON.stringify(out);
}

export function computeWorkspaceId(baseOffer, receipts) {
  const hashes = (Array.isArray(receipts) ? receipts : [])
    .map((r) => r?.requestHash)
    .filter((h) => typeof h === 'string')
    .sort();
  return sha256(`${canonicalBaseOffer(baseOffer)}|${hashes.join(',')}`);
}

// Rebuild a REST request URL exactly as qlooRest does (params in object
// order, undefined/null/'' skipped, values stringified) so the hash
// recomputation matches the hash the live call recorded.
export function restUrlFor(path, params, baseUrl) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

// Build a seedable workspace object from a runVerdict response with
// status 'verdict' plus the promoter's original inputs. Throws
// INVALID_INPUT for any non-verdict response: withheld / price_unknown /
// needs_input responses carry no break-even number and cannot seed.
export function buildWorkspace(verdict, input) {
  if (!verdict || verdict.status !== 'verdict') {
    throw invalidInput('only a response with status verdict can seed a workspace');
  }
  const baseOffer = {
    artist: verdict.artist,
    city: verdict.city,
    venue: typeof input?.venue === 'string' && input.venue.trim() ? input.venue.trim() : null,
    guarantee: verdict.guarantee,
    ticketPrice: verdict.breakEven.price.value,
    variableCost: verdict.breakEven.variableCost.provided ? verdict.breakEven.variableCost.value : null,
    variableCostProvided: verdict.breakEven.variableCost.provided,
    capacity: verdict.capacity.value,
    capacitySource: verdict.capacity.source,
  };
  const baseVerdict = {
    tickets: verdict.breakEven.tickets,
    net: verdict.breakEven.net,
    verdict: verdict.breakEven.verdict,
    capacityState: verdict.capacity.state,
    capacityCause: verdict.capacity.cause ?? null,
    recordedAt: new Date().toISOString(),
    receipts: verdict.receipts || [],
    audience: { areas: verdict.audience.areas, areasCount: verdict.audience.areasCount },
    openers: {
      ranked: verdict.openers.ranked,
      candidates: verdict.openers.candidates,
      topPick: verdict.openers.topPick,
    },
    missTrial: verdict.missTrial ?? null,
  };
  const workspace = {
    workspaceVersion: 1,
    workspaceId: '',
    baseOffer,
    baseVerdict,
    steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] },
  };
  workspace.workspaceId = computeWorkspaceId(baseOffer, baseVerdict.receipts);
  return workspace;
}

// Verify a submitted workspace: schema + arithmetic + receipt hashes +
// workspace-ID recomputation. Returns a 200-style report; it throws
// NOTHING for a well-formed but inconsistent object. Only a workspace
// that is not an object at all is flagged malformed (the HTTP layer
// turns that into INVALID_INPUT 400).
export function verifyWorkspace(workspace, { baseUrl = QLOO_DEFAULT_BASE_URL } = {}) {
  if (!isObj(workspace)) {
    return { malformed: true, status: 'verification_failed', schemaOk: false, arithmeticOk: false, receiptHashesOk: false, workspaceId: null, recomputedWorkspaceId: null, mismatches: [{ field: 'workspace', expected: 'a JSON object', submitted: short(workspace) }] };
  }
  const mismatches = [];
  const mismatch = (field, expected, submitted) => mismatches.push({ field, expected, submitted: short(submitted) });
  let schemaOk = true;
  let arithmeticOk = true;
  let receiptHashesOk = true;

  if (workspace.workspaceVersion !== 1) { schemaOk = false; mismatch('workspaceVersion', 1, workspace.workspaceVersion); }
  if (typeof workspace.workspaceId !== 'string' || !workspace.workspaceId) { schemaOk = false; mismatch('workspaceId', 'non-empty string', workspace.workspaceId); }

  const base = workspace.baseOffer;
  let baseTermsOk = false;
  if (!isObj(base)) {
    schemaOk = false; mismatch('baseOffer', 'object', base);
  } else {
    if (!isNonEmptyStr(base.artist)) { schemaOk = false; mismatch('baseOffer.artist', 'non-empty string', base.artist); }
    if (!isNonEmptyStr(base.city)) { schemaOk = false; mismatch('baseOffer.city', 'non-empty string', base.city); }
    if (!isNullOrStr(base.venue)) { schemaOk = false; mismatch('baseOffer.venue', 'string | null', base.venue); }
    if (!isFiniteNum(base.guarantee) || base.guarantee < 0) { schemaOk = false; mismatch('baseOffer.guarantee', 'number >= 0', base.guarantee); }
    if (!(base.ticketPrice === null || (isFiniteNum(base.ticketPrice) && base.ticketPrice > 0))) { schemaOk = false; mismatch('baseOffer.ticketPrice', 'number > 0 | null', base.ticketPrice); }
    if (!(base.variableCost === null || (isFiniteNum(base.variableCost) && base.variableCost >= 0))) { schemaOk = false; mismatch('baseOffer.variableCost', 'number >= 0 | null', base.variableCost); }
    if (typeof base.variableCostProvided !== 'boolean') { schemaOk = false; mismatch('baseOffer.variableCostProvided', 'boolean', base.variableCostProvided); }
    if (base.variableCostProvided === true && !isFiniteNum(base.variableCost)) { schemaOk = false; mismatch('baseOffer.variableCost', 'number >= 0 when variableCostProvided is true', base.variableCost); }
    if (!(base.capacity === null || (isFiniteNum(base.capacity) && base.capacity > 0))) { schemaOk = false; mismatch('baseOffer.capacity', 'number > 0 | null', base.capacity); }
    if (!isNullOrStr(base.capacitySource)) { schemaOk = false; mismatch('baseOffer.capacitySource', 'string | null', base.capacitySource); }
    baseTermsOk = isNonEmptyStr(base.artist) && isNonEmptyStr(base.city)
      && isFiniteNum(base.guarantee) && base.guarantee >= 0
      && (base.ticketPrice === null || (isFiniteNum(base.ticketPrice) && base.ticketPrice > 0))
      && (base.variableCost === null || (isFiniteNum(base.variableCost) && base.variableCost >= 0))
      && typeof base.variableCostProvided === 'boolean'
      && (base.capacity === null || (isFiniteNum(base.capacity) && base.capacity > 0));
  }

  const bv = workspace.baseVerdict;
  let verdictShapeOk = false;
  if (!isObj(bv)) {
    schemaOk = false; mismatch('baseVerdict', 'object seeded from a status verdict run', bv);
  } else {
    if (bv.status !== undefined && bv.status !== 'verdict') { schemaOk = false; mismatch('baseVerdict.status', 'verdict', bv.status); }
    if (!Number.isInteger(bv.tickets) || bv.tickets < 0) { schemaOk = false; mismatch('baseVerdict.tickets', 'integer >= 0', bv.tickets); }
    if (!isFiniteNum(bv.net)) { schemaOk = false; mismatch('baseVerdict.net', 'number', bv.net); }
    if (!(bv.verdict === null || typeof bv.verdict === 'string')) { schemaOk = false; mismatch('baseVerdict.verdict', 'string | null', bv.verdict); }
    if (!(bv.capacityState === 'known' || bv.capacityState === 'unknown')) { schemaOk = false; mismatch('baseVerdict.capacityState', 'known | unknown', bv.capacityState); }
    if (!(bv.capacityCause === null || bv.capacityCause === undefined || ['not_configured', 'error', 'no_field'].includes(bv.capacityCause))) { schemaOk = false; mismatch('baseVerdict.capacityCause', 'not_configured | error | no_field | null', bv.capacityCause); }
    if (typeof bv.recordedAt !== 'string' || Number.isNaN(Date.parse(bv.recordedAt))) { schemaOk = false; mismatch('baseVerdict.recordedAt', 'ISO timestamp', bv.recordedAt); }
    if (!Array.isArray(bv.receipts) || bv.receipts.length === 0) { schemaOk = false; mismatch('baseVerdict.receipts', 'non-empty array', bv.receipts); }
    if (!isObj(bv.audience) || !Array.isArray(bv.audience.areas) || bv.audience.areasCount !== bv.audience.areas.length) { schemaOk = false; mismatch('baseVerdict.audience', 'areas array with areasCount equal to its length', bv.audience); }
    if (!isObj(bv.openers) || !Array.isArray(bv.openers.ranked) || !Array.isArray(bv.openers.candidates) || !(bv.openers.topPick === null || typeof bv.openers.topPick === 'string')) { schemaOk = false; mismatch('baseVerdict.openers', '{ ranked[], candidates[], topPick string | null }', bv.openers); }
    if (!(bv.missTrial === null || bv.missTrial === undefined || isObj(bv.missTrial))) { schemaOk = false; mismatch('baseVerdict.missTrial', 'object | null', bv.missTrial); }
    if (isObj(base) && base.ticketPrice === null) { schemaOk = false; mismatch('baseOffer.ticketPrice', 'number > 0 for a seeded verdict (null means price-unknown, which cannot seed)', base.ticketPrice); }
    if (isObj(base) && bv.capacityState === 'known' && (base.capacity === null || base.capacity === undefined)) { schemaOk = false; mismatch('baseVerdict.capacityState', 'known capacity requires a baseOffer.capacity value', bv.capacityState); }
    if (isObj(base) && bv.capacityState === 'unknown' && base.capacity !== null && base.capacity !== undefined) { schemaOk = false; mismatch('baseVerdict.capacityState', 'unknown capacity requires baseOffer.capacity null', bv.capacityState); }
    verdictShapeOk = Number.isInteger(bv.tickets) && bv.tickets >= 0 && isFiniteNum(bv.net)
      && (bv.verdict === null || typeof bv.verdict === 'string')
      && (bv.capacityState === 'known' || bv.capacityState === 'unknown')
      && typeof bv.recordedAt === 'string' && !Number.isNaN(Date.parse(bv.recordedAt))
      && Array.isArray(bv.receipts) && bv.receipts.length > 0;
  }

  // Arithmetic: recompute from the submitted terms with breakEven().
  // The server never trusts a client-computed number.
  if (baseTermsOk && verdictShapeOk && isObj(base) && base.ticketPrice !== null) {
    const cost = base.variableCostProvided ? (base.variableCost ?? 0) : 0;
    try {
      const be = breakEven({ guarantee: base.guarantee, ticketPrice: base.ticketPrice, variableCost: cost, capacity: base.capacity });
      if (be.tickets !== bv.tickets) { arithmeticOk = false; mismatch('baseVerdict.tickets', be.tickets, bv.tickets); }
      if (be.net !== bv.net) { arithmeticOk = false; mismatch('baseVerdict.net', be.net, bv.net); }
      if (be.verdict !== bv.verdict) { arithmeticOk = false; mismatch('baseVerdict.verdict', be.verdict, bv.verdict); }
    } catch (e) {
      arithmeticOk = false; mismatch('baseVerdict', `recomputable break-even (${e.message})`, 'break-even recomputation threw');
    }
  } else if (verdictShapeOk || baseTermsOk) {
    // One side is well-formed but the pair cannot be recomputed together.
    arithmeticOk = false; mismatch('baseVerdict', 'arithmetic recomputable from baseOffer terms', 'terms or verdict shape invalid');
  } else {
    arithmeticOk = false; mismatch('baseVerdict', 'arithmetic recomputable from baseOffer terms', 'terms and verdict shape invalid');
  }

  // Receipt hashes: recompute from each receipt's replay payload. This
  // proves internal consistency (hash matches the claimed call), not
  // that the call happened — live replay is the stronger proof.
  if (isObj(bv) && Array.isArray(bv.receipts)) {
    bv.receipts.forEach((r, i) => {
      const field = `baseVerdict.receipts[${i}]`;
      if (!isObj(r) || typeof r.claim !== 'string' || typeof r.operation !== 'string' || typeof r.requestHash !== 'string') {
        receiptHashesOk = false; mismatch(field, 'receipt with claim, operation, requestHash strings', r); return;
      }
      if (!isObj(r.replay)) { receiptHashesOk = false; mismatch(`${field}.replay`, 'replay payload required to recompute the hash', r.replay); return; }
      if (r.replay.kind === 'mcp') {
        if (!MCP_TOOLS.includes(r.replay.tool)) { receiptHashesOk = false; mismatch(`${field}.replay.tool`, 'allowlisted MCP tool', r.replay.tool); return; }
        if (!isObj(r.replay.args)) { receiptHashesOk = false; mismatch(`${field}.replay.args`, 'object', r.replay.args); return; }
        const expected = argsHashFor(r.replay.tool, r.replay.args);
        if (expected !== r.requestHash) { receiptHashesOk = false; mismatch(`${field}.requestHash`, expected, r.requestHash); }
      } else if (r.replay.kind === 'rest') {
        if (!REST_PATHS.includes(r.replay.path)) { receiptHashesOk = false; mismatch(`${field}.replay.path`, 'allowlisted REST path', r.replay.path); return; }
        if (!isObj(r.replay.params) && r.replay.params !== undefined) { receiptHashesOk = false; mismatch(`${field}.replay.params`, 'object', r.replay.params); return; }
        const expected = requestHashFor('GET', restUrlFor(r.replay.path, r.replay.params || {}, baseUrl));
        if (expected !== r.requestHash) { receiptHashesOk = false; mismatch(`${field}.requestHash`, expected, r.requestHash); }
      } else {
        receiptHashesOk = false; mismatch(`${field}.replay.kind`, 'mcp | rest', r.replay.kind);
      }
    });
  }

  let recomputedWorkspaceId = null;
  let idOk = false;
  if (isObj(base) && isObj(bv) && Array.isArray(bv.receipts)) {
    recomputedWorkspaceId = computeWorkspaceId(base, bv.receipts);
    idOk = recomputedWorkspaceId === workspace.workspaceId;
    if (!idOk) mismatch('workspaceId', recomputedWorkspaceId, workspace.workspaceId);
  } else {
    mismatch('workspaceId', 'recomputable from baseOffer + base receipts', 'baseOffer or base receipts invalid');
  }

  const verified = schemaOk && arithmeticOk && receiptHashesOk && idOk;
  return {
    status: verified ? 'verified' : 'verification_failed',
    workspaceId: typeof workspace.workspaceId === 'string' ? workspace.workspaceId : null,
    schemaOk, arithmeticOk, receiptHashesOk, recomputedWorkspaceId, mismatches,
  };
}

// Every step endpoint validates the workspace FIRST and refuses 400 on
// verification failure. Returns the verification report when verified.
export function requireVerified(workspace, step, opts) {
  const report = verifyWorkspace(workspace, opts);
  if (report.malformed) throw invalidInput('workspace must be a JSON object');
  if (report.status !== 'verified') {
    throw invalidInput(`workspace verification failed for step ${step}: ${report.mismatches.map((m) => m.field).join(', ')}`);
  }
  return report;
}

export function stepRefusal(step, code, message, detail) {
  return { status: 'step_refused', step, error: { code, message }, detail, priorStepsIntact: true, writesNothing: true };
}

function stepEnvelope(step, workspace, report, result, receipts) {
  return {
    status: 'ok', step, workspaceId: workspace.workspaceId,
    verification: { schemaOk: report.schemaOk, arithmeticOk: report.arithmeticOk, receiptHashesOk: report.receiptHashesOk },
    result, receipts, recordedAt: new Date().toISOString(),
  };
}

function baseNumbers(workspace) {
  const base = workspace.baseOffer;
  const cost = base.variableCostProvided ? (base.variableCost ?? 0) : 0;
  return { base, cost, net: base.ticketPrice - cost };
}

function derivedFrom(workspace) {
  return { recordedAt: workspace.baseVerdict.recordedAt, receiptCount: workspace.baseVerdict.receipts.length };
}

function capacityView(verdictCapacity) {
  return {
    value: verdictCapacity.value ?? null,
    source: verdictCapacity.source ?? null,
    state: verdictCapacity.state ?? 'unknown',
    cause: verdictCapacity.cause ?? null,
  };
}

// --- Step 3 (pure): renegotiation ---------------------------------------
export function computeRenegotiation(workspace, stepInput, opts) {
  const report = requireVerified(workspace, 'renegotiation', opts);
  if (!isObj(stepInput)) throw invalidInput('stepInput must be an object');
  const { base, cost, net } = baseNumbers(workspace);
  if (net <= 0) throw invalidInput('net per-ticket contribution must be positive');
  let target;
  let targetSource;
  let targetLabel = null;
  if (stepInput.targetTickets !== undefined && stepInput.targetTickets !== null) {
    if (!Number.isInteger(stepInput.targetTickets) || stepInput.targetTickets <= 0) throw invalidInput('targetTickets must be an integer > 0');
    target = stepInput.targetTickets;
    targetSource = 'promoter-supplied';
    targetLabel = 'promoter-supplied target, not Ticketmaster-verified';
  } else if (base.capacity !== null && base.capacity !== undefined) {
    target = base.capacity;
    targetSource = 'known capacity';
  } else {
    throw invalidInput('targetTickets is required when capacity is unknown — the server will not invent a target');
  }
  const costNote = base.variableCostProvided ? null : 'before variable costs';
  if (base.guarantee === 0) {
    return stepEnvelope('renegotiation', workspace, report, {
      targetTickets: target, targetSource, targetLabel,
      note: 'no guarantee — break-even is already 0 tickets; no lever applies',
      levers: null, costNote, baseRef: derivedFrom(workspace), derivedFrom: derivedFrom(workspace),
    }, []);
  }
  const lowerValue = target * net;
  const exactPrice = cost + base.guarantee / target;
  const higherValue = Math.ceil(exactPrice * 100 - 1e-9) / 100;
  const levers = {
    lowerGuarantee: { value: lowerValue, reduction: base.guarantee - lowerValue, holdsFixed: 'holding price and costs fixed', costNote },
    higherPrice: {
      value: higherValue, increase: higherValue - base.ticketPrice,
      holdsFixed: 'holding guarantee and costs fixed', costNote,
      roundingRule: 'rounded up to the smallest currency unit (cent) — any price below the exact value fails to cover the guarantee at the target tickets',
    },
    differentCity: {
      lever: 'different_city',
      action: 'run routing (§3.4) for candidate cities, then a replacement (§3.2) or comparison (§3.6) run for the chosen city',
      costNote,
    },
  };
  return stepEnvelope('renegotiation', workspace, report, {
    targetTickets: target, targetSource, targetLabel, levers, costNote,
    baseRef: derivedFrom(workspace), derivedFrom: derivedFrom(workspace),
  }, []);
}

// --- Step 5 (pure): budget envelope --------------------------------------
export function computeEnvelope(workspace, stepInput, opts) {
  const report = requireVerified(workspace, 'envelope', opts);
  if (!isObj(stepInput)) throw invalidInput('stepInput must be an object');
  const hasMax = stepInput.maxGuarantee !== undefined && stepInput.maxGuarantee !== null;
  const hasTarget = stepInput.targetTickets !== undefined && stepInput.targetTickets !== null;
  if (hasMax === hasTarget) throw invalidInput('envelope takes exactly one of maxGuarantee / targetTickets');
  const { base, net } = baseNumbers(workspace);
  if (net <= 0) throw invalidInput('net per-ticket contribution must be positive');
  const costNote = base.variableCostProvided ? null : 'before variable costs';
  const capacityState = base.capacity === null || base.capacity === undefined ? 'unknown' : 'known';
  if (hasMax) {
    const m = stepInput.maxGuarantee;
    if (!isFiniteNum(m) || m < 0) throw invalidInput('maxGuarantee must be a number >= 0');
    const ticketsNeeded = m === 0 ? 0 : Math.ceil(m / net);
    const fits = capacityState === 'known' ? ticketsNeeded <= base.capacity : null;
    const note = capacityState === 'known'
      ? (fits ? 'fits within the known capacity' : 'Cannot break even in this room at this guarantee')
      : 'room fit unknown — capacity unknown';
    return stepEnvelope('envelope', workspace, report, {
      input: { kind: 'maxGuarantee', value: m }, ticketsNeeded, net, fits, capacityState,
      capacity: base.capacity ?? null, note, costNote,
      baseRef: derivedFrom(workspace), derivedFrom: derivedFrom(workspace),
    }, []);
  }
  const t = stepInput.targetTickets;
  if (!Number.isInteger(t) || t <= 0) throw invalidInput('targetTickets must be an integer > 0');
  const maxAffordableGuarantee = t * net;
  const fits = capacityState === 'known' ? t <= base.capacity : null;
  const note = capacityState === 'known'
    ? (fits ? 'fits within the known capacity' : 'target exceeds the known capacity')
    : 'room fit unknown — capacity unknown';
  return stepEnvelope('envelope', workspace, report, {
    input: { kind: 'targetTickets', value: t }, maxAffordableGuarantee, net, fits, capacityState,
    capacity: base.capacity ?? null, note, costNote,
    baseRef: derivedFrom(workspace), derivedFrom: derivedFrom(workspace),
  }, []);
}

// --- Settlement (pure, spec §5) -------------------------------------------
export function computeSettlement(workspace, stepInput, opts) {
  const report = requireVerified(workspace, 'settle', opts);
  if (!isObj(stepInput)) throw invalidInput('stepInput must be an object');
  const attendance = stepInput.actualAttendance;
  if (!Number.isInteger(attendance) || attendance < 0) throw invalidInput('actualAttendance must be an integer >= 0');
  let actualCost = null;
  if (stepInput.actualVariableCostPerTicket !== undefined && stepInput.actualVariableCostPerTicket !== null) {
    if (!isFiniteNum(stepInput.actualVariableCostPerTicket) || stepInput.actualVariableCostPerTicket < 0) throw invalidInput('actualVariableCostPerTicket must be a number >= 0');
    actualCost = stepInput.actualVariableCostPerTicket;
  }
  if (stepInput.note !== undefined && stepInput.note !== null && typeof stepInput.note !== 'string') throw invalidInput('note must be a string');
  const { base, cost } = baseNumbers(workspace);
  const netSettled = base.ticketPrice - (actualCost ?? cost);
  const breakEvenTickets = workspace.baseVerdict.tickets;
  const gapTickets = attendance - breakEvenTickets;
  const covered = gapTickets >= 0;
  const moneyGap = attendance * netSettled - base.guarantee;
  const assessment = covered
    ? 'reported sales met the recorded break-even threshold'
    : `reported sales missed the recorded break-even threshold by ${-gapTickets} tickets ($${-moneyGap} at the settled net)`;
  const flags = [];
  if (base.capacity !== null && base.capacity !== undefined && attendance > base.capacity) {
    flags.push('reported attendance exceeds recorded capacity — check the count');
  }
  const result = {
    actualAttendance: attendance,
    actualVariableCostPerTicket: actualCost,
    sourceLabel: 'promoter-reported, unverified',
    breakEvenTickets, gapTickets, covered, moneyGap, netSettled, assessment, flags,
    costNote: (!base.variableCostProvided && actualCost === null) ? 'before variable costs' : null,
    note: typeof stepInput.note === 'string' ? stepInput.note : null,
    recordedAt: new Date().toISOString(),
    baseRef: derivedFrom(workspace), derivedFrom: derivedFrom(workspace),
    proves: SETTLEMENT_PROVES,
    doesNotProve: SETTLEMENT_DOES_NOT_PROVE,
  };
  // Append-only: a second settlement points back at the entry it corrects
  // (client appends; the server never overwrites the earlier entry).
  const prior = Array.isArray(workspace.steps?.settlements) ? workspace.steps.settlements : [];
  if (prior.length > 0 && typeof prior[prior.length - 1]?.recordedAt === 'string') {
    result.corrects = prior[prior.length - 1].recordedAt;
  }
  return stepEnvelope('settlement', workspace, report, result, []);
}

// --- Step 2 (live): replacement re-price ----------------------------------
const FORBIDDEN_REPLACEMENT_TERMS = ['guarantee', 'ticketPrice', 'variableCost', 'capacity', 'venue', 'city'];

export async function runReplacement(workspace, stepInput, deps, { visitorIp } = {}) {
  const report = requireVerified(workspace, 'replacement');
  if (!isObj(stepInput)) throw invalidInput('stepInput must be an object');
  const replacementArtist = typeof stepInput.replacementArtist === 'string' ? stepInput.replacementArtist.trim() : '';
  if (!replacementArtist) throw invalidInput('replacementArtist is required');
  for (const term of FORBIDDEN_REPLACEMENT_TERMS) {
    if (Object.prototype.hasOwnProperty.call(stepInput, term)) {
      throw invalidInput(`commercial terms are carried from baseOffer and are not re-enterable in a replacement: ${term}`);
    }
  }
  if (stepInput.entityHint !== undefined && stepInput.entityHint !== null && typeof stepInput.entityHint !== 'string') {
    throw invalidInput('entityHint must be a string');
  }
  const { base } = baseNumbers(workspace);
  const verdict = await runVerdict({
    artist: replacementArtist,
    city: base.city,
    guarantee: base.guarantee,
    ticketPrice: base.ticketPrice,
    variableCost: base.variableCostProvided ? base.variableCost : undefined,
    capacity: base.capacity ?? undefined,
    venue: base.venue ?? undefined,
    entityHint: stepInput.entityHint,
    visitorIp,
  }, deps);
  if (verdict.status !== 'verdict') {
    const refusal = stepRefusal('replacement', verdict.status === 'verdict_withheld' ? 'VERDICT_WITHHELD' : verdict.status === 'price_unknown' ? 'PRICE_UNKNOWN' : 'NEEDS_INPUT', verdict.message || 'replacement run did not produce a verdict', `replacement run ${verdict.status}`);
    if (Array.isArray(verdict.missingLegs)) refusal.missingLegs = verdict.missingLegs;
    return refusal;
  }
  const tickets = verdict.breakEven.tickets;
  const net = verdict.breakEven.net;
  const deltaTickets = tickets - workspace.baseVerdict.tickets;
  const result = {
    replacementArtist,
    baseTickets: workspace.baseVerdict.tickets,
    tickets, net,
    verdict: verdict.breakEven.verdict,
    capacity: capacityView(verdict.capacity),
    deltaTickets,
    deltaDirection: deltaTickets < 0 ? 'fewer' : (deltaTickets > 0 ? 'more' : 'same'),
    deltaMoney: deltaTickets * net,
    deltaMoneyLabel: DELTA_MONEY_LABEL,
    audience: verdict.audience,
    openers: verdict.openers,
    missTrial: verdict.missTrial ?? null,
    legs: verdict.legs,
    receipts: verdict.receipts || [],
  };
  return stepEnvelope('replacement', workspace, report, result, verdict.receipts || []);
}

// --- Step 4 (live): routing -----------------------------------------------
function itemIdOf(item) {
  if (!item || typeof item !== 'object') return null;
  return item.entity_id ?? item.id ?? item.uuid ?? null;
}
function itemNameOf(item) {
  if (!item || typeof item !== 'object') return null;
  return item.name ?? item.properties?.name ?? null;
}

export async function runRouting(workspace, stepInput, deps, { visitorIp } = {}) {
  const report = requireVerified(workspace, 'routing');
  if (!isObj(stepInput) || !Array.isArray(stepInput.candidateCities)) throw invalidInput('candidateCities must be an array of 1–10 city strings');
  const raw = stepInput.candidateCities;
  if (raw.length < 1 || raw.length > 10) throw invalidInput('candidateCities must contain 1–10 cities');
  const seen = new Set();
  const candidates = [];
  for (const c of raw) {
    if (typeof c !== 'string' || !c.trim()) throw invalidInput('each candidate city must be a non-empty string');
    const city = c.trim();
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(city);
  }
  const baseCityKey = workspace.baseOffer.city.trim().toLowerCase();
  if (candidates.some((c) => c.toLowerCase() === baseCityKey)) {
    throw invalidInput('the base city is excluded from routing candidates — routing it to itself is not "where next"');
  }
  // Headliner ref, ID-first (Gap-3 rule): a resolved ID from the base run
  // when one is carried (explicit field, else the headliner describe
  // receipt's ordered IDs); otherwise the base artist string, labelled.
  let headlinerRef = null;
  let headlinerByName = false;
  if (typeof workspace.baseVerdict.headlinerId === 'string' && workspace.baseVerdict.headlinerId) {
    headlinerRef = workspace.baseVerdict.headlinerId;
  } else {
    const describeReceipt = (workspace.baseVerdict.receipts || []).find((r) => r.operation === 'qloo_describe' && Array.isArray(r.ids) && r.ids.length > 0);
    if (describeReceipt) headlinerRef = describeReceipt.ids[0];
  }
  if (!headlinerRef) { headlinerRef = workspace.baseOffer.artist; headlinerByName = true; }

  if (visitorIp && typeof deps.checkVisitor === 'function') deps.checkVisitor(visitorIp);
  const ranked = [];
  const unranked = [];
  const newReceipts = [];
  // Sequential, never fanned out: receipt order stays deterministic and
  // guard accounting stays legible. A failed FIRST candidate call is the
  // Qloo-down signal (whole-step refusal); later failures are per-candidate
  // unranked rows. Any guard trip, before or during, refuses the whole step.
  for (let i = 0; i < candidates.length; i += 1) {
    if (typeof deps.isCancelled === 'function' && deps.isCancelled()) {
      const err = new Error('routing cancelled — client disconnected');
      err.cancelled = true;
      throw err;
    }
    const city = candidates[i];
    const args = { entity: headlinerRef, within: city, limit: 10 };
    let env;
    try {
      if (typeof deps.checkCall === 'function') deps.checkCall();
      env = await deps.mcpCall('qloo_where_popular', args);
    } catch (e) {
      if (isGuardTrip(e) || ['NOT_CONFIGURED', 'QLOO_AUTH', 'QUOTA_FLOOR', 'RUN_CAP', 'VISITOR_CAP'].includes(e?.code) || i === 0) throw e;
      unranked.push({ city, rank: null, status: 'error', reason: e.message || 'call failed', label: 'unranked: no live evidence', receiptRef: null });
      continue;
    }
    const results = Array.isArray(env?.results) ? env.results : [];
    if (env?.status === 'ok' && results.length > 0) {
      const areas = results.slice(0, 10).map((r) => ({ id: itemIdOf(r), name: itemNameOf(r) })).filter((a) => a.id || a.name);
      let receiptRef = null;
      if (!deps.receipts || typeof deps.receipts.add !== 'function') {
        receiptRef = {
          claim: `where the headliner is popular in ${city}`,
          operation: 'qloo_where_popular',
          requestHash: argsHashFor('qloo_where_popular', args),
          requestId: env.requestId ?? null,
          resultCount: results.length,
          ids: areas.map((a) => a.id).filter(Boolean),
          entityIds: areas.map((a) => a.id).filter(Boolean),
          replay: { kind: 'mcp', tool: 'qloo_where_popular', args },
        };
        newReceipts.push(receiptRef);
      } else {
        const rec = deps.receipts.add({
          claim: `where the headliner is popular in ${city}`,
          operation: 'qloo_where_popular',
          hashKind: 'args',
          requestHash: argsHashFor('qloo_where_popular', args),
          requestId: env.requestId ?? null,
          resultCount: results.length,
          ...(areas.map((a) => a.id).filter(Boolean).length > 0 ? { ids: areas.map((a) => a.id).filter(Boolean), entityIds: areas.map((a) => a.id).filter(Boolean) } : {}),
          replay: { kind: 'mcp', tool: 'qloo_where_popular', args },
        });
        receiptRef = {
          claim: rec.claim, operation: rec.operation, requestHash: rec.requestHash,
          requestId: rec.requestId ?? null, resultCount: rec.resultCount ?? null,
          ...(rec.ids ? { ids: rec.ids, entityIds: rec.entityIds } : {}),
          replay: rec.replay,
        };
        newReceipts.push(receiptRef);
      }
      ranked.push({ city, matchedAreasCount: areas.length, areas, status: 'ok', receiptRef });
    } else {
      const status = env?.status === 'empty' ? 'empty' : (env?.status === 'partial' || env?.status === 'degraded' ? 'partial' : 'error');
      unranked.push({
        city, rank: null, status,
        reason: (typeof env?.summary === 'string' && env.summary) || 'no data for this entity/region',
        label: 'unranked: no live evidence', receiptRef: null,
      });
    }
  }
  // Rank by matched-area COUNT, tie-broken by Qloo return order — which,
  // with sequential calls in submission order and a stable sort, is the
  // submission order among ties. Unranked rows carry NO rank number.
  ranked.sort((a, b) => b.matchedAreasCount - a.matchedAreasCount);
  ranked.forEach((row, idx) => { row.rank = idx + 1; });
  const result = {
    headliner: workspace.baseOffer.artist,
    headlinerRefKind: headlinerByName ? 'name' : 'id',
    headlinerRefLabel: headlinerByName ? 'headliner by name — ID not resolved in the base run' : null,
    candidates: [...ranked, ...unranked],
    label: ROUTING_LABEL,
    note: ROUTING_NOTE,
  };
  return stepEnvelope('routing', workspace, report, result, newReceipts);
}

// --- Step 6 (live): multi-offer comparison ---------------------------------
// Comparison rows carry the miss trial WITHOUT its question field: the
// pipeline's fixed question text contains the word "best" ("best opening
// act"), and the comparison response must contain no "winner"/"best"
// string anywhere (spec §3.6). The trial itself (picks + misses) is kept
// in full; only the question sentence is omitted from these rows. The
// full trial still travels on the verdict and replacement rows.
function trialView(trial) {
  if (!trial) return null;
  return {
    graphPick: trial.graphPick ?? null,
    gutPick: trial.gutPick ?? null,
    webPick: trial.webPick ?? null,
    misses: trial.misses ?? [],
    recordedAt: trial.recordedAt ?? null,
  };
}
function normalizedOfferTerms(offer) {
  return {
    artist: offer.artist.trim().toLowerCase(),
    city: offer.city.trim().toLowerCase(),
    guarantee: offer.guarantee,
    ticketPrice: offer.ticketPrice ?? null,
    variableCost: offer.variableCost ?? null,
    variableCostProvided: typeof offer.variableCost === 'number',
    capacity: offer.capacity ?? null,
    venue: typeof offer.venue === 'string' ? offer.venue.trim().toLowerCase() : null,
  };
}

export async function runComparison(workspace, stepInput, makeDeps, { checkVisitor, visitorIp, isCancelled } = {}) {
  const report = requireVerified(workspace, 'comparison');
  if (!isObj(stepInput) || !Array.isArray(stepInput.offers)) throw invalidInput('offers must be an array of 1–5 offers');
  const offers = stepInput.offers;
  if (offers.length < 1 || offers.length > 5) throw invalidInput('comparison takes 1–5 offers per request');
  for (const o of offers) {
    if (!isObj(o)) throw invalidInput('each offer must be an object');
    if (!isNonEmptyStr(o.artist)) throw invalidInput('each offer requires an artist');
    if (!isNonEmptyStr(o.city)) throw invalidInput('each offer requires a city');
    if (!isFiniteNum(o.guarantee) || o.guarantee < 0) throw invalidInput('each offer guarantee must be a number >= 0');
    if (!(o.ticketPrice === undefined || o.ticketPrice === null || (isFiniteNum(o.ticketPrice) && o.ticketPrice > 0))) throw invalidInput('each offer ticketPrice must be a number > 0');
    if (!(o.variableCost === undefined || o.variableCost === null || (isFiniteNum(o.variableCost) && o.variableCost >= 0))) throw invalidInput('each offer variableCost must be a number >= 0');
    if (!(o.capacity === undefined || o.capacity === null || (isFiniteNum(o.capacity) && o.capacity > 0))) throw invalidInput('each offer capacity must be a number > 0');
    if (!(o.venue === undefined || o.venue === null || typeof o.venue === 'string')) throw invalidInput('each offer venue must be a string');
  }
  const baseNorm = normalizedOfferTerms({
    artist: workspace.baseOffer.artist, city: workspace.baseOffer.city,
    guarantee: workspace.baseOffer.guarantee, ticketPrice: workspace.baseOffer.ticketPrice,
    variableCost: workspace.baseOffer.variableCostProvided ? workspace.baseOffer.variableCost : null,
    capacity: workspace.baseOffer.capacity, venue: workspace.baseOffer.venue,
  });
  for (const o of offers) {
    const norm = normalizedOfferTerms(o);
    if (JSON.stringify(norm) === JSON.stringify(baseNorm)) {
      throw invalidInput('an offer identical to the base offer is not a comparison — re-running the same offer is rejected as a duplicate');
    }
  }
  if (typeof checkVisitor === 'function' && visitorIp) checkVisitor(visitorIp);

  // Base row 0: from the verified base verdict, NEVER re-run.
  const baseRow = {
    offerIndex: 0,
    artist: workspace.baseOffer.artist,
    city: workspace.baseOffer.city,
    guarantee: workspace.baseOffer.guarantee,
    ticketPrice: { value: workspace.baseOffer.ticketPrice, source: 'recorded base verdict' },
    net: workspace.baseVerdict.net,
    tickets: workspace.baseVerdict.tickets,
    verdict: workspace.baseVerdict.verdict,
    capacity: {
      value: workspace.baseOffer.capacity ?? null,
      source: workspace.baseOffer.capacitySource ?? null,
      state: workspace.baseVerdict.capacityState,
      cause: workspace.baseVerdict.capacityCause ?? null,
    },
    openers: { topPick: workspace.baseVerdict.openers.topPick },
    missTrial: trialView(workspace.baseVerdict.missTrial ?? null),
    receipts: [],
    receiptCount: workspace.baseVerdict.receipts.length,
    baseRecordedAt: workspace.baseVerdict.recordedAt,
    status: 'verdict',
  };

  const verdictRows = [];
  const refusedRows = [];
  const allReceipts = [];
  const isWholeStepFailure = (e) => ['NOT_CONFIGURED', 'QLOO_AUTH', 'QUOTA_FLOOR', 'RUN_CAP', 'VISITOR_CAP'].includes(e?.code) || isGuardTrip(e);
  for (let i = 0; i < offers.length; i += 1) {
    const offer = offers[i];
    const offerIndex = i + 1;
    if (typeof isCancelled === 'function' && isCancelled()) {
      const err = new Error('comparison cancelled — client disconnected');
      err.cancelled = true;
      throw err;
    }
    const made = await makeDeps(offer);
    const deps = made && made.deps ? made.deps : made;
    const close = made && typeof made.close === 'function' ? made.close : null;
    let verdict;
    try {
      verdict = await runVerdict({
        artist: offer.artist.trim(),
        city: offer.city.trim(),
        guarantee: offer.guarantee,
        ticketPrice: offer.ticketPrice ?? undefined,
        variableCost: offer.variableCost ?? undefined,
        capacity: offer.capacity ?? undefined,
        venue: offer.venue ?? undefined,
      }, deps);
    } catch (e) {
      if (close) close();
      // A failure before ANY offer has completed refuses the whole step;
      // once rows exist, a failure refuses only that row.
      if (verdictRows.length === 0 && refusedRows.length === 0 && isWholeStepFailure(e)) throw e;
      refusedRows.push({ offerIndex, artist: offer.artist.trim(), city: offer.city.trim(), status: 'refused', refusal: { code: e.code || 'QLOO_ERROR', reason: e.message || 'offer run failed' } });
      continue;
    }
    if (close) close();
    if (verdict.cancelled) {
      const err = new Error('comparison cancelled — client disconnected');
      err.cancelled = true;
      throw err;
    }
    if (typeof isCancelled === 'function' && isCancelled()) {
      const err = new Error('comparison cancelled — client disconnected');
      err.cancelled = true;
      throw err;
    }
    if (verdict.status === 'verdict') {
      verdictRows.push({
        offerIndex,
        artist: verdict.artist,
        city: verdict.city,
        guarantee: verdict.guarantee,
        ticketPrice: { value: verdict.breakEven.price.value, source: verdict.breakEven.price.source },
        net: verdict.breakEven.net,
        tickets: verdict.breakEven.tickets,
        verdict: verdict.breakEven.verdict,
        capacity: capacityView(verdict.capacity),
        openers: { topPick: verdict.openers.topPick },
        missTrial: trialView(verdict.missTrial ?? null),
        receipts: verdict.receipts || [],
        status: 'verdict',
      });
      allReceipts.push(...(verdict.receipts || []));
    } else {
      const code = verdict.status === 'verdict_withheld' ? 'VERDICT_WITHHELD' : verdict.status === 'price_unknown' ? 'PRICE_UNKNOWN' : 'NEEDS_INPUT';
      const row = { offerIndex, artist: offer.artist.trim(), city: offer.city.trim(), status: 'refused', refusal: { code, reason: verdict.message || `offer run ${verdict.status}` } };
      if (Array.isArray(verdict.missingLegs)) row.refusal.missingLegs = verdict.missingLegs;
      refusedRows.push(row);
    }
  }
  if (typeof isCancelled === 'function' && isCancelled()) {
    const err = new Error('comparison cancelled — client disconnected');
    err.cancelled = true;
    throw err;
  }
  // Base stays row 0 (the anchor); the comparison rows sort by tickets
  // ascending; refused rows (no numbers) follow in submission order.
  verdictRows.sort((a, b) => a.tickets - b.tickets);
  const result = { rows: [baseRow, ...verdictRows, ...refusedRows], sortNote: COMPARE_SORT_NOTE };
  return stepEnvelope('comparison', workspace, report, result, allReceipts);
}
