// OfferSheet deal workspace — client-held workspace (spec 03 §1).
// The workspace object lives in localStorage + JSON export/import. The
// server holds nothing between requests. A step result is merged ONLY
// when its response has status 'ok'; a step_refused response is shown
// and discarded, never touching prior steps. No workspace JSON is ever
// logged, and no key ever appears in the workspace object.
// Parent hook point (parent integration job, NOT wired here): after
// renderVerdict(v) in app.js, call OfferSheetWorkspace.seed(v).
(function () {
  'use strict';
  var KEY = 'offersheet-workspace-v1';
  var SETTLE_PROVES = 'What this check proves: whether the promoter-reported attendance reached the ticket threshold computed from the recorded guarantee, price, and costs. That is an arithmetic comparison between a recorded threshold and a reported outcome.';
  var SETTLE_NOT_PROVES = 'What this check does NOT prove: that Qloo affinity caused the sales; that affinity predicts sales; that this verdict method will be right next time; or that any other show will behave the same way. One settled show is one data point about one threshold, not validation of a prediction method. Affinity data describes taste match; it has never been a sales forecast in this product, and this check does not turn it into one.';
  var SORT_NOTE = 'Sorted by tickets needed to break even. This is not a ranking of which offer will succeed.';
  // Phase 3 (S6, copy only): season-ledger framing for the workspace UI.
  // No new behaviour, no new numbers, no new features — the same steps,
  // read as a season: offers, routing, then settlement.
  var SEASON_LEDGER_LINE = 'Season ledger: offers, routing, then settlement — the same workspace, read as a season, using only the steps already here.';
  var ROUTE_LABEL = 'affinity-ranked, not demand-proven';
  var ROUTE_NOTE = 'Ranking reflects how many areas Qloo matched for this headliner in each city. It is not a sales forecast, not an attendance estimate, and not evidence of sales.';
  var DELTA_LABEL = 'arithmetic on the two break-evens at the recorded net — not a forecast of money made or lost';
  var FIXED_KEYS = [
    ['roomCost', 'venue cost'],
    ['productionCost', 'production cost'],
    ['marketingCost', 'marketing cost'],
    ['otherFixedCosts', 'other fixed costs'],
    ['sponsorOffset', 'sponsor offset']
  ];
  var mismatchKeys = new Set();
  var compareCount = 1;
  // In-flight guard for Compare: setBusy() alone only disables a DOM
  // button, and render() rebuilds that button on every panel re-render,
  // so a second submit during a long compare flight used to start a
  // second server run. This flag survives re-renders; the handler below
  // refuses a second submit while it is set, and clears it on every
  // settle path (ok, refused, unavailable, or failed) next to setBusy().
  var compareInFlight = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(n) {
    return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('en-US') : '—';
  }
  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function money2(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function isoNow() { return new Date().toISOString(); }
  function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }
  function numVal(id) {
    var el = $(id); if (!el || el.value === '') return null;
    var n = Number(el.value); return isFinite(n) ? n : null;
  }
  function strVal(id) {
    var el = $(id); return el ? el.value.trim() : '';
  }

  // ---- persistence ----
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!isValidWorkspaceShape(o)) return null;
      return o;
    } catch (e) { return null; }
  }
  // ---- import/load shape validation (fail-closed) ----
  // Render() dereferences nested arrays and property chains (.map on
  // receipts, areas, ranked/candidates, flags, and step lists;
  // baseVerdict.openers.ranked, baseVerdict.audience.areas). A workspace
  // that passed the old top-level check (version + baseOffer presence)
  // but broke one of those dereferences used to be SAVED over the good
  // workspace and then throw on every page load, bricking the panel (no
  // Clear button renders once render() aborts). This validator checks
  // every shape render() depends on BEFORE any assign/save: a malformed
  // import is rejected with the prior workspace untouched, and a malformed
  // stored workspace loads as "no workspace" (left inert in storage,
  // recoverable by seeding a new verdict) instead of throwing. It is a
  // render-safety gate, not server verification — the Verify button still
  // owns schema + arithmetic + receipt-hash verification.
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isStr(v) { return typeof v === 'string'; }
  function isNonEmptyStr(v) { return typeof v === 'string' && v.trim().length > 0; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isValidWorkspaceShape(o) {
    if (!isObj(o)) return false;
    if (o.workspaceVersion !== 1) return false;
    if (o.workspaceId !== undefined && !isStr(o.workspaceId)) return false;
    var b = o.baseOffer;
    if (!isObj(b)) return false;
    if (!isNonEmptyStr(b.artist) || !isNonEmptyStr(b.city)) return false;
    if (!isNum(b.guarantee) || b.guarantee < 0) return false;
    if (!(b.ticketPrice === null || b.ticketPrice === undefined || (isNum(b.ticketPrice) && b.ticketPrice > 0))) return false;
    if (!(b.variableCost === null || b.variableCost === undefined || (isNum(b.variableCost) && b.variableCost >= 0))) return false;
    if (typeof b.variableCostProvided !== 'boolean') return false;
    if (!(b.capacity === null || b.capacity === undefined || (isNum(b.capacity) && b.capacity > 0))) return false;
    if (!(b.venue === null || b.venue === undefined || isStr(b.venue))) return false;
    if (!(b.capacitySource === null || b.capacitySource === undefined || isStr(b.capacitySource))) return false;
    for (var fi = 0; fi < FIXED_KEYS.length; fi++) {
      var fv = b[FIXED_KEYS[fi][0]];
      if (fv === undefined || fv === null) continue;
      if (!isNum(fv) || fv < 0) return false;
    }
    var bv = o.baseVerdict;
    if (bv !== null && bv !== undefined) {
      if (!isObj(bv)) return false;
      if (!Number.isInteger(bv.tickets) || bv.tickets < 0) return false;
      if (!isNum(bv.net)) return false;
      if (!(bv.verdict === null || bv.verdict === undefined || isStr(bv.verdict))) return false;
      if (!(bv.capacityState === 'known' || bv.capacityState === 'unknown')) return false;
      if (!isStr(bv.recordedAt)) return false;
      if (!Array.isArray(bv.receipts)) return false;
      if (!isObj(bv.audience) || !Array.isArray(bv.audience.areas) || !isNum(bv.audience.areasCount)) return false;
      if (!isObj(bv.openers) || !Array.isArray(bv.openers.ranked) || !Array.isArray(bv.openers.candidates)) return false;
      if (!(bv.openers.topPick === null || bv.openers.topPick === undefined || isStr(bv.openers.topPick))) return false;
      if (bv.missTrial !== null && bv.missTrial !== undefined) {
        if (!isObj(bv.missTrial)) return false;
        if (bv.missTrial.misses !== undefined && !Array.isArray(bv.missTrial.misses)) return false;
      }
    }
    // Steps is required as an object: render() reads ws.steps.* (header
    // settlement status, all panels) without a missing-steps guard, and
    // every producer — seed, edit-base, import normalisation — writes
    // steps, so requiring it rejects nothing legitimate. The import
    // normalisation below stays as defense-in-depth for the in-memory
    // object, even though validation already guarantees steps exists.
    var st = o.steps;
    if (!isObj(st)) return false;
    if (st.replacements !== undefined && !Array.isArray(st.replacements)) return false;
    if (st.settlements !== undefined && !Array.isArray(st.settlements)) return false;
    if (st.renegotiation !== undefined && st.renegotiation !== null && !isObj(st.renegotiation)) return false;
    if (st.routing !== undefined && st.routing !== null && !isObj(st.routing)) return false;
    if (st.envelope !== undefined && st.envelope !== null && !isObj(st.envelope)) return false;
    if (st.comparison !== undefined && st.comparison !== null && !isObj(st.comparison)) return false;
    var reps = st.replacements || [];
    for (var i = 0; i < reps.length; i++) {
      if (!isObj(reps[i])) return false;
      var rr = reps[i].result || reps[i];
      if (!isObj(rr)) return false;
      if (rr.receipts !== undefined && !Array.isArray(rr.receipts)) return false;
      if (reps[i].receipts !== undefined && !Array.isArray(reps[i].receipts)) return false;
      if (rr.missTrial !== null && rr.missTrial !== undefined
        && (!isObj(rr.missTrial) || (rr.missTrial.misses !== undefined && !Array.isArray(rr.missTrial.misses)))) return false;
    }
    var settles = st.settlements || [];
    for (var j = 0; j < settles.length; j++) {
      if (!isObj(settles[j])) return false;
      var sr = settles[j].result || settles[j];
      if (!isObj(sr)) return false;
      if (sr.flags !== undefined && !Array.isArray(sr.flags)) return false;
    }
    var routing = st.routing ? (st.routing.result || st.routing) : null;
    if (routing && routing.candidates !== undefined) {
      if (!Array.isArray(routing.candidates)) return false;
      for (var k = 0; k < routing.candidates.length; k++) {
        if (!isObj(routing.candidates[k])) return false;
        if (routing.candidates[k].areas !== undefined && !Array.isArray(routing.candidates[k].areas)) return false;
        if (routing.candidates[k].receipts !== undefined && !Array.isArray(routing.candidates[k].receipts)) return false;
      }
    }
    var comp = st.comparison ? (st.comparison.result || st.comparison) : null;
    if (comp && comp.rows !== undefined) {
      if (!Array.isArray(comp.rows)) return false;
      for (var m = 0; m < comp.rows.length; m++) {
        if (!isObj(comp.rows[m])) return false;
        if (comp.rows[m].receipts !== undefined && !Array.isArray(comp.rows[m].receipts)) return false;
      }
    }
    return true;
  }
  function save() {
    try { if (ws) localStorage.setItem(KEY, JSON.stringify(ws)); } catch (e) { /* storage full: export still works */ }
  }
  var ws = load();

  // ---- workspace id: sha256 of canonical base + sorted receipt hashes ----
  function canonicalBase(b) {
    var o = {
      artist: (b.artist || '').trim().toLowerCase(),
      city: (b.city || '').trim().toLowerCase(),
      venue: b.venue ? String(b.venue).trim().toLowerCase() : null,
      guarantee: b.guarantee, ticketPrice: b.ticketPrice,
      variableCost: b.variableCost, variableCostProvided: !!b.variableCostProvided,
      capacity: b.capacity, capacitySource: b.capacitySource || null
    };
    ['roomCost', 'productionCost', 'marketingCost', 'otherFixedCosts', 'sponsorOffset'].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    });
    // Sorted-key order, matching the server's canonicalBaseOffer exactly:
    // JSON.stringify preserves insertion order, so the fixed field order
    // above would hash differently from the server and every browser-seeded
    // workspace would fail server verification (found by integration judge).
    var sorted = {};
    Object.keys(o).sort().forEach(function (k) { sorted[k] = o[k]; });
    return JSON.stringify(sorted);
  }
  function simpleHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= str.charCodeAt(i); h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }
  async function sha256Hex(str) {
    try {
      if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* fall through to deterministic fallback */ }
    return simpleHash(str);
  }
  async function computeId(baseOffer, receipts) {
    var hashes = (receipts || []).map(function (r) { return r.requestHash || ''; }).filter(Boolean).sort();
    return sha256Hex(canonicalBase(baseOffer) + '|' + hashes.join(','));
  }

  // ---- seeding: ONLY status 'verdict' ----
  function seedRejection(v) {
    var st = v && v.status;
    if (st === 'verdict_withheld') return 'Workspace not seeded: verdict withheld — evidence incomplete, so no break-even number exists to seed from.';
    if (st === 'price_unknown') return 'Workspace not seeded: price unknown — no break-even number exists to seed from.';
    if (st === 'needs_input') return 'Workspace not seeded: needs input — pick the entity you mean first, then run a verdict.';
    if (!v || !v.breakEven || typeof v.breakEven.tickets !== 'number') return 'Workspace not seeded: this response carries no verdict to seed from. Nothing was stored.';
    return null;
  }
  function baseOfferFromVerdict(v) {
    var be = v.breakEven || {};
    var cap = v.capacity || {};
    var known = cap.state === 'known' && typeof cap.value === 'number';
    var offer = {
      artist: v.artist || '',
      city: v.city || '',
      venue: v.venue || (v.ticketmaster && v.ticketmaster.venueName) || null,
      guarantee: v.guarantee,
      ticketPrice: be.price ? be.price.value : null,
      variableCost: (be.variableCost && be.variableCost.provided) ? be.variableCost.value : null,
      variableCostProvided: !!(be.variableCost && be.variableCost.provided),
      capacity: known ? cap.value : null,
      capacitySource: known ? (cap.source || null) : null
    };
    var fc = be.fixedCosts;
    if (fc) {
      FIXED_KEYS.forEach(function (pair) {
        var line = fc[pair[0]];
        if (line && line.entered === true && typeof line.value === 'number') offer[pair[0]] = line.value;
      });
    }
    return offer;
  }
  async function seed(v) {
    var rej = seedRejection(v);
    var note = $('wsSeedNote');
    if (rej) {
      if (note) note.innerHTML = '<p class="ws-msg ws-msg--refused">' + esc(rej) + '</p>';
      return { rejected: true, status: v ? v.status : null, message: rej };
    }
    var baseOffer = baseOfferFromVerdict(v);
    var be = v.breakEven;
    var cap = v.capacity || {};
    var receipts = Array.isArray(v.receipts) ? v.receipts : [];
    var obj = {
      workspaceVersion: 1,
      workspaceId: await computeId(baseOffer, receipts),
      baseOffer: baseOffer,
      baseVerdict: {
        tickets: be.tickets, net: be.net, verdict: be.verdict || null,
        capacityState: cap.state === 'known' ? 'known' : 'unknown',
        capacityCause: cap.cause || null,
        recordedAt: isoNow(), receipts: receipts,
        audience: { areas: (v.audience && v.audience.areas) || [], areasCount: (v.audience && typeof v.audience.areasCount === 'number') ? v.audience.areasCount : ((v.audience && v.audience.areas) || []).length },
        openers: v.openers || { ranked: [], candidates: [], topPick: null },
        missTrial: v.missTrial || null
      },
      steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] }
    };
    ws = obj; mismatchKeys = new Set(); save(); render();
    if (note) note.innerHTML = '<p class="ws-msg ws-msg--ok">Workspace seeded from the verdict for ' + esc(baseOffer.artist) + ' in ' + esc(baseOffer.city) + '.</p>';
    return clone(ws);
  }
  function get() { return clone(ws); }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    ws = null; mismatchKeys = new Set(); render();
  }

  // ---- shared rendering helpers ----
  function guaranteeLine(g) { return '<span class="ws-g">guarantee at stake: ' + money(g) + '</span>'; }
  function fixedInputsHtml(idFor, source) {
    return FIXED_KEYS.map(function (pair) {
      var val = source && typeof source[pair[0]] === 'number' ? String(source[pair[0]]) : '';
      var label = pair[1].charAt(0).toUpperCase() + pair[1].slice(1);
      return '<label>' + label + ' (USD, optional)<input id="' + idFor(pair[0]) + '" type="number" min="0" step="0.01" value="' + esc(val) + '" inputmode="decimal"></label>';
    }).join('');
  }
  function enteredFixedParts(source) {
    if (!source) return [];
    var parts = [];
    if (source.fixedCosts && typeof source.fixedCosts.totalToRecover === 'number') {
      FIXED_KEYS.forEach(function (pair) {
        var line = source.fixedCosts[pair[0]];
        if (line && line.entered === true && typeof line.value === 'number') parts.push(pair[1] + ' ' + money(line.value));
      });
      parts.push('total to recover ' + money(source.fixedCosts.totalToRecover));
      return parts;
    }
    FIXED_KEYS.forEach(function (pair) {
      if (typeof source[pair[0]] === 'number') parts.push(pair[1] + ' ' + money(source[pair[0]]));
    });
    return parts;
  }
  function applyFixedInputs(target, idFor) {
    FIXED_KEYS.forEach(function (pair) {
      var n = numVal(idFor(pair[0]));
      if (n != null) target[pair[0]] = n;
    });
    return target;
  }
  function fixedSame(a, b) {
    for (var i = 0; i < FIXED_KEYS.length; i++) {
      var k = FIXED_KEYS[i][0];
      var av = typeof a[k] === 'number' ? a[k] : null;
      var bv = typeof b[k] === 'number' ? b[k] : null;
      if (av !== bv) return false;
    }
    return true;
  }
  function costLabel() {
    return ws && ws.baseOffer && !ws.baseOffer.variableCostProvided ? ' <span class="ws-label">before variable costs</span>' : '';
  }
  function receiptBtnHtml(r, rowKey, idx) {
    if (!r || !r.replay) return '<span class="ws-label">No replay for this receipt</span>';
    return '<button type="button" class="ws-btn ws-btn--sm" data-ws-replay="' + esc(rowKey) + '|' + idx + '">Re-run this call</button>';
  }
  function receiptsHtml(receipts, rowKey) {
    if (!receipts || receipts.length === 0) return '<p class="ws-label">No receipts for this row.</p>';
    return '<ul class="ws-receipts">' + receipts.map(function (r, i) {
      var key = rowKey + '|' + i;
      var mm = mismatchKeys.has(key) ? '<span class="ws-mismatch">replay mismatch — do not rely on this row</span>' : '';
      return '<li class="ws-receipt' + (mm ? ' ws-row--mismatch' : '') + '"><span>' + esc(r.claim || r.operation || '') +
        ' · ' + esc(r.operation || '') + ' · requestId ' + esc(r.requestId == null || r.requestId === '' ? '—' : r.requestId) +
        ' · ' + esc(r.resultCount == null ? '—' : r.resultCount) + ' results</span> ' + receiptBtnHtml(r, rowKey, i) + ' ' + mm + '<span class="ws-replay-out" id="ws-replay-' + esc(rowKey) + '-' + i + '"></span></li>';
    }).join('') + '</ul>';
  }
  function missHtml(missTrial) {
    if (!missTrial) return '<p class="ws-label">no trial — arm unavailable</p>';
    var misses = missTrial.misses || [];
    if (misses.length === 0) return '<p>Miss trial recorded: no miss — the comparison picks matched the Qloo pick (' + esc(missTrial.graphPick || '') + ').</p>';
    return '<ul>' + misses.map(function (m) { return '<li>' + esc(m.arm) + ' picked ' + esc(m.pick) + '; Qloo picked ' + esc(m.graphPick) + '</li>'; }).join('') + '</ul>';
  }
  function refusalHtml(stepLabel, code, message, detail) {
    return '<div class="ws-refusal" role="alert"><p><strong>Step refused — ' + esc(stepLabel) + '</strong></p>' +
      '<p>Code: ' + esc(code || 'UNKNOWN') + (message ? ' — ' + esc(message) : '') + '</p>' +
      (detail ? '<p>' + esc(detail) + '</p>' : '') +
      '<p class="ws-label">Nothing was written. Prior steps are unchanged.</p></div>';
  }
  function notAvailableHtml(stepLabel) {
    return '<div class="ws-refusal" role="alert"><p><strong>' + esc(stepLabel) + ' — not yet available</strong></p>' +
      '<p>The server step for this panel is not available yet, so no result is shown here. Nothing was written and nothing was invented. Prior steps are unchanged.</p></div>';
  }
  function localNoteHtml(stepLabel) {
    return '<p class="ws-label">Computed locally from the recorded base (the server step is not yet available, so this result is not server-verified). It uses only the recorded guarantee, price, and costs.</p>';
  }
  function settlementStatus() {
    if (!ws) return 'no workspace';
    var s = ws.steps.settlements || [];
    if (s.length > 0) {
      var cov = function (x) { return x.result ? x.result.covered : x.covered; };
      var last = s[s.length - 1];
      var met = s.filter(function (x) { return cov(x); }).length;
      var missed = s.length - met;
      return (cov(last) ? 'settled — met' : 'settled — missed') + ' · settled shows: ' + met + ' met / ' + missed + ' missed (promoter-reported)';
    }
    if (ws.neverSettled) return 'never settled';
    return 'awaiting show';
  }
  function needsVerdictHtml() {
    return '<p class="ws-msg">No seeded verdict yet. Run a verdict above — the workspace seeds from a verdict response only.</p>';
  }

  // ---- replay (existing /api/replay flow) ----
  async function runReplay(rowKey, idx, receipts) {
    var r = receipts && receipts[idx];
    var out = $('ws-replay-' + rowKey + '-' + idx);
    if (!r || !r.replay) return;
    if (out) out.textContent = 'Replaying the exact call…';
    try {
      var res = await fetch('/api/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r.replay) });
      var data = await res.json();
      if (!res.ok) { if (out) out.textContent = 'Replay failed: ' + (data.error ? data.error.code : res.status) + ' — ' + (data.error ? data.error.message : '') + '. The original receipt is unchanged.'; return; }
      var orig = Array.isArray(r.ids) ? r.ids : (Array.isArray(r.entityIds) ? r.entityIds : null);
      var back = Array.isArray(data.ids) ? data.ids : (Array.isArray(data.entityIds) ? data.entityIds : (data.result && (data.result.ids || data.result.entityIds)) || null);
      var count = data.resultCount != null ? data.resultCount : (data.result ? data.result.resultCount : null);
      if (!orig || !back) { if (out) out.textContent = 'Replayed live, but no ID list to compare — counts alone never prove a match. (Replay count: ' + (count == null ? 'unavailable' : count) + '.)'; return; }
      var same = back.length === orig.length && back.every(function (id, i) { return String(id) === String(orig[i]); });
      if (same) { if (out) out.textContent = 'Replay match: live re-run returned the same IDs in the same order (' + back.length + ' results).'; }
      else {
        mismatchKeys.add(rowKey + '|' + idx);
        if (out) out.textContent = 'Replay mismatch: live data changed between runs — the receipt is the record of the original run.';
        render();
        var o2 = $('ws-replay-' + rowKey + '-' + idx); if (o2) o2.textContent = 'Replay mismatch: live data changed between runs — the receipt is the record of the original run.';
      }
    } catch (e) { if (out) out.textContent = 'Replay failed: ' + e.message; }
  }

  // ---- pure local arithmetic (fallback only, labelled as local) ----
  function netOf() {
    var b = ws.baseOffer;
    return b.ticketPrice - (b.variableCostProvided ? b.variableCost : 0);
  }
  function fixedExtraOf() {
    var b = ws.baseOffer;
    var extra = 0;
    for (var i = 0; i < FIXED_KEYS.length; i++) {
      var k = FIXED_KEYS[i][0];
      if (typeof b[k] !== 'number') continue;
      if (k === 'sponsorOffset') extra -= b[k];
      else extra += b[k];
    }
    return extra;
  }
  function renegotiateLocal(target) {
    var b = ws.baseOffer, n = netOf(), extra = fixedExtraOf();
    var lower = extra === 0 ? target * n : target * n - extra;
    var cost = b.variableCostProvided ? b.variableCost : 0;
    var higher = extra === 0
      ? Math.ceil((cost + b.guarantee / target) * 100) / 100
      : Math.ceil((cost + (b.guarantee + extra) / target) * 100 - 1e-9) / 100;
    return {
      targetTickets: target, targetSource: (b.capacity != null && target === b.capacity) ? 'known capacity' : 'promoter-supplied',
      levers: {
        lowerGuarantee: { value: lower, reduction: b.guarantee - lower, holdsFixed: 'holding price and costs fixed' },
        higherPrice: { value: higher, increase: null, holdsFixed: 'holding guarantee and costs fixed', roundingRule: 'rounded UP to the smallest currency unit (cent), because any price below the exact value fails to cover the guarantee at the target tickets' },
        differentCity: { action: 'run routing for candidate cities, then a replacement or comparison run for the chosen city' }
      },
      baseRef: { recordedAt: ws.baseVerdict ? ws.baseVerdict.recordedAt : null, receiptCount: ws.baseVerdict ? ws.baseVerdict.receipts.length : 0 },
      _local: true
    };
  }
  function envelopeLocal(kind, value) {
    var b = ws.baseOffer, n = netOf(), extra = fixedExtraOf();
    var out = { input: { kind: kind, value: value }, net: n, capacityState: b.capacity != null ? 'known' : 'unknown', derivedFrom: { baseRecordedAt: ws.baseVerdict ? ws.baseVerdict.recordedAt : null, receiptCount: ws.baseVerdict ? ws.baseVerdict.receipts.length : 0 }, _local: true };
    if (kind === 'maxGuarantee') {
      var numerator = extra === 0 ? value : value + extra;
      out.ticketsNeeded = (extra !== 0 && numerator <= 0) ? 0 : Math.ceil(numerator / n);
      if (b.capacity != null) { out.fits = out.ticketsNeeded <= b.capacity; if (!out.fits) out.note = 'Cannot break even in this room at this guarantee'; }
      else out.note = 'room fit unknown — capacity unknown';
    } else {
      out.maxAffordableGuarantee = extra === 0 ? value * n : value * n - extra;
      if (b.capacity != null) { out.fits = value <= b.capacity; }
      else out.note = 'room fit unknown — capacity unknown';
    }
    return out;
  }
  function settleLocal(att, actualCost, noteText) {
    var b = ws.baseOffer, bv = ws.baseVerdict;
    var cost = (actualCost != null) ? actualCost : (b.variableCostProvided ? b.variableCost : 0);
    var netSettled = b.ticketPrice - cost;
    var gap = att - bv.tickets;
    var extra = fixedExtraOf();
    var moneyGap = extra === 0 ? att * netSettled - b.guarantee : att * netSettled - (b.guarantee + extra);
    var flags = [];
    if (b.capacity != null && att > b.capacity) flags.push('reported attendance exceeds recorded capacity — check the count');
    return {
      actualAttendance: att, sourceLabel: 'promoter-reported, unverified',
      breakEvenTickets: bv.tickets, gapTickets: gap, covered: gap >= 0, moneyGap: moneyGap, netSettled: netSettled,
      assessment: gap >= 0 ? 'reported sales met the recorded break-even threshold' : 'reported sales missed the recorded break-even threshold by ' + fmt(-gap) + ' tickets (' + money2(-moneyGap) + ' at the settled net)',
      flags: flags, recordedAt: isoNow(), note: noteText || null,
      derivedFrom: { baseRecordedAt: bv.recordedAt, receiptCount: bv.receipts.length }, _local: true
    };
  }

  // ---- server step call ----
  async function postStep(path, stepInput) {
    var res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: ws, stepInput: stepInput }) });
    var data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 404) return { notAvailable: true };
    if (!res.ok) {
      if (data && data.status === 'step_refused') return data;
      return { status: 'step_refused', step: path, error: { code: (data && data.error && data.error.code) || String(res.status), message: (data && data.error && data.error.message) || 'Request failed' }, detail: 'Step request failed.' };
    }
    return data;
  }
  function setBusy(panelId, busy, label) {
    var p = $(panelId); if (!p) return;
    p.querySelectorAll('button[type="submit"]').forEach(function (b) { b.disabled = busy; if (busy) b.textContent = 'Working…'; else if (label) b.textContent = label; });
  }

  // ---- render ----
  function render() {
    var sec = $('workspace'); if (!sec) return;
    var head = $('wsHeader'), base = $('wsBase'), acts = $('wsActions');
    if (!ws) {
      if (head) head.innerHTML = '<p class="ws-season-ledger">' + esc(SEASON_LEDGER_LINE) + '</p><p class="ws-settle-line">Settlement status: no workspace</p>';
      if (base) base.innerHTML = needsVerdictHtml();
      if (acts) acts.innerHTML = '';
      renderPanelsEmpty(); bindStatic(); return;
    }
    var b = ws.baseOffer, bv = ws.baseVerdict;
    if (head) head.innerHTML = '<p class="ws-season-ledger">' + esc(SEASON_LEDGER_LINE) + '</p><p><strong>' + esc(b.artist) + '</strong> in <strong>' + esc(b.city) + '</strong>' + (b.venue ? ' · room: ' + esc(b.venue) : '') + '</p>' +
      '<p>' + guaranteeLine(b.guarantee) + '</p>' +
      '<p class="ws-settle-line">Settlement status: ' + esc(settlementStatus()) + '</p>' +
      '<p class="ws-label">Workspace id: ' + esc(ws.workspaceId || '—') + ' · stored on this device only (localStorage + export). No server copy exists.</p>';
    if (base) {
      if (!bv) {
        base.innerHTML = '<p class="ws-msg">Base edited — prior steps were dropped. Run a verdict for these terms to seed steps.</p>' +
          '<p>' + esc(b.artist) + ' in ' + esc(b.city) + ' · ' + guaranteeLine(b.guarantee) + '</p>';
      } else {
        var mmBase = mismatchKeys.has('base|0') ? '' : '';
        base.innerHTML = '<h3>Base verdict</h3>' +
          '<p><span class="ws-big">' + fmt(bv.tickets) + ' tickets to break even</span> · ' + guaranteeLine(b.guarantee) + '</p>' +
          '<p>Net per ticket: ' + money(bv.net) + costLabel() + ' · Capacity: ' + (bv.capacityState === 'known' ? fmt(b.capacity) + ' (' + esc(b.capacitySource || '') + ')' : 'unknown — no sellout percentage is shown') + '</p>' +
          (bv.verdict ? '<p><strong>' + esc(bv.verdict) + '</strong></p>' : '') +
          '<p class="ws-label">Recorded ' + esc(bv.recordedAt) + ' · ' + bv.receipts.length + ' receipts</p>' +
          '<p>Matched areas: ' + fmt(bv.audience.areasCount) + ' (matched areas/entities, never a headcount). Openers: ' + esc((bv.openers.ranked && bv.openers.ranked.length ? bv.openers.ranked.map(function (o) { return o.name || o.id; }).join(', ') : (bv.openers.candidates || []).map(function (o) { return o.name || o.id; }).join(', ')) || 'none') + (bv.openers.topPick ? ' · Graph pick: ' + esc(bv.openers.topPick) : '') + '</p>' +
          '<div><strong>Miss trial</strong></div>' + missHtml(bv.missTrial) +
          '<div><strong>Receipts</strong></div>' + receiptsHtml(bv.receipts, 'base') + mmBase;
      }
    }
    if (acts) acts.innerHTML =
      '<button type="button" class="ws-btn" id="wsExportBtn">Export workspace JSON</button> ' +
      '<label class="ws-btn ws-file-label" for="wsImportFile">Import workspace JSON</label><input type="file" id="wsImportFile" accept="application/json,.json" hidden> ' +
      '<button type="button" class="ws-btn" id="wsVerifyBtn">Verify workspace</button> ' +
      '<button type="button" class="ws-btn" id="wsClearBtn">Clear workspace</button>' +
      '<span class="ws-out" id="wsActionsOut"></span>';
    renderPanels(); bindStatic(); bindPanels();
  }
  function renderPanelsEmpty() {
    var ids = ['wsReplacement', 'wsRenegotiation', 'wsRouting', 'wsEnvelope', 'wsComparison', 'wsSettlement'];
    ids.forEach(function (id) { var el = $(id); if (el) el.innerHTML = needsVerdictHtml(); });
    var eb = $('wsEditBase'); if (eb) eb.innerHTML = needsVerdictHtml();
  }
  function stepOut(id, html) { var el = $(id); if (el) el.innerHTML = html; }

  function renderPanels() {
    if (!ws) { renderPanelsEmpty(); return; }
    var b = ws.baseOffer, bv = ws.baseVerdict, st = ws.steps;
    if (!bv) {
      ['wsReplacement', 'wsRenegotiation', 'wsRouting', 'wsEnvelope', 'wsComparison', 'wsSettlement'].forEach(function (id) {
        var el = $(id); if (el) el.innerHTML = '<p class="ws-msg">Run a verdict for these terms first — steps compute from a seeded verdict.</p>';
      });
      var eb0 = $('wsEditBase');
      if (eb0) eb0.innerHTML = '<p class="ws-label">Editing any term below creates a NEW workspace — prior steps are dropped, never silently re-based.</p>' +
        '<form id="wsEditBaseForm" class="ws-form">' +
        '<label>Artist<input id="ws-eb-artist" value="' + esc(b.artist) + '" required></label>' +
        '<label>City<input id="ws-eb-city" value="' + esc(b.city) + '" required></label>' +
        '<label>Room / venue<input id="ws-eb-venue" value="' + esc(b.venue || '') + '"></label>' +
        '<label>Guarantee (USD)<input id="ws-eb-guarantee" type="number" min="0" step="1" value="' + esc(b.guarantee) + '" required inputmode="numeric"></label>' +
        '<label>Ticket price (USD)<input id="ws-eb-price" type="number" min="0" step="0.01" value="' + esc(b.ticketPrice == null ? '' : b.ticketPrice) + '" inputmode="decimal"></label>' +
        '<label>Variable cost per ticket (USD, blank = before variable costs)<input id="ws-eb-cost" type="number" min="0" step="0.01" value="' + esc(b.variableCost == null ? '' : b.variableCost) + '" inputmode="decimal"></label>' +
        '<label>Capacity<input id="ws-eb-capacity" type="number" min="1" step="1" value="' + esc(b.capacity == null ? '' : b.capacity) + '" inputmode="numeric"></label>' +
        fixedInputsHtml(function (k) { return 'ws-eb-' + k; }, b) +
        '<button type="submit" class="ws-btn ws-btn--primary">Save as new workspace</button> <span class="ws-out" id="wsEditBaseOut"></span></form>';
      return;
    }
    // Edit base
    var eb = $('wsEditBase');
    if (eb) eb.innerHTML = '<p class="ws-label">Editing any term below creates a NEW workspace — prior steps are dropped, never silently re-based.</p>' +
      '<form id="wsEditBaseForm" class="ws-form">' +
      '<label>Artist<input id="ws-eb-artist" value="' + esc(b.artist) + '" required></label>' +
      '<label>City<input id="ws-eb-city" value="' + esc(b.city) + '" required></label>' +
      '<label>Room / venue<input id="ws-eb-venue" value="' + esc(b.venue || '') + '"></label>' +
      '<label>Guarantee (USD)<input id="ws-eb-guarantee" type="number" min="0" step="1" value="' + esc(b.guarantee) + '" required inputmode="numeric"></label>' +
      '<label>Ticket price (USD)<input id="ws-eb-price" type="number" min="0" step="0.01" value="' + esc(b.ticketPrice == null ? '' : b.ticketPrice) + '" inputmode="decimal"></label>' +
      '<label>Variable cost per ticket (USD, blank = before variable costs)<input id="ws-eb-cost" type="number" min="0" step="0.01" value="' + esc(b.variableCost == null ? '' : b.variableCost) + '" inputmode="decimal"></label>' +
      '<label>Capacity<input id="ws-eb-capacity" type="number" min="1" step="1" value="' + esc(b.capacity == null ? '' : b.capacity) + '" inputmode="numeric"></label>' +
      fixedInputsHtml(function (k) { return 'ws-eb-' + k; }, b) +
      '<button type="submit" class="ws-btn ws-btn--primary">Save as new workspace</button> <span class="ws-out" id="wsEditBaseOut"></span></form>';
    // Replacement
    var rep = $('wsReplacement');
    if (rep) {
      var carry = enteredFixedParts(b);
      var terms = '<p class="ws-label">Terms carried from the base (read-only here — a replacement with different terms belongs in Comparison): city ' + esc(b.city) + ' · ' + guaranteeLine(b.guarantee) + ' · ticket price ' + money(b.ticketPrice) + ' · variable cost ' + (b.variableCostProvided ? money(b.variableCost) : 'blank (before variable costs)') + ' · capacity ' + (b.capacity != null ? fmt(b.capacity) : 'unknown') + (b.venue ? ' · room ' + esc(b.venue) : '') + (carry.length ? ' · ' + esc(carry.join(' · ')) : '') + '</p>';
      var list = (st.replacements || []).map(function (e, i) {
        var r = e.result || e;
        var d = (typeof r.deltaTickets === 'number') ? r.deltaTickets : ((typeof r.tickets === 'number' && bv) ? r.tickets - bv.tickets : null);
        var dir = r.deltaDirection || (d == null ? null : (d < 0 ? 'fewer' : (d > 0 ? 'more' : 'same')));
        var dm = (typeof r.deltaMoney === 'number') ? r.deltaMoney : ((d != null && bv) ? d * bv.net : null);
        return '<article class="ws-row"><h4>' + esc(r.replacementArtist || e.replacementArtist || '') + '</h4>' +
          '<p>' + fmt(r.tickets) + ' tickets to break even · ' + guaranteeLine(b.guarantee) + '</p>' +
          (d != null ? '<p>Delta: ' + fmt(d) + ' tickets (' + esc(dir) + ') · ' + money(dm) + ' — ' + esc(DELTA_LABEL) + '</p>' : '') +
          (r.verdict ? '<p><strong>' + esc(r.verdict) + '</strong></p>' : '') +
          '<p class="ws-label">Recorded ' + esc(e.recordedAt || '') + '</p>' +
          '<div><strong>Miss trial</strong></div>' + missHtml(r.missTrial) +
          receiptsHtml(r.receipts || e.receipts || [], 'repl' + i) + '</article>';
      }).join('');
      rep.innerHTML = terms +
        '<form id="wsReplForm" class="ws-form"><label>Replacement artist<input id="ws-repl-artist" required autocomplete="off"></label>' +
        '<button type="submit" class="ws-btn ws-btn--primary">Run replacement</button> <span class="ws-out" id="wsReplOut"></span></form>' +
        '<div id="wsReplRefusal"></div>' +
        (list || '<p class="ws-label">No replacements yet. Re-running appends a new dated entry; earlier entries are never overwritten.</p>');
    }
    // Renegotiation
    var rn = $('wsRenegotiation');
    if (rn) {
      var cur = st.renegotiation;
      var curHtml = cur ? renegotiationHtml(cur.result || cur) : '<p class="ws-label">No renegotiation yet.</p>';
      rn.innerHTML = '<form id="wsRenegForm" class="ws-form"><label>Target tickets (optional)<input id="ws-reneg-target" type="number" min="1" step="1" placeholder="' + (b.capacity != null ? 'defaults to known capacity: ' + fmt(b.capacity) : 'enter a target') + '" inputmode="numeric"></label>' +
        '<p class="ws-label">' + (b.capacity != null ? 'Default target: known capacity (' + fmt(b.capacity) + ').' : 'Capacity unknown — enter a target; no target will be invented.') + '</p>' +
        '<button type="submit" class="ws-btn ws-btn--primary">Compute levers</button> <span class="ws-out" id="wsRenegOut"></span></form>' +
        '<div id="wsRenegRefusal"></div>' + curHtml;
    }
    // Routing
    var rt = $('wsRouting');
    if (rt) {
      var candBtns = (bv && bv.audience.areas || []).map(function (a) { var n = a.name || a.id || ''; return n ? '<button type="button" class="ws-btn ws-btn--sm ws-cand-btn" data-cand="' + esc(n) + '">' + esc(n) + '</button>' : ''; }).join(' ');
      var curR = st.routing ? routingHtml(st.routing.result || st.routing) : '<p class="ws-label">No routing yet.</p>';
      rt.innerHTML = '<form id="wsRouteForm" class="ws-form"><label>Candidate cities (comma-separated, 1–10)<textarea id="ws-route-cities" rows="2" placeholder="City names, separated by commas"></textarea></label>' +
        '<p class="ws-label">One-click candidates from the base run’s where_popular areas:</p><p>' + (candBtns || '<span class="ws-label">No areas returned in the base run.</span>') + '</p>' +
        '<button type="submit" class="ws-btn ws-btn--primary">Rank candidates</button> <span class="ws-out" id="wsRouteOut"></span></form>' +
        '<div id="wsRouteRefusal"></div>' + curR;
      loadMapStrip();
    }
    // Envelope
    var env = $('wsEnvelope');
    if (env) {
      var curE = st.envelope ? envelopeHtml(st.envelope.result || st.envelope) : '<p class="ws-label">No envelope yet.</p>';
      env.innerHTML = '<form id="wsEnvForm" class="ws-form"><fieldset><legend>Exactly one input</legend>' +
        '<label><input type="radio" name="ws-env-kind" value="maxGuarantee" checked> Max guarantee I can afford (USD) <input id="ws-env-max" type="number" min="0" step="1" inputmode="numeric"></label>' +
        '<label><input type="radio" name="ws-env-kind" value="targetTickets"> Most tickets I can credibly put in this room (promoter-supplied, not a forecast) <input id="ws-env-target" type="number" min="1" step="1" inputmode="numeric"></label>' +
        '</fieldset><button type="submit" class="ws-btn ws-btn--primary">Compute envelope</button> <span class="ws-out" id="wsEnvOut"></span></form>' +
        '<div id="wsEnvRefusal"></div>' + curE;
    }
    // Comparison
    var cp = $('wsComparison');
    if (cp) {
      var rows = '';
      for (var i = 0; i < compareCount; i++) rows += comparisonRowHtml(i);
      var curC = st.comparison ? comparisonHtml(st.comparison.result || st.comparison) : '<p class="ws-label">No comparison yet.</p>';
      cp.innerHTML = '<form id="wsCompForm" class="ws-form">' + rows +
        '<button type="button" class="ws-btn" id="wsCompAddBtn">Add an offer</button> ' +
        '<button type="submit" class="ws-btn ws-btn--primary"' + (compareInFlight ? ' disabled' : '') + '>' + (compareInFlight ? 'Working…' : 'Compare offers') + '</button> <span class="ws-out" id="wsCompOut"></span></form>' +
        '<div id="wsCompRefusal"></div>' + curC;
    }
    // Settlement
    var stl = $('wsSettlement');
    if (stl) {
      var listS = (st.settlements || []).map(function (e) {
        var r = e.result || e;
        // Renegotiation and envelope render their local fallback with
        // a label; settlements did not, so a locally computed entry
        // (server step unavailable) rendered identically to a
        // server-verified one. The arithmetic is the same formula, but
        // the provenance differs, so it is labelled.
        var settleLocal = r._local ? localNoteHtml() : '';
        return '<article class="ws-row">' + settleLocal + '<p>Reported attendance: ' + fmt(r.actualAttendance) + ' (' + esc(r.sourceLabel || 'promoter-reported, unverified') + ') · recorded break-even: ' + fmt(r.breakEvenTickets) + ' tickets</p>' +
          '<p>Gap: ' + fmt(r.gapTickets) + ' tickets · money gap: ' + money2(r.moneyGap) + ' at settled net ' + money2(r.netSettled) + costLabel() + '</p>' +
          '<p>' + esc(r.assessment || '') + '</p>' +
          ((r.flags || []).length ? '<p>Flags: ' + r.flags.map(esc).join('; ') + '</p>' : '') +
          (e.corrects ? '<p class="ws-label">Corrects the settlement recorded ' + esc(e.corrects) + '</p>' : '') +
          (r.note ? '<p>Note: ' + esc(r.note) + '</p>' : '') +
          '<p class="ws-label">Recorded ' + esc(e.recordedAt || r.recordedAt || '') + '</p></article>';
      }).join('');
      stl.innerHTML = '<p>' + esc(SETTLE_PROVES) + '</p><p>' + esc(SETTLE_NOT_PROVES) + '</p>' +
        '<form id="wsSettleForm" class="ws-form"><label>Actual attendance (promoter-reported)<input id="ws-settle-att" type="number" min="0" step="1" required inputmode="numeric"></label>' +
        '<label>Actual variable cost per ticket (USD, optional — blank means recorded terms apply)<input id="ws-settle-cost" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
        '<label>Note (optional)<input id="ws-settle-note"></label>' +
        '<button type="submit" class="ws-btn ws-btn--primary">Record settlement</button> <button type="button" class="ws-btn" id="wsNeverSettledBtn">Record that this show will not be settled</button> <span class="ws-out" id="wsSettleOut"></span></form>' +
        '<div id="wsSettleRefusal"></div>' +
        (listS || '<p class="ws-label">No settlements yet. A second settlement appends a new entry with a “corrects” pointer; it never overwrites the earlier entry.</p>');
    }
  }
  function renegotiationHtml(r) {
    if (!r) return '';
    if (r.note) return '<article class="ws-row"><p>' + esc(r.note) + '</p></article>';
    var L = r.levers || {};
    var local = r._local ? localNoteHtml() : '';
    return '<article class="ws-row">' + local +
      '<p>Target: ' + fmt(r.targetTickets) + ' tickets (' + esc(r.targetSource || '') + ')</p>' +
      '<p>Lower guarantee: ' + money(L.lowerGuarantee ? L.lowerGuarantee.value : null) + ' (a reduction of ' + money(L.lowerGuarantee ? L.lowerGuarantee.reduction : null) + ') — ' + esc(L.lowerGuarantee ? L.lowerGuarantee.holdsFixed : 'holding price and costs fixed') + '</p>' +
      '<p>Higher price: ' + money2(L.higherPrice ? L.higherPrice.value : null) + ' — ' + esc(L.higherPrice ? L.higherPrice.holdsFixed : 'holding guarantee and costs fixed') + '. Rounding rule: ' + esc(L.higherPrice ? L.higherPrice.roundingRule : 'rounded UP to the smallest currency unit (cent)') + '</p>' +
      '<p>Different city: no number — ' + esc(L.differentCity ? L.differentCity.action : 'run routing for candidate cities, then a replacement or comparison run for the chosen city') + '</p>' +
      (r.supersedes ? '<p class="ws-label">Supersedes the entry recorded ' + esc(r.supersedes) + '</p>' : '') +
      '<p class="ws-label">Derived from the base recorded ' + esc(r.baseRef ? r.baseRef.recordedAt : '') + ' (' + esc(r.baseRef ? r.baseRef.receiptCount : '') + ' receipts). ' + costLabel() + '</p></article>';
  }
  // Phase 3 (F): one why-not line per non-top ranked candidate, computed
  // ONLY from the routing result's own matched-area counts (top candidate
  // included for comparison). Matched areas are taste overlap only — the
  // line never mentions demand, sales, or attendance. If either count is
  // absent, the line is omitted and the omission is labelled, never
  // filled with prose. A count above the top count contradicts the rank
  // order, so that line is omitted too.
  function whyNotHtml(c, top) {
    if (!top || c === top) return 'Ranked first.';
    var tc = top.matchedAreasCount, cc = c.matchedAreasCount;
    if (typeof tc !== 'number' || !isFinite(tc) || typeof cc !== 'number' || !isFinite(cc)) return 'Why not ranked first: omitted — matched-area count not present in the routing result.';
    if (cc > tc) return 'Why not ranked first: omitted — matched-area count contradicts the rank order.';
    if (cc === tc) return 'Why not ranked first: ' + fmt(cc) + ' matched areas — the same count as ' + top.city + ', ranked below it by Qloo return order.';
    return 'Why not ranked first: ' + fmt(cc) + ' matched areas vs ' + fmt(tc) + ' for ' + top.city + ' — fewer matched areas.';
  }
  function routingHtml(r) {
    if (!r) return '';
    var cands = r.candidates || [];
    var top = null;
    for (var ti = 0; ti < cands.length; ti++) {
      if (cands[ti].status === 'ok' && cands[ti].rank === 1) { top = cands[ti]; break; }
    }
    if (!top) {
      for (var tj = 0; tj < cands.length; tj++) {
        if (cands[tj].status === 'ok') { top = cands[tj]; break; }
      }
    }
    var rows = cands.map(function (c) {
      if (c.status !== 'ok') return '<tr><td>' + esc(c.city) + '</td><td>unranked: no live evidence</td><td>—</td><td>' + esc(c.reason || c.status || '') + '</td><td><span class="ws-label">No receipt — not ranked</span></td><td class="ws-why-not">—</td></tr>';
      var recs = c.receipts || (c.receipt ? [c.receipt] : []);
      if (recs.length === 0 || !recs[0].replay) return '<tr><td>' + esc(c.city) + '</td><td>unranked: no live evidence</td><td>—</td><td>No receipt for this row — not ranked</td><td><span class="ws-label">No receipt — not ranked</span></td><td class="ws-why-not">—</td></tr>';
      return '<tr><td>' + esc(c.city) + '</td><td>' + esc(c.rank != null ? c.rank : '—') + '</td><td>' + fmt(c.matchedAreasCount) + '</td><td>' + (c.areas || []).map(function (a) { return esc(a.name || a.id || ''); }).join(', ') + '</td><td>' + receiptsHtml(recs, 'route-' + esc(c.city)) + '</td><td class="ws-why-not">' + esc(whyNotHtml(c, top)) + '</td></tr>';
    }).join('');
    return '<article class="ws-row"><p><strong>' + esc(ROUTE_LABEL) + '</strong></p><p>' + esc(ROUTE_NOTE) + '</p>' +
      '<div id="wsMapStrip"><p class="ws-label">Locating routing cities…</p></div>' +
      '<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>City</th><th>Rank</th><th>Matched areas</th><th>Areas</th><th>Receipts</th><th>Why not first</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="ws-label">Ranking key: count of Qloo-matched areas/entities per city, tie-broken by Qloo’s own return order. This is not a sales forecast.</p></article>';
  }
  // Routing map strip (retry with the correct data): pins for the base city
  // plus routing candidate cities ONLY — city strings the user entered for
  // routing, never artist names, never audience-area names. Coordinates
  // come from POST /api/workspace/geocode (Nominatim, via the server).
  // The strip is display-only: it never affects rank or break-even, and
  // the table stays authoritative. A city that does not resolve is omitted
  // and listed, never placed. Static SVG, no animation, so reduced-motion
  // needs no special case.
  var lastStripKey = null;
  var lastStripHtml = null;
  var stripInFlightKey = null;
  function stripCities() {
    if (!ws || !ws.baseOffer || !ws.steps || !ws.steps.routing) return null;
    var res = ws.steps.routing.result || ws.steps.routing;
    var list = [];
    var seen = {};
    function push(name) {
      if (typeof name !== 'string') return;
      var t = name.trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      list.push(t);
    }
    push(ws.baseOffer.city);
    (res.candidates || []).forEach(function (c) { push(c.city); });
    if (list.length < 1) return null;
    return list.slice(0, 11);
  }
  function mapStripHtml(pins, failures, baseCity) {
    if (!pins || pins.length === 0) {
      return '<p class="ws-label">No city located — no pins shown. The table below is the full routing result.</p>' +
        (failures && failures.length ? '<p class="ws-label">Not located (omitted): ' + failures.map(function (f) { return esc(f); }).join(', ') + '.</p>' : '');
    }
    var lons = pins.map(function (p) { return p.lon; });
    var lats = pins.map(function (p) { return p.lat; });
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    // A degenerate span (one pin, or pins sharing a coordinate) gets a
    // symmetric 0.5-degree window so the pin still centers honestly.
    if (maxLon - minLon < 0.5) { var midLon = (minLon + maxLon) / 2; minLon = midLon - 0.25; maxLon = midLon + 0.25; }
    if (maxLat - minLat < 0.5) { var midLat = (minLat + maxLat) / 2; minLat = midLat - 0.25; maxLat = midLat + 0.25; }
    var W = 600, H = 150, PL = 40, PR = 40, PT = 28, PB = 30;
    function px(lon) { return PL + (lon - minLon) / (maxLon - minLon) * (W - PL - PR); }
    function py(lat) { return PT + (1 - (lat - minLat) / (maxLat - minLat)) * (H - PT - PB); }
    var dots = pins.map(function (p) {
      var isBase = String(p.city).toLowerCase() === String(baseCity).toLowerCase();
      var x = px(p.lon).toFixed(1), y = py(p.lat).toFixed(1);
      var circle = isBase
        ? '<circle cx="' + x + '" cy="' + y + '" r="7" class="ws-pin ws-pin--base" />'
        : '<circle cx="' + x + '" cy="' + y + '" r="5" class="ws-pin" />';
      return circle + '<text x="' + x + '" y="' + (Number(y) - 12).toFixed(1) + '" class="ws-pin-label' + (isBase ? ' ws-pin-label--base' : '') + '" text-anchor="middle">' + esc(p.city) + '</text>';
    }).join('');
    var caption = pins.map(function (p) {
      var isBase = String(p.city).toLowerCase() === String(baseCity).toLowerCase();
      return '<li>' + (isBase ? 'Base: ' : '') + esc(p.city) + ' — ' + esc(p.displayName || '') + ' (' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) + ')</li>';
    }).join('');
    return '<svg class="ws-mapstrip-svg" viewBox="0 0 600 150" role="img" aria-label="Routing cities located on a strip">' + dots + '</svg>' +
      '<p class="ws-label">Pins show city locations only — rank comes from the table below. Base city in orange; candidates in ink.</p>' +
      '<ul class="ws-mapstrip-caption">' + caption + '</ul>' +
      (failures && failures.length ? '<p class="ws-label">Not located (omitted from the strip): ' + failures.map(function (f) { return esc(f); }).join(', ') + '.</p>' : '') +
      '<p class="ws-label">Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).</p>';
  }
  async function loadMapStrip() {
    var holder = $('wsMapStrip');
    if (!holder) return;
    var cities = stripCities();
    if (!cities) { holder.innerHTML = '<p class="ws-label">No routing cities to locate.</p>'; return; }
    var key = cities.join('|');
    if (key === lastStripKey && lastStripHtml) { holder.innerHTML = lastStripHtml; return; }
    if (key === stripInFlightKey) return;
    stripInFlightKey = key;
    try {
      var res = await fetch('/api/workspace/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cities: cities }) });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !Array.isArray(data.pins)) throw new Error('geocode failed');
      var html = mapStripHtml(data.pins, data.failures || [], ws.baseOffer.city);
      lastStripKey = key; lastStripHtml = html;
      var cur = $('wsMapStrip');
      if (cur) cur.innerHTML = html;
    } catch (e) {
      var cur2 = $('wsMapStrip');
      if (cur2) cur2.innerHTML = '<p class="ws-label">Map strip unavailable — geography lookup failed. The table below is the full routing result.</p>';
    } finally {
      if (stripInFlightKey === key) stripInFlightKey = null;
    }
  }
  function envelopeHtml(r) {
    if (!r) return '';
    var local = r._local ? localNoteHtml() : '';
    var body = '';
    if (r.input && r.input.kind === 'maxGuarantee') body = '<p>Max guarantee: ' + money(r.input.value) + ' → tickets needed: ' + fmt(r.ticketsNeeded) + costLabel() + '</p>';
    else body = '<p>Target tickets: ' + fmt(r.input ? r.input.value : null) + ' → largest guarantee that breaks even at that count: ' + money(r.maxAffordableGuarantee) + costLabel() + '</p>';
    var fit = '';
    if (r.capacityState === 'unknown') fit = '<p>Room fit unknown — capacity unknown. No fit claim is made.</p>';
    else if (r.fits === true) fit = '<p>Fit: tickets needed are within the known capacity.</p>';
    else if (r.fits === false) fit = '<p><strong>Cannot break even in this room at this guarantee</strong></p>';
    return '<article class="ws-row">' + local + body + fit + (r.note ? '<p>' + esc(r.note) + '</p>' : '') +
      (r.supersedes ? '<p class="ws-label">Supersedes the entry recorded ' + esc(r.supersedes) + '</p>' : '') + '</article>';
  }
  function comparisonRowHtml(i) {
    return '<fieldset class="ws-offer"><legend>Offer ' + (i + 1) + '</legend>' +
      '<label>Artist<input id="ws-comp-artist-' + i + '" required></label>' +
      '<label>City<input id="ws-comp-city-' + i + '" required></label>' +
      '<label>Guarantee (USD)<input id="ws-comp-g-' + i + '" type="number" min="0" step="1" required inputmode="numeric"></label>' +
      '<label>Ticket price (USD)<input id="ws-comp-price-' + i + '" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
      '<label>Variable cost per ticket (USD, blank = before variable costs)<input id="ws-comp-cost-' + i + '" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
      '<label>Capacity<input id="ws-comp-cap-' + i + '" type="number" min="1" step="1" inputmode="numeric"></label>' +
      fixedInputsHtml(function (k) { return 'ws-comp-' + k + '-' + i; }, null) +
      '<label>Room / venue<input id="ws-comp-venue-' + i + '"></label></fieldset>';
  }
  function comparisonHtml(r) {
    if (!r) return '';
    var bv = ws.baseVerdict, b = ws.baseOffer;
    var baseParts = enteredFixedParts(b);
    var baseRow = '<tr><td>0 (base — from the verified base, never re-run)</td><td>' + esc(b.artist) + ' · ' + esc(b.city) + '</td><td>' + guaranteeLine(b.guarantee) + (baseParts.length ? '<br><span class="ws-label">' + esc(baseParts.join(' · ')) + '</span>' : '') + '</td><td>' + fmt(bv ? bv.tickets : null) + '</td><td>' + (bv && bv.capacityState === 'known' ? fmt(b.capacity) : 'unknown') + '</td><td>' + (bv ? receiptsHtml(bv.receipts, 'base') : '') + '</td></tr>';
    // The server result already carries its own base row (offerIndex 0);
    // rendering it as well would show row 0 twice. The row above is the
    // only base row: it carries the verified base receipts, while the
    // server base row carries none. Rows sharing an offerIndex are also
    // shown once only, so a repeated submit can never duplicate a row.
    var seenOfferIndex = {};
    var rows = (r.rows || []).filter(function (row) {
      if (row.offerIndex === 0) return false;
      if (row.offerIndex != null) {
        if (seenOfferIndex[row.offerIndex]) return false;
        seenOfferIndex[row.offerIndex] = true;
      }
      return true;
    }).map(function (row, i) {
      if (row.status === 'refused' || !row.tickets && row.tickets !== 0) {
        var ref = row.refusal || {};
        return '<tr class="ws-row--refused"><td>' + esc(row.offerIndex != null ? row.offerIndex : i + 1) + '</td><td>' + esc(row.artist || '') + ' · ' + esc(row.city || '') + '</td><td>—</td><td>refused — no numbers</td><td>' + esc(row.capacity ? (row.capacity.state || '') : '') + '</td><td>Code: ' + esc(ref.code || '') + ' — ' + esc(ref.reason || '') + '</td></tr>';
      }
      // Receipt keys are the row's offerIndex, NOT the filtered-array
      // index: filtering out the server base row (offerIndex 0) shifts
      // every later row by one, so a filtered index key made the first
      // offer's replay button resolve to the base row (no receipts) and
      // every later offer's button replay the previous offer's receipt
      // (findReceipts indexes the unfiltered rows array).
      var compKey = 'comp' + (row.offerIndex != null ? row.offerIndex : i + 1);
      var rowParts = enteredFixedParts(row);
      return '<tr><td>' + esc(row.offerIndex != null ? row.offerIndex : i + 1) + '</td><td>' + esc(row.artist || '') + ' · ' + esc(row.city || '') + '</td><td>' + guaranteeLine(row.guarantee) + (rowParts.length ? '<br><span class="ws-label">' + esc(rowParts.join(' · ')) + '</span>' : '') + '</td><td>' + fmt(row.tickets) + '</td><td>' + (row.capacity ? (row.capacity.state === 'known' ? fmt(row.capacity.value) : 'unknown') : 'unknown') + '</td><td>' + receiptsHtml(row.receipts || [], compKey) + '</td></tr>';
    }).join('');
    return '<article class="ws-row"><div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Row</th><th>Offer</th><th>Guarantee</th><th>Tickets needed</th><th>Capacity</th><th>Receipts / refusal</th></tr></thead><tbody>' + baseRow + rows + '</tbody></table></div>' +
      '<p>' + esc(SORT_NOTE) + '</p>' +
      (r.supersedes ? '<p class="ws-label">Supersedes the entry recorded ' + esc(r.supersedes) + '</p>' : '') + '</article>';
  }

  // Import shape gate: steps must be the shape render() consumes, or
  // render() throws on the imported file (a string where rows must be
  // an array bricks the panel until Clear). A null baseVerdict is only
  // admissible with every step empty — the edit-base shape — since
  // steps computed from a verdict cannot exist without that verdict.
  function validImportSteps(o) {
    if (o.steps === undefined || o.steps === null) return true;
    var st = o.steps;
    if (typeof st !== 'object' || Array.isArray(st)) return false;
    if (!Array.isArray(st.replacements) && st.replacements !== undefined) return false;
    if (!Array.isArray(st.settlements) && st.settlements !== undefined) return false;
    var singles = ['renegotiation', 'routing', 'envelope', 'comparison'];
    for (var si = 0; si < singles.length; si++) {
      var s = st[singles[si]];
      if (s !== undefined && s !== null && typeof s !== 'object') return false;
    }
    if (st.comparison && st.comparison.result && !Array.isArray(st.comparison.result.rows)) return false;
    if (st.routing && st.routing.result && !Array.isArray(st.routing.result.candidates)) return false;
    if (o.baseVerdict == null) {
      var empty = (!st.replacements || st.replacements.length === 0) &&
        (!st.settlements || st.settlements.length === 0) &&
        st.renegotiation == null && st.routing == null && st.envelope == null && st.comparison == null;
      if (!empty) return false;
    }
    return true;
  }

  // ---- bindings ----
  function bindStatic() {
    var ex = $('wsExportBtn'); if (ex && !ex.dataset.bound) { ex.dataset.bound = '1'; ex.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'offersheet-workspace.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      var o = $('wsActionsOut'); if (o) o.textContent = 'Exported.';
    }); }
    var imp = $('wsImportFile'); if (imp && !imp.dataset.bound) { imp.dataset.bound = '1'; imp.addEventListener('change', function () {
      var f = imp.files && imp.files[0]; if (!f) return;
      // Size cap first (a workspace export is kilobytes): an oversize file
      // is rejected without parsing, and without touching stored state.
      if (f.size !== undefined && f.size !== null && f.size > 1000000) { var oBig = $('wsActionsOut'); if (oBig) oBig.textContent = 'Import rejected: file is over 1MB — not a workspace export. Nothing was overwritten.'; return; }
      var rd = new FileReader();
      rd.onload = async function () {
        var out = $('wsActionsOut');
        try {
          var o = JSON.parse(rd.result);
          if (!o || o.workspaceVersion !== 1 || !o.baseOffer || typeof o.baseOffer.artist !== 'string' || typeof o.baseOffer.city !== 'string' || typeof o.baseOffer.guarantee !== 'number') throw new Error('bad shape');
          if (!validImportSteps(o)) throw new Error('bad steps shape');
          if (!isValidWorkspaceShape(o)) throw new Error('bad shape');
          // A workspace with no seeded verdict (the edit-base shape:
          // baseVerdict null, all steps empty) has no numbers to
          // recompute, so shape alone admits it. Anything with a
          // verdict MUST pass server verification first: the server
          // recomputes the base arithmetic and re-verifies every base
          // receipt hash, so a tampered ticket count or forged hash
          // cannot import silently. Verification unavailable (404 or
          // network failure) refuses the import rather than admitting
          // an unverified workspace. Nothing is assigned to ws until
          // every check passes, so a rejection overwrites nothing.
          // Step rows themselves are NOT recomputed here: the verify
          // endpoint covers the base only, and recomputing a step row
          // would mean re-running its live verdict — see REPORT.
          if (o.baseVerdict != null) {
            var res = await fetch('/api/workspace/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: o }) });
            if (res.status === 404) throw new Error('verification unavailable');
            var d = await res.json().catch(function () { return null; });
            if (!d || d.status !== 'verified') throw new Error('verification failed: ' + ((d && d.mismatches || []).map(function (m) { return typeof m === 'string' ? m : JSON.stringify(m); }).join('; ') || 'see response'));
          }
          ws = o; if (!ws.steps) ws.steps = { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] };
          mismatchKeys = new Set(); save(); render();
          var out2 = $('wsActionsOut'); if (out2) out2.textContent = 'Imported.';
        } catch (e) { var out3 = $('wsActionsOut'); if (out3) out3.textContent = 'Import rejected: ' + e.message + ' Nothing was overwritten.'; }
      };
      rd.readAsText(f);
    }); }
    var vf = $('wsVerifyBtn'); if (vf && !vf.dataset.bound) { vf.dataset.bound = '1'; vf.addEventListener('click', async function () {
      var out = $('wsActionsOut'); if (out) out.textContent = 'Verifying…';
      try {
        var res = await fetch('/api/workspace/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: ws }) });
        if (res.status === 404) { if (out) out.textContent = 'Verification endpoint not yet available — the workspace is shown as stored, not as verified.'; return; }
        var d = await res.json();
        if (out) out.textContent = d.status === 'verified' ? 'Verified: schema, arithmetic, and receipt hashes all pass.' : 'Verification failed: ' + ((d.mismatches || []).map(function (m) { return typeof m === 'string' ? m : JSON.stringify(m); }).join('; ') || 'see response');
      } catch (e) { if (out) out.textContent = 'Verification failed: ' + e.message; }
    }); }
    var cl = $('wsClearBtn'); if (cl && !cl.dataset.bound) { cl.dataset.bound = '1'; cl.addEventListener('click', clear); }
    document.querySelectorAll('[data-ws-replay]').forEach(function (btn) {
      if (btn.dataset.bound) return; btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        // Split on the LAST separator: a routing row key is 'route-<city>'
        // and a city may itself contain '|', which the old first-split
        // parsing silently misread (dead replay button, never corruption —
        // runReplay still early-returns on a missing receipt).
        var rawReplay = btn.getAttribute('data-ws-replay') || '';
        var sep = rawReplay.lastIndexOf('|');
        var rowKey = sep >= 0 ? rawReplay.slice(0, sep) : rawReplay;
        var idx = sep >= 0 ? Number(rawReplay.slice(sep + 1)) : NaN;
        var receipts = findReceipts(rowKey);
        runReplay(rowKey, idx, receipts);
      });
    });
  }
  function findReceipts(rowKey) {
    if (!ws) return [];
    if (rowKey === 'base') return ws.baseVerdict ? ws.baseVerdict.receipts : [];
    if (rowKey.indexOf('repl') === 0) { var e = ws.steps.replacements[Number(rowKey.slice(4))]; return e ? (e.result && e.result.receipts) || e.receipts || [] : []; }
    if (rowKey.indexOf('route-') === 0) {
      var r = ws.steps.routing && (ws.steps.routing.result || ws.steps.routing);
      var c = r && (r.candidates || []).find(function (x) { return x.city === rowKey.slice(6); });
      return c ? (c.receipts || (c.receipt ? [c.receipt] : [])) : [];
    }
    if (rowKey.indexOf('comp') === 0) {
      var cr = ws.steps.comparison && (ws.steps.comparison.result || ws.steps.comparison);
      var rows = (cr && cr.rows) || [];
      var want = Number(rowKey.slice(4));
      var row = null;
      for (var ci = 0; ci < rows.length; ci++) { if (rows[ci] && rows[ci].offerIndex === want) { row = rows[ci]; break; } }
      // Fallback for rows without an offerIndex (never server-produced):
      // those render with key i + 1 for filtered index i, and with no
      // base row to filter, filtered order is row order, so key - 1.
      if (!row) row = rows[want - 1];
      return row ? row.receipts || [] : [];
    }
    return [];
  }
  function bindPanels() {
    if (!ws) return;
    var b = ws.baseOffer;
    // Edit base
    var eb = $('wsEditBaseForm'); if (eb) eb.addEventListener('submit', async function (e) {
      e.preventDefault();
      var edited = {
        artist: strVal('ws-eb-artist'), city: strVal('ws-eb-city'),
        venue: strVal('ws-eb-venue') || null,
        guarantee: numVal('ws-eb-guarantee'),
        ticketPrice: numVal('ws-eb-price'),
        variableCost: numVal('ws-eb-cost'),
        variableCostProvided: numVal('ws-eb-cost') != null,
        capacity: numVal('ws-eb-capacity'),
        capacitySource: numVal('ws-eb-capacity') != null ? 'user-supplied, not Ticketmaster-verified' : null
      };
      applyFixedInputs(edited, function (k) { return 'ws-eb-' + k; });
      var out = $('wsEditBaseOut');
      var same = edited.artist === b.artist && edited.city === b.city && (edited.venue || null) === (b.venue || null) && edited.guarantee === b.guarantee && edited.ticketPrice === b.ticketPrice && edited.variableCost === b.variableCost && edited.capacity === b.capacity && fixedSame(edited, b);
      if (same) { if (out) out.textContent = 'No change — workspace unchanged.'; return; }
      if (!edited.artist || !edited.city || edited.guarantee == null || edited.guarantee < 0) { if (out) out.textContent = 'Enter an artist, a city, and a guarantee at or above 0.'; return; }
      ws = { workspaceVersion: 1, workspaceId: await computeId(edited, []), baseOffer: edited, baseVerdict: null, steps: { replacements: [], renegotiation: null, routing: null, envelope: null, comparison: null, settlements: [] }, editedFrom: 'previous base' };
      save(); render();
      var o2 = $('wsEditBaseOut'); if (o2) o2.textContent = 'New workspace created — prior steps were dropped because they were computed from the previous base. Run a verdict for these terms to seed steps.';
    });
    if (!ws.baseVerdict) return;
    // Replacement
    var rf = $('wsReplForm'); if (rf) rf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var artist = strVal('ws-repl-artist'); var out = $('wsReplOut'), ref = $('wsReplRefusal');
      if (!artist) { if (out) out.textContent = 'Enter a replacement artist.'; return; }
      setBusy('wsReplacement', true); if (out) out.textContent = '';
      try {
        var d = await postStep('/api/workspace/replacement', { replacementArtist: artist });
        if (d.notAvailable) { if (ref) ref.innerHTML = notAvailableHtml('Replacement'); }
        else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('replacement', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          var r = d.result || {};
          var tickets = (typeof r.tickets === 'number') ? r.tickets : (r.breakEven ? r.breakEven.tickets : null);
          if (tickets == null) { if (ref) ref.innerHTML = refusalHtml('replacement', 'INVALID_INPUT', 'Server returned ok without a ticket count — discarded.', ''); }
          else {
            var entry = { replacementArtist: artist, result: { replacementArtist: r.replacementArtist || artist, tickets: tickets, net: (typeof r.net === 'number') ? r.net : ws.baseVerdict.net, verdict: r.verdict || null, deltaTickets: (typeof r.deltaTickets === 'number') ? r.deltaTickets : tickets - ws.baseVerdict.tickets, deltaDirection: r.deltaDirection || null, deltaMoney: (typeof r.deltaMoney === 'number') ? r.deltaMoney : (tickets - ws.baseVerdict.tickets) * ws.baseVerdict.net, audience: r.audience || null, openers: r.openers || null, missTrial: r.missTrial || null, receipts: r.receipts || d.receipts || [] }, recordedAt: d.recordedAt || isoNow() };
            ws.steps.replacements.push(entry); save(); render();
            var o = $('wsReplOut'); if (o) o.textContent = 'Replacement recorded.';
          }
        } else { if (ref) ref.innerHTML = refusalHtml('replacement', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) { if (ref) ref.innerHTML = refusalHtml('replacement', 'REQUEST_FAILED', err.message, ''); }
      setBusy('wsReplacement', false, 'Run replacement');
    });
    // Renegotiation
    var nf = $('wsRenegForm'); if (nf) nf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var target = numVal('ws-reneg-target');
      if (target == null) target = (b.capacity != null) ? b.capacity : null;
      var out = $('wsRenegOut'), ref = $('wsRenegRefusal');
      if (target == null || target <= 0 || Math.floor(target) !== target) { if (out) out.textContent = 'Capacity is unknown — enter a target ticket count above 0. No target will be invented.'; return; }
      if (netOf() <= 0) { if (out) out.textContent = 'Net per ticket is not positive — no lever can be computed.'; return; }
      if (b.guarantee === 0 && fixedExtraOf() === 0) {
        var noteEntry = { result: { note: 'no guarantee — break-even is already 0 tickets; no lever applies' }, recordedAt: isoNow() };
        var prev = ws.steps.renegotiation; if (prev) noteEntry.result.supersedes = prev.recordedAt;
        ws.steps.renegotiation = noteEntry; save(); render(); return;
      }
      setBusy('wsRenegotiation', true);
      try {
        var d = await postStep('/api/workspace/renegotiate', { targetTickets: target });
        if (d.notAvailable || (d.status === 'step_refused' && d.error && d.error.code === 'REQUEST_FAILED')) {
          var local = renegotiateLocal(target);
          var prev2 = ws.steps.renegotiation; if (prev2) local.supersedes = prev2.recordedAt;
          ws.steps.renegotiation = { result: local, recordedAt: isoNow() }; save(); render();
        } else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('renegotiation', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          var prev3 = ws.steps.renegotiation; var res = d.result || {};
          if (prev3) res.supersedes = prev3.recordedAt;
          ws.steps.renegotiation = { result: res, recordedAt: d.recordedAt || isoNow() }; save(); render();
        } else { if (ref) ref.innerHTML = refusalHtml('renegotiation', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) {
        var local2 = renegotiateLocal(target);
        var prev4 = ws.steps.renegotiation; if (prev4) local2.supersedes = prev4.recordedAt;
        ws.steps.renegotiation = { result: local2, recordedAt: isoNow() }; save(); render();
      }
      setBusy('wsRenegotiation', false, 'Compute levers');
    });
    // Routing
    document.querySelectorAll('.ws-cand-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ta = $('ws-route-cities'); if (!ta) return;
        var cur = ta.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var name = btn.getAttribute('data-cand');
        if (cur.indexOf(name) < 0) cur.push(name);
        ta.value = cur.join(', ');
      });
    });
    var rtf = $('wsRouteForm'); if (rtf) rtf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var raw = strVal('ws-route-cities');
      var cities = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      cities = cities.filter(function (c, i) { return cities.indexOf(c) === i; });
      var out = $('wsRouteOut'), ref = $('wsRouteRefusal');
      if (cities.length < 1 || cities.length > 10) { if (out) out.textContent = 'Enter 1–10 candidate cities.'; return; }
      if (cities.some(function (c) { return c.toLowerCase() === b.city.toLowerCase(); })) { if (out) out.textContent = 'The base city (' + b.city + ') is not a routing candidate — routing answers “where next”, not the city already booked.'; return; }
      setBusy('wsRouting', true);
      try {
        var d = await postStep('/api/workspace/route', { candidateCities: cities });
        if (d.notAvailable) { if (ref) ref.innerHTML = notAvailableHtml('Routing'); }
        else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('routing', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          var prev = ws.steps.routing; var res = d.result || {};
          if (prev) res.supersedes = prev.recordedAt;
          if (d.receipts && res.candidates) res.candidates.forEach(function (c, i) { if (!c.receipts && d.receipts[i]) c.receipts = [d.receipts[i]]; });
          ws.steps.routing = { result: res, recordedAt: d.recordedAt || isoNow() }; save(); render();
        } else { if (ref) ref.innerHTML = refusalHtml('routing', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) { if (ref) ref.innerHTML = refusalHtml('routing', 'REQUEST_FAILED', err.message, ''); }
      setBusy('wsRouting', false, 'Rank candidates');
    });
    // Envelope
    var ef = $('wsEnvForm'); if (ef) ef.addEventListener('submit', async function (e) {
      e.preventDefault();
      var kind = (document.querySelector('input[name="ws-env-kind"]:checked') || {}).value;
      var value = kind === 'maxGuarantee' ? numVal('ws-env-max') : numVal('ws-env-target');
      var out = $('wsEnvOut'), ref = $('wsEnvRefusal');
      if (value == null || value < 0 || (kind === 'targetTickets' && Math.floor(value) !== value)) { if (out) out.textContent = 'Enter exactly one valid input: a max guarantee at or above 0, or a target ticket count above 0.'; return; }
      if (netOf() <= 0) { if (out) out.textContent = 'Net per ticket is not positive — no envelope can be computed.'; return; }
      setBusy('wsEnvelope', true);
      try {
        var stepInput = kind === 'maxGuarantee' ? { maxGuarantee: value } : { targetTickets: value };
        var d = await postStep('/api/workspace/envelope', stepInput);
        if (d.notAvailable) {
          var local = envelopeLocal(kind, value);
          var prev = ws.steps.envelope; if (prev) local.supersedes = prev.recordedAt;
          ws.steps.envelope = { result: local, recordedAt: isoNow() }; save(); render();
        } else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('envelope', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          var prev2 = ws.steps.envelope; var res = d.result || {};
          if (prev2) res.supersedes = prev2.recordedAt;
          ws.steps.envelope = { result: res, recordedAt: d.recordedAt || isoNow() }; save(); render();
        } else { if (ref) ref.innerHTML = refusalHtml('envelope', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) {
        var local2 = envelopeLocal(kind, value);
        var prev3 = ws.steps.envelope; if (prev3) local2.supersedes = prev3.recordedAt;
        ws.steps.envelope = { result: local2, recordedAt: isoNow() }; save(); render();
      }
      setBusy('wsEnvelope', false, 'Compute envelope');
    });
    // Comparison
    var addBtn = $('wsCompAddBtn'); if (addBtn) addBtn.addEventListener('click', function () {
      if (compareCount >= 5) return;
      compareCount += 1; render();
    });
    var cf = $('wsCompForm'); if (cf) cf.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (compareInFlight) { var oBusy = $('wsCompOut'); if (oBusy) oBusy.textContent = 'A comparison is already running.'; return; }
      var offers = [];
      for (var i = 0; i < compareCount; i++) {
        var a = strVal('ws-comp-artist-' + i), c = strVal('ws-comp-city-' + i), g = numVal('ws-comp-g-' + i);
        if (!a || !c || g == null || g < 0) { var o0 = $('wsCompOut'); if (o0) o0.textContent = 'Each offer needs an artist, a city, and a guarantee at or above 0.'; return; }
        var offer = { artist: a, city: c, guarantee: g, ticketPrice: numVal('ws-comp-price-' + i), variableCost: numVal('ws-comp-cost-' + i), capacity: numVal('ws-comp-cap-' + i), venue: strVal('ws-comp-venue-' + i) || undefined };
        applyFixedInputs(offer, function (k) { return 'ws-comp-' + k + '-' + i; });
        offers.push(offer);
      }
      var out = $('wsCompOut'), ref = $('wsCompRefusal');
      var dup = offers.some(function (of) { return of.artist.toLowerCase() === b.artist.toLowerCase() && of.city.toLowerCase() === b.city.toLowerCase() && of.guarantee === b.guarantee && of.ticketPrice === b.ticketPrice && (of.variableCost || null) === (b.variableCost || null) && (of.capacity || null) === (b.capacity || null) && fixedSame(of, b); });
      if (dup) { if (out) out.textContent = 'An offer identical to the base offer on every commercial term is not a comparison — change at least one term.'; return; }
      var submitWorkspaceId = ws.workspaceId;
      compareInFlight = true;
      setBusy('wsComparison', true);
      try {
        var d = await postStep('/api/workspace/compare', { offers: offers });
        // Re-query after the await: any mid-flight render (Add-an-offer,
        // a new seeded verdict, another panel) replaces the panel's
        // elements, so the pre-await out/ref can point at detached nodes
        // and a refusal would be written nowhere visible.
        out = $('wsCompOut'); ref = $('wsCompRefusal');
        if (d.notAvailable) { if (ref) ref.innerHTML = notAvailableHtml('Comparison'); }
        else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('comparison', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          // postStep sent the pre-flight workspace, but seed() may have
          // replaced ws mid-flight (a new verdict run). Storing this
          // result would attach offers priced against the old base to
          // the new base — discard it and write nothing.
          if (!ws || ws.workspaceId !== submitWorkspaceId) {
            var oD = $('wsCompOut'); if (oD) oD.textContent = 'Comparison finished, but the workspace changed while it ran — the result was discarded and nothing was written.';
          } else {
            var prev = ws.steps.comparison; var res = d.result || {};
            if (prev) res.supersedes = prev.recordedAt;
            ws.steps.comparison = { result: res, recordedAt: d.recordedAt || isoNow() }; save(); render();
          }
        } else { if (ref) ref.innerHTML = refusalHtml('comparison', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) { ref = $('wsCompRefusal'); if (ref) ref.innerHTML = refusalHtml('comparison', 'REQUEST_FAILED', err.message, ''); }
      compareInFlight = false;
      setBusy('wsComparison', false, 'Compare offers');
    });
    // Settlement
    var sf = $('wsSettleForm'); if (sf) sf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var att = numVal('ws-settle-att');
      var out = $('wsSettleOut'), ref = $('wsSettleRefusal');
      if (att == null || att < 0 || Math.floor(att) !== att) { if (out) out.textContent = 'Enter actual attendance as a whole number at or above 0.'; return; }
      var cost = numVal('ws-settle-cost');
      if (cost != null && cost < 0) { if (out) out.textContent = 'Actual cost cannot be negative.'; return; }
      var noteText = strVal('ws-settle-note');
      setBusy('wsSettlement', true);
      try {
        var d = await postStep('/api/workspace/settle', { actualAttendance: att, actualVariableCostPerTicket: cost, note: noteText || undefined });
        if (d.notAvailable) {
          var local = settleLocal(att, cost, noteText);
          var prevS = ws.steps.settlements[ws.steps.settlements.length - 1];
          var entry = { result: local, recordedAt: local.recordedAt };
          if (prevS) entry.corrects = prevS.recordedAt;
          ws.steps.settlements.push(entry); ws.neverSettled = false; save(); render();
        } else if (d.status === 'step_refused') { if (ref) ref.innerHTML = refusalHtml('settlement', d.error && d.error.code, d.error && d.error.message, d.detail); }
        else if (d.status === 'ok') {
          var r = d.result || {};
          var prevS2 = ws.steps.settlements[ws.steps.settlements.length - 1];
          var entry2 = { result: r, recordedAt: d.recordedAt || isoNow() };
          if (prevS2) entry2.corrects = prevS2.recordedAt;
          ws.steps.settlements.push(entry2); ws.neverSettled = false; save(); render();
        } else { if (ref) ref.innerHTML = refusalHtml('settlement', 'UNKNOWN', 'Unexpected server response — discarded.', ''); }
      } catch (err) {
        var local2 = settleLocal(att, cost, noteText);
        var prevS3 = ws.steps.settlements[ws.steps.settlements.length - 1];
        var entry3 = { result: local2, recordedAt: local2.recordedAt };
        if (prevS3) entry3.corrects = prevS3.recordedAt;
        ws.steps.settlements.push(entry3); ws.neverSettled = false; save(); render();
      }
      setBusy('wsSettlement', false, 'Record settlement');
    });
    var ns = $('wsNeverSettledBtn'); if (ns) ns.addEventListener('click', function () {
      ws.neverSettled = true; ws.neverSettledAt = isoNow(); save(); render();
    });
  }

  window.OfferSheetWorkspace = { seed: seed, get: get, clear: clear };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
