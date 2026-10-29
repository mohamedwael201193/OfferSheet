/* OfferSheet Oracle — every metric recomputed in this browser.
   Fetches below touch ONLY trial-pack.json and /api/bench.
   The upload section uses FileReader only and never calls fetch. */
(function () {
  'use strict';

  var HISTORY_KEY = 'offersheet-oracle-history-v1';
  var REST_PATHS = ['/search', '/v2/insights', '/v2/analysis/compare', '/entities'];
  var LOAD_FAIL = 'could not load — no verdict computed here';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : String(n == null ? '' : n);
  }
  function money(n) {
    return typeof n === 'number' && Number.isFinite(n) ? '$' + n.toLocaleString('en-US') : String(n == null ? '' : n);
  }
  function signed(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return (n > 0 ? '+' : '') + n.toLocaleString('en-US');
  }
  function isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
  function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  /* Sorted-key canonicalisation: object keys sorted, array order kept. */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    var keys = Object.keys(v).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }

  async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) throw new Error('SHA-256 unavailable in this browser');
    var buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------------- shared data ---------------- */

  var state = { pack: null, packError: false, benchRuns: null, benchSource: null };

  async function loadPack() {
    var res = await fetch('trial-pack.json');
    if (!res.ok) throw new Error('trial-pack fetch failed');
    return await res.json();
  }

  function trialInput(t) { return t.input || t.inputs || {}; }
  function trialMisses(t) { return Array.isArray(t.misses) ? t.misses : []; }
  function missed(t, arm) { return trialMisses(t).some(function (m) { return m.arm === arm; }); }
  function computeTally(runs) {
    var n = runs.length;
    var gutSame = runs.filter(function (r) { return !missed(r, 'gut'); }).length;
    var webSame = runs.filter(function (r) { return !missed(r, 'web'); }).length;
    var changed = runs.filter(function (r) { return missed(r, 'gut') || missed(r, 'web'); }).length;
    return { n: n, gutSame: gutSame, webSame: webSame, changed: changed };
  }
  function tallyLine(t) {
    return 'Qloo changed the pick in ' + t.changed + '/' + t.n +
      ' trials (Gut agreed ' + t.gutSame + '/' + t.n +
      '; Web agreed ' + t.webSame + '/' + t.n + ')';
  }

  function normaliseTrial(t) {
    var inp = trialInput(t);
    var price = inp.ticketPrice;
    return {
      source: 'recorded', artist: inp.artist || '', city: inp.city || '',
      guarantee: inp.guarantee, ticketPrice: price, variableCost: null,
      net: isFiniteNum(price) ? price : null,
      tickets: t.breakEvenTickets, graphPick: t.graphPick || null,
      gutPick: t.gutPick || null, webPick: t.webPick || null,
      misses: trialMisses(t), recordedAt: t.recordedAt || null
    };
  }

  /* ---------------- evaluation: trial-pack ---------------- */

  function checkCard(status, title, details) {
    var cls = status === 'PASS' ? 'check-pass' : (status === 'FAIL' ? 'check-fail' : 'check-unknown');
    return '<div class="check ' + cls + '"><p class="check-title">' + esc(status) + ' — ' + esc(title) + '</p>' +
      details.map(function (d) { return '<p class="check-detail">' + esc(d) + '</p>'; }).join('') + '</div>';
  }

  async function runPackChecks() {
    var box = $('evalPack');
    var pack;
    try { pack = await loadPack(); } catch (e) {
      box.innerHTML = checkCard('cannot verify', 'Trial-pack load', [LOAD_FAIL]);
      return null;
    }
    state.pack = pack;
    var cards = [];
    var recomputedHashes = [];
    for (var i = 0; i < pack.trials.length; i++) {
      var t = pack.trials[i];
      var inp = trialInput(t);
      var core = { inputs: inp, breakEvenTickets: t.breakEvenTickets, graphPick: t.graphPick, recordedAt: t.recordedAt };
      var recomputed;
      try { recomputed = await sha256Hex(canon(core)); } catch (e) {
        box.innerHTML = checkCard('cannot verify', 'SHA-256', ['SHA-256 is unavailable in this browser — no check was computed.']);
        return null;
      }
      recomputedHashes.push(recomputed);
      var hashOk = recomputed === t.sha256;
      cards.push(checkCard(hashOk ? 'PASS' : 'FAIL',
        'Trial ' + (i + 1) + ' hash — ' + (inp.artist || '') + ', ' + (inp.city || ''),
        hashOk
          ? ['Recomputed hash matches the recorded sha256.']
          : ['Field sha256: recomputed ' + recomputed + ' does not match recorded ' + (t.sha256 || '(absent)') + '.']));
      var net = isFiniteNum(inp.ticketPrice) ? inp.ticketPrice - (isFiniteNum(inp.variableCost) ? inp.variableCost : 0) : null;
      var expected = (isFiniteNum(inp.guarantee) && net !== null && net > 0) ? Math.ceil(inp.guarantee / net) : null;
      var beOk = expected !== null && expected === t.breakEvenTickets;
      cards.push(checkCard(beOk ? 'PASS' : 'FAIL',
        'Trial ' + (i + 1) + ' break-even — ' + (inp.artist || '') + ', ' + (inp.city || ''),
        beOk
          ? ['Recomputed ceil(guarantee / ticketPrice) = ' + fmt(expected) + ', matching recorded breakEvenTickets.']
          : ['Field breakEvenTickets: recomputed ' + (expected === null ? '(not computable from these inputs)' : fmt(expected)) +
             ' does not match recorded ' + fmt(t.breakEvenTickets) + '.']));
    }
    var packRecomputed;
    try { packRecomputed = await sha256Hex(recomputedHashes.join('')); } catch (e) {
      packRecomputed = null;
    }
    var packOk = packRecomputed !== null && packRecomputed === pack.packSha256;
    cards.push(checkCard(packOk ? 'PASS' : 'FAIL', 'Pack hash',
      packOk
        ? ['Recomputed pack hash over the joined trial hashes matches the recorded packSha256.']
        : ['Field packSha256: recomputed ' + (packRecomputed || '(unavailable)') + ' does not match recorded ' + (pack.packSha256 || '(absent)') + '.']));
    box.innerHTML = cards.join('');
    return pack;
  }

  /* ---------------- evaluation: tally ---------------- */

  async function loadBenchRuns() {
    try {
      var res = await fetch('/api/bench');
      if (!res.ok) throw new Error('bench unavailable');
      var data = await res.json();
      if (!Array.isArray(data.runs)) throw new Error('bench shape unexpected');
      return { runs: data.runs, source: 'bench' };
    } catch (e) {
      return { runs: null, source: 'fallback' };
    }
  }

  async function runTallyChecks(pack) {
    var box = $('evalTally');
    var cards = [];
    var packTrials = (pack && Array.isArray(pack.trials)) ? pack.trials : [];
    if (packTrials.length === 0) {
      box.innerHTML = checkCard('cannot verify', 'Tally', [LOAD_FAIL]);
      return;
    }
    var packTally = computeTally(packTrials);
    cards.push(checkCard('PASS', 'Tally from trial-pack.json',
      [tallyLine(packTally) + '. Computed in this browser from the miss data.']));
    var bench = await loadBenchRuns();
    if (bench.runs) {
      state.benchRuns = bench.runs;
      var benchTally = computeTally(bench.runs);
      var fields = ['changed', 'gutSame', 'webSame', 'n'];
      var differing = fields.filter(function (f) { return packTally[f] !== benchTally[f]; });
      if (differing.length === 0) {
        cards.push(checkCard('PASS', 'Tally match with bench data',
          [tallyLine(benchTally) + '. The bench-derived tally matches the trial-pack tally.']));
      } else {
        cards.push(checkCard('FAIL', 'Tally match with bench data',
          ['Field ' + differing.join(', ') + ': trial-pack tally ' + tallyLine(packTally) +
           ' does not match bench tally ' + tallyLine(benchTally) + '.']));
      }
    } else {
      cards.push(checkCard('cannot verify', 'Tally match with bench data',
        ['Bench endpoint unavailable — tally recomputed from trial-pack.json trials only; no separate bench tally to compare against.']));
    }
    box.innerHTML = cards.join('');
  }

  /* ---------------- evaluation: coverage ---------------- */

  function coverageFields(t, benchByRecordedAt) {
    var inp = trialInput(t);
    var benchMatch = benchByRecordedAt && t.recordedAt ? benchByRecordedAt[t.recordedAt] : null;
    return [
      { name: 'graph pick', present: isNonEmptyString(t.graphPick) },
      { name: 'gut pick', present: isNonEmptyString(t.gutPick) },
      { name: 'web pick', present: isNonEmptyString(t.webPick) },
      { name: 'misses', present: Array.isArray(t.misses) },
      { name: 'providers', present: !!(benchMatch && benchMatch.providers && Object.keys(benchMatch.providers).length > 0) },
      { name: 'timing', present: isFiniteNum(t.timingMs) }
    ];
  }

  function runCoverageChecks(pack) {
    var box = $('evalCoverage');
    var packTrials = (pack && Array.isArray(pack.trials)) ? pack.trials : [];
    if (packTrials.length === 0) {
      box.innerHTML = checkCard('cannot verify', 'Coverage', [LOAD_FAIL]);
      return;
    }
    var benchByRecordedAt = {};
    (state.benchRuns || []).forEach(function (r) { if (r.recordedAt) benchByRecordedAt[r.recordedAt] = r; });
    var fieldNames = ['graph pick', 'gut pick', 'web pick', 'misses', 'providers', 'timing'];
    var totals = {};
    fieldNames.forEach(function (f) { totals[f] = 0; });
    var rows = packTrials.map(function (t, i) {
      var fields = coverageFields(t, benchByRecordedAt);
      fields.forEach(function (f) { if (f.present) totals[f.name] += 1; });
      var present = fields.filter(function (f) { return f.present; });
      var absent = fields.filter(function (f) { return !f.present; });
      return checkCard('PASS', 'Trial ' + (i + 1) + ' coverage — ' + (trialInput(t).artist || '') + ', ' + (trialInput(t).city || ''),
        [present.length + ' of ' + fields.length + ' evidence fields present; absent: ' +
         (absent.length ? absent.map(function (f) { return f.name; }).join(', ') : 'none') + '.']);
    });
    var totalCards = fieldNames.map(function (f) {
      return checkCard('PASS', 'Coverage total — ' + f,
        [f + ' present in ' + totals[f] + ' of ' + packTrials.length + ' trials.']);
    });
    box.innerHTML = rows.join('') + totalCards.join('');
  }

  /* ---------------- history ---------------- */

  function loadHistory() {
    try {
      var raw = window.localStorage.getItem(HISTORY_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function saveHistory(entries) {
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch (e) { /* storage unavailable: history stays in memory only */ }
  }
  function numOrNull(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return isFiniteNum(n) ? n : null;
  }

  function normaliseVerdictObject(v) {
    if (!v || typeof v !== 'object') return null;
    var inp = v.inputs || v.input || v;
    var be = v.breakEven || {};
    var price = numOrNull(v.ticketPrice != null ? v.ticketPrice : (inp.ticketPrice != null ? inp.ticketPrice : (be.price && be.price.value)));
    var costRaw = v.variableCost != null ? v.variableCost : inp.variableCost;
    if (costRaw == null && be.variableCost != null) costRaw = (typeof be.variableCost === 'object' ? be.variableCost.value : be.variableCost);
    var cost = numOrNull(costRaw);
    var tickets = numOrNull(v.breakEvenTickets != null ? v.breakEvenTickets : (v.tickets != null ? v.tickets : be.tickets));
    var guarantee = numOrNull(v.guarantee != null ? v.guarantee : inp.guarantee);
    var artist = v.artist || inp.artist;
    var city = v.city || inp.city;
    if (!isNonEmptyString(artist) || !isNonEmptyString(city)) return null;
    if (guarantee === null || guarantee < 0) return null;
    if (price === null || price <= 0) return null;
    if (tickets === null || !Number.isInteger(tickets) || tickets < 0) return null;
    var net = numOrNull(v.net != null ? v.net : be.net);
    if (net === null) net = price - (cost || 0);
    var misses = v.misses || (v.missTrial && v.missTrial.misses) || (v.race && v.race.misses) || [];
    return {
      id: 'h-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
      source: 'history', artist: artist, city: city, guarantee: guarantee,
      ticketPrice: price, variableCost: cost, net: net, tickets: tickets,
      graphPick: v.graphPick || (v.openers && v.openers.topPick) || null,
      gutPick: v.gutPick || null, webPick: v.webPick || null,
      misses: Array.isArray(misses) ? misses : [],
      recordedAt: v.recordedAt || new Date().toISOString()
    };
  }

  function renderHistory() {
    var entries = loadHistory();
    var list = $('historyList');
    var empty = $('historyEmpty');
    var clearBtn = $('clearHistoryBtn');
    if (!list || !empty || !clearBtn) return; // No-op on pages without the oracle panel (e.g. app.html loads this file only for history recording).
    if (entries.length === 0) {
      empty.hidden = false;
      list.innerHTML = '';
      clearBtn.hidden = true;
    } else {
      empty.hidden = true;
      clearBtn.hidden = false;
      list.innerHTML = entries.map(function (e) {
        return '<li class="history-item"><div class="history-text"><p class="check-title">' +
          esc(e.artist) + ', ' + esc(e.city) + '</p>' +
          '<p class="check-detail">Guarantee ' + money(e.guarantee) + ' · ticket price ' + money(e.ticketPrice) +
          ' · ' + fmt(e.tickets) + ' tickets · recorded ' + esc((e.recordedAt || '').slice(0, 10)) + '</p></div>' +
          '<button class="btn" type="button" data-delete-id="' + esc(e.id) + '">Delete</button></li>';
      }).join('');
      list.querySelectorAll('[data-delete-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          saveHistory(loadHistory().filter(function (e) { return e.id !== b.getAttribute('data-delete-id'); }));
          renderHistory(); renderCompareOptions();
        });
      });
    }
  }

  window.OfferSheetOracle = {
    record: function (verdictObject) {
      var entry = normaliseVerdictObject(verdictObject);
      if (!entry) return null;
      var entries = loadHistory();
      entries.push(entry);
      saveHistory(entries);
      renderHistory(); renderCompareOptions();
      return entry;
    },
    list: loadHistory,
    remove: function (id) {
      saveHistory(loadHistory().filter(function (e) { return e.id !== id; }));
      renderHistory(); renderCompareOptions();
    },
    clear: function () { saveHistory([]); renderHistory(); renderCompareOptions(); }
  };

  /* ---------------- recorded trials sub-panel ---------------- */

  function renderRecordedTrials() {
    var box = $('recordedTrials');
    if (!box) return; // No-op on pages without the oracle panel.
    if (!state.pack || !Array.isArray(state.pack.trials)) {
      box.innerHTML = checkCard('cannot verify', 'Recorded trials', [LOAD_FAIL]);
      return;
    }
    box.innerHTML = state.pack.trials.map(function (t) {
      var inp = trialInput(t);
      return '<div class="check"><p class="check-title">' + esc(inp.artist || '') + ', ' + esc(inp.city || '') + '</p>' +
        '<p class="check-detail">Guarantee ' + money(inp.guarantee) + ' · ticket price ' + money(inp.ticketPrice) +
        ' · ' + fmt(t.breakEvenTickets) + ' tickets · recorded ' + esc((t.recordedAt || '').slice(0, 10)) + '</p></div>';
    }).join('');
  }

  /* ---------------- comparison ---------------- */

  function compareEntries() {
    var recorded = (state.pack && Array.isArray(state.pack.trials)) ? state.pack.trials.map(normaliseTrial) : [];
    var history = loadHistory();
    return recorded.concat(history);
  }

  function pickCell(text) {
    if (!isNonEmptyString(text)) return 'Not recorded in this entry.';
    if (text.length <= 120) return esc(text);
    return esc(text.slice(0, 120)) + '…<details><summary>Full pick</summary>' + esc(text) + '</details>';
  }

  function renderCompareOptions() {
    var entries = compareEntries();
    var selA = $('compareA'), selB = $('compareB');
    if (!selA || !selB) return; // No-op on pages without the oracle panel.
    var prevA = selA.value, prevB = selB.value;
    var opts = entries.map(function (e, i) {
      var label = (e.source === 'recorded' ? 'Recorded trial — ' : 'History — ') +
        e.artist + ', ' + e.city + ', recorded ' + (e.recordedAt || '').slice(0, 10);
      return '<option value="' + i + '">' + esc(label) + '</option>';
    }).join('');
    selA.innerHTML = opts; selB.innerHTML = opts;
    if (entries.length > 0) {
      selA.value = (prevA !== '' && Number(prevA) < entries.length) ? prevA : '0';
      selB.value = (prevB !== '' && Number(prevB) < entries.length) ? prevB :
        (entries.length > 2 ? '2' : String(entries.length - 1));
    }
  }

  function runComparison() {
    var entries = compareEntries();
    var status = $('compareStatus'), wrap = $('compareTableWrap'), delta = $('compareDelta');
    if (entries.length < 2) {
      status.textContent = LOAD_FAIL;
      wrap.innerHTML = ''; delta.textContent = '';
      return;
    }
    var a = entries[Number($('compareA').value) || 0];
    var b = entries[Number($('compareB').value) || 0];
    if (!a || !b) { status.textContent = LOAD_FAIL; wrap.innerHTML = ''; delta.textContent = ''; return; }
    status.textContent = 'Comparison computed from the two selected entries.';
    function row(label, va, vb, diff) {
      return '<tr><th scope="row">' + esc(label) + '</th><td>' + va + '</td><td>' + vb + '</td><td>' + diff + '</td></tr>';
    }
    function missText(e) {
      if (!Array.isArray(e.misses) || e.misses.length === 0) return 'No misses recorded in this entry.';
      return esc(e.misses.map(function (m) { return m.arm; }).join(', ')) + ' (' + e.misses.length + ' recorded)';
    }
    function sameDiff(x, y) {
      if (x == null || y == null) return 'Not comparable — one side not recorded.';
      return x === y ? 'same' : 'different';
    }
    var dTickets = a.tickets - b.tickets;
    var dNet = (a.net != null && b.net != null) ? a.net - b.net : null;
    var dGuarantee = a.guarantee - b.guarantee;
    wrap.innerHTML = '<table><thead><tr><th scope="col">Field</th><th scope="col">First entry</th>' +
      '<th scope="col">Second entry</th><th scope="col">Difference (first − second, arithmetic display only)</th></tr></thead><tbody>' +
      row('Artist', esc(a.artist), esc(b.artist), sameDiff(a.artist, b.artist)) +
      row('City', esc(a.city), esc(b.city), sameDiff(a.city, b.city)) +
      row('Guarantee', money(a.guarantee), money(b.guarantee), signed(dGuarantee)) +
      row('Ticket price', money(a.ticketPrice), money(b.ticketPrice), signed(a.ticketPrice - b.ticketPrice)) +
      row('Net per ticket', a.net != null ? money(a.net) : 'Not recorded in this entry.',
        b.net != null ? money(b.net) : 'Not recorded in this entry.', dNet !== null ? signed(dNet) : 'Not comparable.') +
      row('Break-even tickets', fmt(a.tickets), fmt(b.tickets), signed(dTickets)) +
      row('Graph pick', pickCell(a.graphPick), pickCell(b.graphPick), sameDiff(a.graphPick, b.graphPick)) +
      row('Gut pick', pickCell(a.gutPick), pickCell(b.gutPick), sameDiff(a.gutPick, b.gutPick)) +
      row('Web pick', pickCell(a.webPick), pickCell(b.webPick), sameDiff(a.webPick, b.webPick)) +
      row('Misses', missText(a), missText(b), signed((a.misses || []).length - (b.misses || []).length)) +
      row('Recorded at', esc(a.recordedAt || ''), esc(b.recordedAt || ''), 'Not comparable.') +
      '</tbody></table>';
    delta.textContent = 'Delta tickets = first − second (arithmetic display only): ' + signed(dTickets) + '.';
  }

  /* ---------------- upload and verify ----------------
     This section reads the uploaded file with FileReader only.
     It makes no network call for uploads. */

  function rebuildRestUrl(replay, receipt) {
    var url = (replay && replay.url) || receipt.url || null;
    if (url) return { url: url, rebuiltFrom: 'url' };
    var path = (replay && replay.path) || receipt.path || null;
    var baseUrl = (replay && replay.baseUrl) || receipt.baseUrl || null;
    if (!path || !baseUrl) return null;
    var params = (replay && replay.params) || receipt.params || {};
    var built = new URL(path, baseUrl);
    Object.entries(params).forEach(function (pair) {
      var k = pair[0], v = pair[1];
      if (v === undefined || v === null || v === '') return;
      built.searchParams.set(k, String(v));
    });
    return { url: built.toString(), rebuiltFrom: 'path + params', path: path };
  }

  async function verifyReceipt(item, label) {
    var checks = [];
    var receipt = item;
    var replay = receipt.replay || null;
    var claim = receipt.claim || receipt.operation || 'unnamed';
    var title = label + ' — ' + claim;
    if (replay && (replay.kind === 'mcp' || replay.tool)) {
      var tool = replay.tool;
      if (!tool || replay.args === undefined) {
        checks.push({ status: 'cannot verify', title: title, field: 'replay.tool', detail: 'MCP replay payload lacks a tool or args — hash cannot be recomputed from this payload.' });
      } else {
        var recomputed = await sha256Hex(tool + ' ' + JSON.stringify(replay.args));
        checks.push(recomputed === receipt.requestHash
          ? { status: 'PASS', title: title, field: 'requestHash', detail: 'Recomputed MCP args hash matches the recorded requestHash.' }
          : { status: 'FAIL', title: title, field: 'requestHash', detail: 'Recomputed ' + recomputed + ' does not match recorded ' + (receipt.requestHash || '(absent)') + '.' });
      }
      return checks;
    }
    if ((replay && (replay.kind === 'rest' || replay.path)) || receipt.path) {
      var rebuilt = rebuildRestUrl(replay || {}, receipt);
      var path = (replay && replay.path) || receipt.path || null;
      if (path) {
        checks.push(REST_PATHS.indexOf(path) >= 0
          ? { status: 'PASS', title: title, field: 'path', detail: 'Path is inside the replay allowlist.' }
          : { status: 'FAIL', title: title, field: 'path', detail: 'Path ' + path + ' is outside the replay allowlist.' });
      }
      if (!rebuilt) {
        checks.push({ status: 'cannot verify', title: title, field: 'requestHash', detail: 'cannot verify — URL not rebuildable from this payload' });
      } else {
        var restHash = await sha256Hex('GET ' + rebuilt.url);
        checks.push(restHash === receipt.requestHash
          ? { status: 'PASS', title: title, field: 'requestHash', detail: 'Recomputed REST hash over the rebuilt URL matches the recorded requestHash.' }
          : { status: 'FAIL', title: title, field: 'requestHash', detail: 'Recomputed ' + restHash + ' does not match recorded ' + (receipt.requestHash || '(absent)') + '.' });
      }
      return checks;
    }
    checks.push({ status: 'cannot verify', title: title, field: 'replay', detail: 'No replay payload in this receipt — hash cannot be recomputed from this payload.' });
    return checks;
  }

  function verifyBreakEven(obj, label) {
    var checks = [];
    var inp = obj.inputs || obj.input || obj;
    var guarantee = numOrNull(inp.guarantee != null ? inp.guarantee : obj.guarantee);
    var price = numOrNull(inp.ticketPrice != null ? inp.ticketPrice : obj.ticketPrice);
    var costRaw = inp.variableCost != null ? inp.variableCost : obj.variableCost;
    var cost = numOrNull(costRaw);
    if (guarantee === null || guarantee < 0) {
      checks.push({ status: 'FAIL', title: label, field: 'guarantee', detail: 'Guarantee is absent or below zero — no break-even number can be recomputed.' });
      return checks;
    }
    if (price === null || price <= 0) {
      checks.push({ status: 'FAIL', title: label, field: 'ticketPrice', detail: 'Ticket price is absent or not above zero — no break-even number can be recomputed.' });
      return checks;
    }
    var net = price - (cost || 0);
    if (net <= 0) {
      checks.push({ status: 'FAIL', title: label, field: 'net', detail: 'Net per ticket is not above zero — no break-even number can be recomputed.' });
      return checks;
    }
    var expected = Math.ceil(guarantee / net);
    var costNote = cost === null ? ' (before variable costs)' : '';
    var present = null, fieldName = 'breakEvenTickets';
    if (obj.breakEvenTickets != null) { present = numOrNull(obj.breakEvenTickets); fieldName = 'breakEvenTickets'; }
    else if (obj.tickets != null) { present = numOrNull(obj.tickets); fieldName = 'tickets'; }
    else if (obj.breakEven && obj.breakEven.tickets != null) { present = numOrNull(obj.breakEven.tickets); fieldName = 'breakEven.tickets'; }
    if (present === null) {
      checks.push({ status: 'cannot verify', title: label, field: 'breakEvenTickets', detail: 'No break-even tickets field in this payload — nothing to compare against.' });
    } else {
      checks.push(present === expected
        ? { status: 'PASS', title: label, field: fieldName, detail: 'Recomputed ceil(guarantee / net) = ' + fmt(expected) + costNote + ', matching the recorded value.' }
        : { status: 'FAIL', title: label, field: fieldName, detail: 'Recomputed ceil(guarantee / net) = ' + fmt(expected) + costNote + ' does not match recorded ' + fmt(present) + '.' });
    }
    if (obj.breakEven && obj.breakEven.net != null) {
      var recordedNet = numOrNull(obj.breakEven.net);
      checks.push(recordedNet === net
        ? { status: 'PASS', title: label, field: 'breakEven.net', detail: 'Recorded net matches recomputed net.' }
        : { status: 'FAIL', title: label, field: 'breakEven.net', detail: 'Recomputed net ' + fmt(net) + ' does not match recorded ' + fmt(recordedNet) + '.' });
    }
    return checks;
  }

  async function verifyWorkspace(obj, label) {
    var checks = [];
    var base = obj.baseOffer;
    if (!base || typeof base !== 'object') {
      checks.push({ status: 'cannot verify', title: label, field: 'baseOffer', detail: 'No baseOffer in this workspace — workspaceId cannot be recomputed.' });
      return checks;
    }
    var transformed = Object.assign({}, base);
    ['artist', 'city', 'venue'].forEach(function (k) {
      if (typeof transformed[k] === 'string') transformed[k] = transformed[k].trim().toLowerCase();
    });
    var baseReceipts = (obj.baseVerdict && Array.isArray(obj.baseVerdict.receipts)) ? obj.baseVerdict.receipts : null;
    if (!baseReceipts) {
      checks.push({ status: 'cannot verify', title: label, field: 'baseVerdict.receipts', detail: 'No base receipts in this workspace — workspaceId cannot be recomputed.' });
      return checks;
    }
    var hashes = baseReceipts.map(function (r) { return r.requestHash; }).filter(function (h) { return typeof h === 'string'; }).sort();
    var recomputed = await sha256Hex(canon(transformed) + '|' + hashes.join(','));
    checks.push(recomputed === obj.workspaceId
      ? { status: 'PASS', title: label, field: 'workspaceId', detail: 'Recomputed workspaceId matches the recorded workspaceId.' }
      : { status: 'FAIL', title: label, field: 'workspaceId', detail: 'Recomputed ' + recomputed + ' does not match recorded ' + (obj.workspaceId || '(absent)') + '.' });
    if (obj.baseVerdict && obj.baseVerdict.tickets != null) {
      var beChecks = verifyBreakEven({ inputs: base, breakEvenTickets: obj.baseVerdict.tickets }, label + ' base verdict');
      checks = checks.concat(beChecks);
    }
    return checks;
  }

  async function verifyUpload(parsed) {
    var checks = [];
    var items = Array.isArray(parsed) ? parsed : [parsed];
    for (var i = 0; i < items.length; i++) {
      var obj = items[i];
      var label = 'Item ' + (i + 1);
      if (!obj || typeof obj !== 'object') {
        checks.push({ status: 'cannot verify', title: label, field: 'shape', detail: 'Item is not an object — no check applies.' });
        continue;
      }
      var isWorkspace = obj.workspaceVersion !== undefined || (obj.baseOffer && typeof obj.baseOffer === 'object');
      var isReceipt = typeof obj.requestHash === 'string' || (obj.replay && typeof obj.replay === 'object');
      var isVerdict = !!(obj.inputs || obj.input || (isNonEmptyString(obj.artist) && obj.guarantee !== undefined));
      var receipts = Array.isArray(obj.receipts) ? obj.receipts : [];
      if (isWorkspace) {
        checks = checks.concat(await verifyWorkspace(obj, label + ' workspace'));
        var baseReceipts = (obj.baseVerdict && Array.isArray(obj.baseVerdict.receipts)) ? obj.baseVerdict.receipts : [];
        for (var r = 0; r < baseReceipts.length; r++) {
          checks = checks.concat(await verifyReceipt(baseReceipts[r], label + ' base receipt ' + (r + 1)));
        }
      }
      if (isReceipt && !isWorkspace) {
        checks = checks.concat(await verifyReceipt(obj, label + ' receipt'));
      }
      for (var j = 0; j < receipts.length; j++) {
        checks = checks.concat(await verifyReceipt(receipts[j], label + ' receipt ' + (j + 1)));
      }
      if (isVerdict) {
        checks = checks.concat(verifyBreakEven(obj, label + ' verdict'));
      }
      if (!isWorkspace && !isReceipt && !isVerdict && receipts.length === 0) {
        checks.push({ status: 'cannot verify', title: label, field: 'shape', detail: 'Shape not recognised as a verdict, workspace, or receipt — no check applies.' });
      }
    }
    return checks;
  }

  function renderUploadChecks(checks) {
    var box = $('uploadResults');
    if (checks.length === 0) {
      box.innerHTML = checkCard('cannot verify', 'Upload', ['No checks applied to this file.']);
      return;
    }
    var pass = checks.filter(function (c) { return c.status === 'PASS'; }).length;
    var fail = checks.filter(function (c) { return c.status === 'FAIL'; }).length;
    var unknown = checks.length - pass - fail;
    box.innerHTML = '<p class="status-line">' + pass + ' passed, ' + fail + ' failed, ' + unknown + ' could not be verified.</p>' +
      checks.map(function (c) { return checkCard(c.status, c.title, ['Field ' + c.field + ': ' + c.detail]); }).join('');
  }

  /* ---------------- wiring ---------------- */

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('historyList')) return; // Oracle panel absent (e.g. app.html): window.OfferSheetOracle stays exposed for recording, boot wiring skipped.
    renderHistory();
    loadPack().then(function (pack) {
      state.pack = pack;
      renderRecordedTrials();
      renderCompareOptions();
    }).catch(function () {
      state.packError = true;
      renderRecordedTrials();
      renderCompareOptions();
      $('compareStatus').textContent = LOAD_FAIL;
    });

    $('runEvalBtn').addEventListener('click', async function () {
      $('evalStatus').textContent = 'Checking…';
      try {
        var pack = await runPackChecks();
        if (pack) {
          await runTallyChecks(pack);
          runCoverageChecks(pack);
          $('evalStatus').textContent = 'Evaluation checks complete.';
        } else {
          $('evalTally').innerHTML = checkCard('cannot verify', 'Tally', [LOAD_FAIL]);
          $('evalCoverage').innerHTML = checkCard('cannot verify', 'Coverage', [LOAD_FAIL]);
          $('evalStatus').textContent = LOAD_FAIL;
        }
      } catch (e) {
        $('evalStatus').textContent = LOAD_FAIL;
      }
    });

    $('compareBtn').addEventListener('click', runComparison);
    $('compareA').addEventListener('change', runComparison);
    $('compareB').addEventListener('change', runComparison);

    $('clearHistoryBtn').addEventListener('click', function () {
      saveHistory([]);
      renderHistory(); renderCompareOptions();
    });

    $('uploadFile').addEventListener('change', function () {
      var file = $('uploadFile').files && $('uploadFile').files[0];
      if (!file) return;
      $('uploadStatus').textContent = 'Checking…';
      var reader = new FileReader();
      reader.onload = async function () {
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) {
          $('uploadStatus').textContent = 'File could not be checked.';
          $('uploadResults').innerHTML = checkCard('FAIL', 'File parse', ['Field file: file is not valid JSON.']);
          return;
        }
        try {
          var checks = await verifyUpload(parsed);
          $('uploadStatus').textContent = 'File checked — results below.';
          renderUploadChecks(checks);
        } catch (e) {
          $('uploadStatus').textContent = 'File could not be checked.';
          $('uploadResults').innerHTML = checkCard('cannot verify', 'File', ['Field file: ' + e.message]);
        }
      };
      reader.onerror = function () {
        $('uploadStatus').textContent = 'File could not be read.';
        $('uploadResults').innerHTML = checkCard('FAIL', 'File read', ['Field file: file could not be read.']);
      };
      reader.readAsText(file);
    });
  });
})();
