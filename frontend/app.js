// OfferSheet frontend — no framework, no build step, no keys, no Qloo calls.
// Every data call goes to the same-origin backend (/api/*). No external API
// call is ever made from this page except the theme's font stylesheet.
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : esc(n));
const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : esc(n));

function setBadge(text, cls) {
  const b = $('qlooBadge');
  b.textContent = text;
  b.className = `badge ${cls || ''}`;
}

async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    if (!h.qlooConfigured) {
      setBadge('Qloo not configured — verdicts unavailable (503)', 'red');
    } else {
      // "Configured" alone is amber, never green: green requires a live verdict.
      setBadge('Qloo configured — awaiting first live call', 'amber');
    }
  } catch {
    setBadge('Backend unreachable', 'red');
  }
}

async function loadBench() {
  try {
    const r = await fetch('/api/bench');
    const b = await r.json();
    const runs = Array.isArray(b.runs) ? b.runs : [];
    $('benchBlock').innerHTML = runs.length === 0
      ? `<p class="empty">${esc(b.note || 'No benchmark runs recorded yet.')}</p><p class="empty"><span class="next-action">Next action:</span> run a live verdict, then record a trial — nothing is listed here until a real run exists.</p>`
      : `<p>${runs.length} recorded trial(s).</p><ul>${runs.map((t) => `<li>${esc(t.question || '')} — Graph: ${esc(t.graphPick || '')}, misses: ${(t.misses || []).length}${(t.misses || []).map((m) => ` (${esc(m.arm)} picked “${esc(m.pick)}”)`).join('')}</li>`).join('')}</ul>`;
  } catch {
    $('benchBlock').innerHTML = '<p class="empty">Benchmark ledger unavailable. <span class="next-action">Next action:</span> check that the backend is running, then reload.</p>';
  }
}

function showStatus(html, cls) {
  const s = $('status');
  s.hidden = false;
  s.className = `status ${cls || ''}`;
  s.innerHTML = html;
}
function hideStatus() { $('status').hidden = true; }
function hideVerdict() {
  $('verdict').hidden = true;
  $('raceSection').hidden = true;
  $('receiptSection').hidden = true;
  $('formulaSection').hidden = true;
}
function setRunning(on) {
  document.querySelectorAll('#offerForm button').forEach((b) => { b.disabled = on; });
}

function kvOrList(value, title) {
  if (value === null || value === undefined) return `<h3>${esc(title)}</h3><p class="empty">Unavailable this run.</p>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `<h3>${esc(title)}</h3><p class="empty">No data returned this run.</p>`;
    const rows = value.map((v) => {
      if (v && typeof v === 'object') {
        const parts = Object.entries(v).map(([k, val]) => `${esc(k)}: ${esc(typeof val === 'object' ? JSON.stringify(val) : val)}`).join(' · ');
        return `<li>${parts}</li>`;
      }
      return `<li>${esc(v)}</li>`;
    }).join('');
    return `<h3>${esc(title)}</h3><ul>${rows}</ul>`;
  }
  if (typeof value === 'object') {
    const rows = Object.entries(value).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`).join('');
    return `<h3>${esc(title)}</h3><dl class="kv">${rows}</dl>`;
  }
  return `<h3>${esc(title)}</h3><p>${esc(value)}</p>`;
}

function armLane(label, arm) {
  if (!arm) return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-unavailable">Unavailable — no data this run.</p></div>`;
  if (arm.status === 'ok') {
    return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-pick">${esc(arm.pick)}</p></div>`;
  }
  return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-unavailable">Unavailable — ${esc(arm.reason || arm.status)}</p></div>`;
}

function renderArms(v) {
  const a = v.arms || {};
  $('armsBlock').innerHTML = armLane('Gut (LLM alone)', a.gut) + armLane('Graph (Qloo-grounded)', a.graph) + armLane('Web (LLM + generic web data)', a.web);
  if (v.missTrial) {
    const m = v.missTrial;
    $('missBlock').innerHTML = m.misses.length === 0
      ? '<p>Miss ledger: no misses this run — all arms agreed with Graph.</p>'
      : `<p>Miss ledger: ${m.misses.map((x) => `${esc(x.arm)} picked “${esc(x.pick)}” while Graph picked “${esc(x.graphPick)}”`).join('; ')}.</p>`;
  } else {
    $('missBlock').innerHTML = '<p>Miss ledger: no trial this run (a comparison arm was unavailable — no trial is fabricated).</p>';
  }
}

function renderReceipts(v) {
  const list = $('receiptList');
  list.innerHTML = '';
  const receipts = v.receipts || [];
  if (receipts.length === 0) {
    list.innerHTML = '<p class="empty">No receipts this run. <span class="next-action">Next action:</span> a verdict without receipts is withheld, not shown — see the status above.</p>';
    return;
  }
  receipts.forEach((r) => {
    const div = document.createElement('div');
    div.className = 'receipt';
    const replayBtn = r.replay
      ? `<button class="btn btn-sm" data-replay='${esc(JSON.stringify(r.replay))}'>Replay</button>`
      : '<em>No replay for this receipt</em>';
    div.innerHTML = `<div><div class="claim">${esc(r.claim)}</div><div class="meta">${esc(r.operation)} · requestId: ${esc(r.requestId ?? '—')} · results: ${esc(r.resultCount ?? '—')}</div></div>${replayBtn}`;
    list.appendChild(div);
  });
  list.querySelectorAll('[data-replay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const replay = JSON.parse(btn.getAttribute('data-replay'));
      const row = btn.closest('.receipt');
      const recorded = row ? row.querySelector('.meta')?.textContent : '';
      const recordedMatch = recorded ? recorded.match(/results:\s*(\d+)/) : null;
      const recordedCount = recordedMatch ? Number(recordedMatch[1]) : null;
      $('replayOut').textContent = 'Replaying the exact call…';
      try {
        const res = await fetch('/api/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(replay),
        });
        const out = await res.json();
        if (!res.ok) {
          $('replayOut').textContent = `Replay failed: ${out.error?.code || res.status} — ${out.error?.message || ''}. The original receipt above is unchanged.`;
          return;
        }
        const env = out.envelope || out.result;
        const count = env?.result_count ?? (Array.isArray(env?.results) ? env.results.length : null) ?? out.result?.resultCount ?? null;
        if (count === null || recordedCount === null) {
          $('replayOut').textContent = `Replayed live. Result count: ${count ?? 'unavailable'}. Compare with the receipt above — the same call, run again.`;
        } else if (count === recordedCount) {
          $('replayOut').textContent = `Replay match: live re-run returned ${count} results, the same as the receipt recorded.`;
        } else {
          $('replayOut').textContent = `Replay mismatch: live re-run returned ${count} results, but the receipt recorded ${recordedCount}. Live data changed between runs — the receipt is the record of the original run.`;
        }
      } catch (e) {
        $('replayOut').textContent = `Replay failed: ${e.message}`;
      }
    });
  });
}

function renderLegs(v) {
  const legs = v.legs || {};
  const rows = Object.entries(legs).map(([k, l]) => `<div><dt>${esc(k)}</dt><dd>${esc(l.status)}${l.reason ? ` — ${esc(l.reason)}` : ''}${l.note ? ` — ${esc(l.note)}` : ''}</dd></div>`).join('');
  const tm = v.ticketmaster ? `<div><dt>ticketmaster</dt><dd>${esc(v.ticketmaster.status)}${v.ticketmaster.venueName ? ` — ${esc(v.ticketmaster.venueName)}` : ''}</dd></div>` : '';
  const osm = v.osm ? `<div><dt>osm</dt><dd>${esc(v.osm.status)}${v.osm.displayName ? ` — ${esc(v.osm.displayName)}` : ''}</dd></div>` : '';
  const wd = v.wikidata ? `<div><dt>wikidata</dt><dd>${esc(v.wikidata.status)}</dd></div>` : '';
  $('legsBlock').innerHTML = `<dl class="kv">${rows}${tm}${osm}${wd}</dl>`;
}

function renderVerdict(v) {
  hideStatus();
  const be = v.breakEven;
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const cannot = known && be.tickets > cap.value;

  $('verdict').hidden = false;
  $('raceSection').hidden = false;
  $('receiptSection').hidden = false;
  $('formulaSection').hidden = false;

  $('verdictSubject').textContent = `${v.artist} in ${v.city} · guarantee ${money(v.guarantee)}`;
  $('beTickets').textContent = fmt(be.tickets);
  $('beVerdict').textContent = be.verdict || (be.note === 'no guarantee' ? 'No guarantee to cover — 0 tickets.' : '');
  $('cannotBox').hidden = !cannot;
  $('bePrice').textContent = `${money(be.price.value)} (${be.price.source})`;
  $('beNet').textContent = money(be.net);

  if (known) {
    $('capacityBadge').className = 'capacity-badge';
    $('capacityBadge').textContent = cap.source;
    $('unknownBox').hidden = true;
    $('beCapacity').textContent = `${fmt(cap.value)} (${cap.source})`;
    $('selloutBox').hidden = false;
    $('selloutPct').textContent = `${((be.tickets / cap.value) * 100).toFixed(1)}%`;
  } else {
    // Unknown capacity: verbatim MAX §2.6 wording, NO sellout percentage,
    // NO room-fill claim anywhere in this state.
    $('capacityBadge').className = 'capacity-badge unknown';
    $('capacityBadge').textContent = 'capacity unknown';
    $('unknownBox').hidden = false;
    $('beCapacity').textContent = 'Unknown';
    $('selloutBox').hidden = true;
    $('selloutPct').textContent = '';
  }

  const variableCost = be.price.value - be.net;
  $('workedExample').textContent = `ceil(${fmt(v.guarantee)} ÷ (${fmt(be.price.value)} − ${fmt(variableCost)})) = ${fmt(be.tickets)} tickets`;

  $('audienceNote').textContent = v.audience.note;
  $('audienceAreas').innerHTML = (v.audience.areas || []).map((a) => `<li>${esc(a.name || a.id || '')}</li>`).join('') || '<li>No areas returned</li>';
  const ranked = v.openers.ranked.length > 0 ? v.openers.ranked : v.openers.candidates;
  $('openerList').innerHTML = ranked.map((o) => `<li>${esc(o.name || o.id || '')}</li>`).join('') || '<li>No openers returned</li>';
  $('topPick').textContent = v.openers.topPick ? `Graph pick: ${v.openers.topPick}` : '';
  $('demoBlock').innerHTML = kvOrList(v.demographics, 'Demographics');
  $('trendBlock').innerHTML = kvOrList(v.trends, 'Trends (90 days)');
  $('tagsBlock').innerHTML = kvOrList(v.sharedTags, 'Shared tags');
  $('overlapBlock').innerHTML = kvOrList(v.overlap, 'Audience overlap');
  renderArms(v);
  renderReceipts(v);
  renderLegs(v);
  setBadge('Qloo live — verdict computed from live calls', 'green');
}

function renderNeedsInput(v) {
  hideVerdict();
  const btns = (v.candidates || []).map((c) => `<button class="btn btn-sm" data-entity="${esc(c.id || c.name || '')}">${esc(c.name || c.id || '')}</button>`).join(' ');
  showStatus(`<p class="big">More than one match — pick the one you mean.</p><p>${esc(v.message)}</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">${btns}</div>`, 'amber');
  document.querySelectorAll('[data-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      submitVerdict(false, btn.getAttribute('data-entity'));
    });
  });
}

async function submitVerdict(race, entityHint) {
  hideVerdict();
  setRunning(true);
  const t0 = Date.now();
  const timer = setInterval(() => {
    $('raceTimer').textContent = race ? `Running live… ${((Date.now() - t0) / 1000).toFixed(1)}s elapsed` : '';
  }, 100);
  showStatus('<p><span class="spinner" aria-hidden="true"></span>Running live…</p><div class="progress" aria-hidden="true"></div><p class="label">Every number below will come from a live call, or nothing will render.</p>', '');
  const body = {
    artist: $('artist').value.trim(),
    city: $('city').value.trim(),
    guarantee: Number($('guarantee').value),
  };
  const tp = $('ticketPrice').value;
  if (tp !== '') body.ticketPrice = Number(tp);
  const cap = $('capacity').value;
  if (cap !== '') body.capacity = Number(cap);
  if (entityHint) body.entityHint = entityHint;
  try {
    const res = await fetch(race ? '/api/race' : '/api/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const v = await res.json();
    clearInterval(timer);
    $('raceTimer').textContent = '';
    setRunning(false);
    if (!res.ok) {
      hideVerdict();
      if (v.error?.code === 'NOT_CONFIGURED' || res.status === 503) {
        showStatus('<p class="big">Qloo is not configured for this demo. No verdict can be computed without live Qloo data.</p><p>No card, no numbers. Nothing is mocked or invented.</p>', 'red');
      } else {
        showStatus(`<p class="big">${esc(v.error?.code || res.status)}</p><p>${esc(v.error?.message || 'Request failed')}</p><p>No verdict numbers are shown in this state. Nothing is mocked or invented.</p>`, 'red');
      }
      setBadge(`Qloo unavailable (${esc(v.error?.code || res.status)})`, 'red');
      return;
    }
    if (v.status === 'verdict') {
      renderVerdict(v);
      if (race && v.race) {
        $('raceBlock').innerHTML = `<p class="race-timer">Race timing — total ${v.race.totalMs}ms · Gut ${v.race.gutMs ?? '—'}ms · Web ${v.race.webMs ?? '—'}ms. Both arms ran live against the same question.</p>`;
      } else {
        $('raceBlock').innerHTML = '';
      }
    } else if (v.status === 'verdict_withheld') {
      hideVerdict();
      showStatus(`<p class="big">Verdict withheld: evidence incomplete</p><p>${esc(v.message)}</p><p>Missing legs: ${esc((v.missingLegs || []).join(', '))}</p><p>No numbers are shown in this state.</p>`, 'red');
    } else if (v.status === 'needs_input') {
      renderNeedsInput(v);
    } else if (v.status === 'price_unknown') {
      hideVerdict();
      showStatus(`<p class="big">Price unknown.</p><p>${esc(v.message)}</p><p>No break-even number is shown without a price.</p>`, 'amber');
    } else {
      hideVerdict();
      showStatus(`<p>Unexpected response status: ${esc(v.status)}</p>`, 'red');
    }
  } catch (e) {
    clearInterval(timer);
    setRunning(false);
    hideVerdict();
    showStatus(`<p>Request failed: ${esc(e.message)}</p><p>No verdict numbers are shown in this state.</p>`, 'red');
  }
}

$('offerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitVerdict(false);
});
$('raceBtn').addEventListener('click', () => submitVerdict(true));

// Image fallback: if an asset fails to load, show the styled brief panel instead.
document.querySelectorAll('img').forEach((img) => {
  img.addEventListener('error', () => {
    if (img.id === 'heroImg') {
      img.classList.add('img-missing');
      $('heroFallback').classList.add('show');
    } else {
      img.style.display = 'none';
    }
  });
});

loadHealth();
loadBench();
