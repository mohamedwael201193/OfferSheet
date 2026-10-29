// OfferSheet frontend — no framework, no build step, no keys, no Qloo calls.
// Every data call goes to the same-origin backend (/api/*). No external API
// call is ever made from this page except the theme's font stylesheet.
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : esc(n));
const money = (n) => (typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : esc(n));

// The last full verdict object, held in memory for replay comparison (G7).
// Replay compares IDs + order against this object — never counts alone.
let lastVerdict = null;

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
      // G23: MAX §2.5 sentence in a top banner, form disabled with a note.
      setBadge('Qloo not configured — verdicts unavailable (503)', 'red');
      $('configBanner').hidden = false;
      $('formDisabledNote').hidden = false;
      document.querySelectorAll('#offerForm input, #offerForm button').forEach((el) => { el.disabled = true; });
    } else {
      // "Configured" alone is amber, never green: green requires a live verdict.
      setBadge('Qloo configured — awaiting first live call', 'amber');
      $('configBanner').hidden = true;
      $('formDisabledNote').hidden = true;
      document.querySelectorAll('#offerForm input, #offerForm button').forEach((el) => { el.disabled = false; });
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
  $('raceToggleWrap').hidden = true;
  $('partialSection').hidden = true;
}
function setRunning(on) {
  document.querySelectorAll('#offerForm button').forEach((b) => { b.disabled = on; });
  const rt = $('raceToggleBtn');
  if (rt) rt.disabled = on;
}

function kvOrList(value, title) {
  if (value === null || value === undefined) return `<h3>${esc(title)}</h3><p class="empty">Unavailable this run. <span class="next-action">Next action:</span> run the verdict again.</p>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `<h3>${esc(title)}</h3><p class="empty">No data returned this run. <span class="next-action">Next action:</span> run the verdict again.</p>`;
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
  // Lane bar: a scaleX fill (CSS only) on arms with a pick; a muted, unfilled
  // track on arms with no provider — never a fabricated pick.
  if (!arm) return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-unavailable">Unavailable — no data this run.</p><div class="lane-bar lane-bar--empty" aria-hidden="true"></div></div>`;
  if (arm.status === 'ok') {
    return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-pick">${esc(arm.pick)}</p><div class="lane-bar" aria-hidden="true"></div></div>`;
  }
  return `<div class="lane"><div class="lane-head"><strong>${label}</strong></div><p class="lane-unavailable">Unavailable — ${esc(arm.reason || arm.status)}</p><div class="lane-bar lane-bar--empty" aria-hidden="true"></div></div>`;
}

function renderArms(v) {
  const a = v.arms || {};
  $('armsBlock').innerHTML = armLane('Gut (LLM alone)', a.gut) + armLane('Graph (Qloo-grounded)', a.graph) + armLane('Web (LLM + Wikidata facts)', a.web);
  if (v.missTrial) {
    const m = v.missTrial;
    $('missBlock').innerHTML = m.misses.length === 0
      ? '<p>Where the gut pick was wrong: none this run — all arms agreed with Graph.</p>'
      : `<p>Where the gut pick was wrong: ${m.misses.map((x) => `${esc(x.arm)} picked “${esc(x.pick)}” while Graph picked “${esc(x.graphPick)}”`).join('; ')}.</p>`;
  } else {
    $('missBlock').innerHTML = '<p>Where the gut pick was wrong: no trial this run (a comparison arm was unavailable — no trial is fabricated).</p>';
  }
  // G44: LLM arms absent → collapse the hollow race behind a clear note,
  // with a details toggle to expand it. The verdict above is unaffected.
  const llmAbsent = a.gut?.status !== 'ok' && a.web?.status !== 'ok';
  $('raceNote').hidden = !llmAbsent;
  $('raceBody').hidden = llmAbsent;
  const det = $('raceExpandDetails');
  det.open = false;
  det.ontoggle = () => { $('raceBody').hidden = !det.open; };
}

function renderReceipts(v) {
  const list = $('receiptList');
  list.innerHTML = '';
  const receipts = v.receipts || [];
  if (receipts.length === 0) {
    list.innerHTML = '<p class="empty">No receipts this run. <span class="next-action">Next action:</span> a verdict without receipts is withheld, not shown — see the status above.</p>';
    return;
  }
  receipts.forEach((r, idx) => {
    const div = document.createElement('div');
    div.className = 'receipt';
    const replayBtn = r.replay
      ? `<button class="btn btn-sm" data-replay='${esc(JSON.stringify(r.replay))}' data-receipt-idx="${idx}">Replay</button>`
      : '<em>No replay for this receipt</em>';
    div.innerHTML = `<div><div class="claim">${esc(r.claim)}</div><div class="meta">${esc(r.operation)} · requestId: ${esc(r.requestId ?? '—')} · results: ${esc(r.resultCount ?? '—')}</div></div>${replayBtn}`;
    list.appendChild(div);
  });
  list.querySelectorAll('[data-replay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const replay = JSON.parse(btn.getAttribute('data-replay'));
      const idx = Number(btn.getAttribute('data-receipt-idx'));
      // G7: the original leg's IDs come from the verdict object held in
      // memory — never from counts, and never invented when absent.
      const receipt = Array.isArray(lastVerdict?.receipts) ? lastVerdict.receipts[idx] : null;
      const originalIds = Array.isArray(receipt?.ids) ? receipt.ids
        : (Array.isArray(receipt?.entityIds) ? receipt.entityIds : null);
      const recordedCount = receipt?.resultCount ?? null;
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
        // Replay interface: ordered entity-ID list + resultCount only.
        const replayedIds = Array.isArray(out.ids) ? out.ids
          : (Array.isArray(out.entityIds) ? out.entityIds
          : (Array.isArray(out.result?.ids) ? out.result.ids
          : (Array.isArray(out.result?.entityIds) ? out.result.entityIds
          : (Array.isArray(out.envelope?.ids) ? out.envelope.ids : null))));
        const count = out.resultCount ?? out.result?.resultCount ?? out.envelope?.result_count ?? out.result_count ?? null;
        const countNote = ` (Replay result count: ${count ?? 'unavailable'}; receipt recorded: ${recordedCount ?? 'unavailable'}.)`;
        if (!originalIds) {
          // Honest, never a false match: without original IDs, counts prove nothing.
          $('replayOut').textContent = `Replayed live, but the original run did not hold an ID list for this leg — not comparable. Counts alone never prove a match.${countNote}`;
        } else if (!replayedIds) {
          $('replayOut').textContent = `Replayed live, but the replay did not return an ID list — not comparable. Counts alone never prove a match.${countNote}`;
        } else if (replayedIds.length === originalIds.length && replayedIds.every((id, i) => String(id) === String(originalIds[i]))) {
          $('replayOut').textContent = `Replay match: live re-run returned the same IDs in the same order (${replayedIds.length} results).`;
        } else if (replayedIds.length === originalIds.length) {
          $('replayOut').textContent = `Replay mismatch: count matches but order/IDs differ — live data changed between runs. The receipt is the record of the original run.${countNote}`;
        } else {
          $('replayOut').textContent = `Replay mismatch: live re-run returned ${replayedIds.length} results, but the receipt recorded ${originalIds.length}. Live data changed between runs — the receipt is the record of the original run.`;
        }
      } catch (e) {
        $('replayOut').textContent = `Replay failed: ${e.message}`;
      }
    });
  });
}

// G20: every leg name the UI can show, in plain words (technical name kept
// secondary in the row, never as the only label).
const PLAIN_LEGS = {
  findTags: 'finding tags for the artist and city',
  describe: 'describing the headliner',
  recommend: 'an opener shortlist',
  rank: 'an opener shortlist, ranked for this city audience',
  wherePopular: 'where this artist is popular',
  where_popular: 'where this artist is popular',
  demographics: 'who this audience is',
  compare: 'how the fan bases overlap',
  entityTags: 'shared tags',
  entity_tags: 'shared tags',
  trends: 'whether the artist is rising or falling',
  restSearch: 'searching for the artist',
  restInsights: 'audience insights',
  ticketmaster: 'Ticketmaster venue and event history',
  osm: 'city confirmation',
  wikidata: 'public facts cross-check',
  'resolve (find_tags/describe)': 'finding the artist',
  'rank-or-recommend': 'an opener shortlist',
  'compare-or-entity_tags': 'how the fan bases overlap, or shared tags',
};
function plainLegName(name) {
  if (PLAIN_LEGS[name]) return PLAIN_LEGS[name];
  // Fallback humanization for any unlisted key: split camelCase/underscores.
  return String(name).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function legRowHtml(key, l) {
  const plain = plainLegName(key);
  const secondary = plain === key ? '' : ` <span class="label">(${esc(key)})</span>`;
  return `<div><dt>${esc(plain)}${secondary}</dt><dd>${esc(l.status)}${l.reason ? ` — ${esc(l.reason)}` : ''}${l.note ? ` — ${esc(l.note)}` : ''}</dd></div>`;
}

// Shared leg rows for the verdict card and the partial-evidence section.
// F3: a Ticketmaster error renders the MAX §2.6 sentence VERBATIM.
function plainLegRows(legs, tm, osm, wd) {
  const rows = Object.entries(legs || {}).map(([k, l]) => legRowHtml(k, l)).join('');
  const tmRow = tm
    ? (tm.status === 'error'
      ? '<div><dt>Ticketmaster venue and event history</dt><dd>Ticketmaster unavailable — capacity and event history not loaded</dd></div>'
      : `<div><dt>Ticketmaster venue and event history</dt><dd>${esc(tm.status)}${tm.venueName ? ` — ${esc(tm.venueName)}` : ''}${tm.grounding ? ` — ${esc(tm.grounding)}` : ''}${tm.note ? ` — ${esc(tm.note)}` : ''}${tm.reason ? ` — ${esc(tm.reason)}` : ''}</dd></div>`)
    : '';
  // G14: OSM/Wikidata scope is rendered with every leg row — display-only /
  // Web-arm-only, never a claim either one changes a verdict number.
  const osmRow = osm ? `<div><dt>city confirmation</dt><dd>${esc(osm.status)}${osm.displayName ? ` — ${esc(osm.displayName)}` : ''}${osm.note ? ` — ${esc(osm.note)}` : ''}${osm.reason ? ` — ${esc(osm.reason)}` : ''} — ${esc(osm.scope || 'display-only — shown for confirmation, never fed into Qloo filters')}</dd></div>` : '';
  const wdRow = wd ? `<div><dt>public facts cross-check</dt><dd>${esc(wd.status)}${wd.note ? ` — ${esc(wd.note)}` : ''}${wd.reason ? ` — ${esc(wd.reason)}` : ''} — ${esc(wd.scope || 'input to the Web arm only, never a direct verdict input')}</dd></div>` : '';
  return rows + tmRow + osmRow + wdRow;
}

function renderLegs(v) {
  $('legsBlock').innerHTML = `<dl class="kv">${plainLegRows(v.legs, v.ticketmaster, v.osm, v.wikidata)}</dl>`;
}

function renderPartial(v) {
  // G43: partial Qloo evidence only — the verdict number never renders here.
  const p = v.partial || ((v.audience || v.openers || v.legs) ? { audience: v.audience, openers: v.openers, legs: v.legs } : null);
  if (!p || (!p.audience && !p.openers && !p.legs)) return false;
  $('partialAudienceNote').textContent = p.audience?.note || '';
  $('partialAudience').innerHTML = (p.audience?.areas || []).map((a) => `<li>${esc(a.name || a.id || '')}</li>`).join('') || '<li>No areas returned this run.</li>';
  const ranked = p.openers?.ranked?.length > 0 ? p.openers.ranked : (p.openers?.candidates || []);
  $('partialOpeners').innerHTML = ranked.map((o) => `<li>${esc(o.name || o.id || '')}</li>`).join('') || '<li>No openers returned this run.</li>';
  $('partialLegs').innerHTML = `<dl class="kv">${plainLegRows(p.legs, v.ticketmaster, v.osm, v.wikidata)}</dl>`;
  $('partialSection').hidden = false;
  return true;
}

function firstName(item) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'string') return item;
  if (typeof item === 'object') return item.name || item.tag || item.id || null;
  return null;
}
function firstSummary(item) {
  // One honest line from an unknown-shaped evidence item: named fields joined,
  // never invented. Returns null when nothing readable is present.
  if (item === null || item === undefined) return null;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item === 'object') {
    const parts = Object.entries(item)
      .filter(([, val]) => val !== null && val !== undefined && typeof val !== 'object')
      .slice(0, 3)
      .map(([k, val]) => `${k}: ${val}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}
function trendArrow(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const nums = points.map((p) => {
    if (typeof p === 'number') return p;
    if (p && typeof p === 'object') {
      for (const k of ['value', 'affinity', 'score', 'popularity', 'count']) {
        if (typeof p[k] === 'number') return p[k];
      }
    }
    return null;
  }).filter((n) => n !== null);
  if (nums.length < 2) return null;
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (last > first) return 'rising ▲';
  if (last < first) return 'falling ▼';
  return 'flat ▬';
}

function renderProofSummary(v) {
  const band = Array.isArray(v.demographics) ? firstSummary(v.demographics[0]) : firstSummary(v.demographics);
  const trend = trendArrow(v.trends) || (typeof v.trends === 'string' ? v.trends : null);
  const tag = Array.isArray(v.sharedTags) ? firstName(v.sharedTags[0]) : firstName(v.sharedTags);
  const overlap = Array.isArray(v.overlap) ? firstSummary(v.overlap[0]) : firstSummary(v.overlap);
  const line = (label, value) => `<li><strong>${label}:</strong> ${value ? esc(value) : 'not returned this run'}</li>`;
  $('proofSummary').innerHTML =
    line('Top audience band', band)
    + line('Trend', trend)
    + line('Top shared tag', tag)
    + line('Overlap', overlap);
}

function renderVerdict(v, race) {
  hideStatus();
  lastVerdict = v;
  const be = v.breakEven;
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const cannot = known && be.tickets > cap.value;

  $('verdict').hidden = false;
  // G21: the race section shows only when the secondary toggle ran a race.
  $('raceSection').hidden = !race;
  $('receiptSection').hidden = false;
  $('formulaSection').hidden = false;
  $('raceToggleWrap').hidden = false;

  $('verdictSubject').textContent = `${v.artist} in ${v.city} · guarantee ${money(v.guarantee)}`;
  $('beTickets').textContent = fmt(be.tickets);
  $('beVerdict').textContent = be.verdict || (be.note === 'no guarantee' ? 'No guarantee to cover — 0 tickets.' : '');
  renderProofSummary(v);
  $('cannotBox').hidden = !cannot;
  $('bePrice').textContent = `${money(be.price.value)} (${be.price.source})`;
  // G12: a blank variable cost renders as "before variable costs" — never
  // as if costs were zero. An explicit 0 renders as cost 0 (see worked
  // example below, which keys off be.variableCost.provided).
  $('beNet').textContent = (be.variableCost && be.variableCost.provided === false)
    ? `${money(be.net)} (before variable costs)`
    : money(be.net);

  if (known) {
    $('capacityBadge').className = 'capacity-badge';
    $('capacityBadge').textContent = cap.source;
    $('unknownBox').hidden = true;
    $('beCapacity').textContent = `${fmt(cap.value)} (${cap.source})`;
    $('selloutBox').hidden = false;
    $('selloutPct').textContent = `${((be.tickets / cap.value) * 100).toFixed(1)}%`;
  } else {
    // G24: the pipeline's per-cause capacity message, VERBATIM when supplied.
    // The fallback asserts no Ticketmaster fact that never happened.
    $('capacityBadge').className = 'capacity-badge unknown';
    $('capacityBadge').textContent = 'capacity unknown';
    $('unknownText').textContent = (typeof cap.message === 'string' && cap.message)
      ? cap.message
      : 'Venue capacity unknown — break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.';
    $('unknownBox').hidden = false;
    $('beCapacity').textContent = 'Unknown';
    $('selloutBox').hidden = true;
    $('selloutPct').textContent = '';
  }

  // G12: worked example shows the cost actually entered. Blank cost shows
  // no "− 0" at all — the formula divides by the price alone and says
  // plainly the result is before variable costs. Explicit 0 shows "− 0".
  const vc = be.variableCost;
  if (vc && typeof vc.provided === 'boolean') {
    $('workedExample').textContent = vc.provided
      ? `ceil(${fmt(v.guarantee)} ÷ (${fmt(be.price.value)} − ${fmt(vc.value)})) = ${fmt(be.tickets)} tickets`
      : `ceil(${fmt(v.guarantee)} ÷ ${fmt(be.price.value)}) = ${fmt(be.tickets)} tickets — before variable costs: no variable cost was entered, so this net is before variable costs, not net of zero costs`;
  } else {
    const variableCost = be.price.value - be.net;
    $('workedExample').textContent = `ceil(${fmt(v.guarantee)} ÷ (${fmt(be.price.value)} − ${fmt(variableCost)})) = ${fmt(be.tickets)} tickets`;
  }

  $('audienceNote').textContent = v.audience.note;
  $('audienceAreas').innerHTML = (v.audience.areas || []).map((a) => `<li>${esc(a.name || a.id || '')}</li>`).join('') || '<li>No areas returned this run. <span class="next-action">Next action:</span> run the verdict again.</li>';
  const ranked = v.openers.ranked.length > 0 ? v.openers.ranked : v.openers.candidates;
  $('openerList').innerHTML = ranked.map((o) => `<li>${esc(o.name || o.id || '')}</li>`).join('') || '<li>No openers returned this run. <span class="next-action">Next action:</span> run the verdict again.</li>';
  $('topPick').textContent = v.openers.topPick ? `Graph pick: ${v.openers.topPick}` : '';
  $('demoBlock').innerHTML = kvOrList(v.demographics, 'Who this audience is');
  $('trendBlock').innerHTML = kvOrList(v.trends, 'Whether the artist is rising');
  $('tagsBlock').innerHTML = kvOrList(v.sharedTags, 'Shared tags');
  $('overlapBlock').innerHTML = kvOrList(v.overlap, 'How the fan bases overlap');
  renderArms(v);
  renderReceipts(v);
  renderLegs(v);
  setBadge('Qloo live — verdict computed from live calls', 'green');
}

function renderNeedsInput(v) {
  hideVerdict();
  // Badge rule: green ONLY while a live verdict stands. A needs_input run
  // shows no verdict, so a stale green from an earlier run must not survive.
  setBadge('Qloo configured — awaiting your pick', 'amber');
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
  const vcInput = $('variableCost').value;
  if (vcInput !== '') body.variableCost = Number(vcInput);
  const venueInput = $('venue').value.trim();
  if (venueInput !== '') body.venue = venueInput;
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
        $('configBanner').hidden = false;
        $('formDisabledNote').hidden = false;
        document.querySelectorAll('#offerForm input, #offerForm button').forEach((el) => { el.disabled = true; });
      } else {
        showStatus(`<p class="big">${esc(v.error?.code || res.status)}</p><p>${esc(v.error?.message || 'Request failed')}</p><p>No verdict numbers are shown in this state. Nothing is mocked or invented.</p>`, 'red');
      }
      setBadge(`Qloo unavailable (${esc(v.error?.code || res.status)})`, 'red');
      return;
    }
    if (v.status === 'verdict') {
      renderVerdict(v, race);
      if (race && v.race) {
        $('raceBlock').innerHTML = `<p class="race-timer">Race timing — total ${v.race.totalMs}ms · Gut ${v.race.gutMs ?? '—'}ms · Web ${v.race.webMs ?? '—'}ms. Both arms ran live against the same question.</p>`;
      } else {
        $('raceBlock').innerHTML = '';
      }
    } else if (v.status === 'verdict_withheld') {
      hideVerdict();
      const plainMissing = (v.missingLegs || []).map((m) => plainLegName(m));
      showStatus(`<p class="big">Verdict withheld: evidence incomplete</p><p>${esc(v.message)}</p><p>Missing: ${esc(plainMissing.join(', '))}</p><p>No numbers are shown in this state.</p><button class="btn" type="button" id="tryAgainBtn">Try again</button>`, 'red');
      setBadge('Qloo evidence incomplete — verdict withheld', 'red');
      $('tryAgainBtn').addEventListener('click', () => submitVerdict(false));
    } else if (v.status === 'needs_input') {
      renderNeedsInput(v);
    } else if (v.status === 'price_unknown') {
      hideVerdict();
      showStatus(`<p class="big">Price unknown.</p><p>${esc(v.message)}</p><p>No break-even number is shown without a price.</p><button class="btn" type="button" id="priceFocusBtn">Enter a ticket price</button>`, 'amber');
      setBadge('Qloo configured — price needed for a verdict', 'amber');
      $('priceFocusBtn').addEventListener('click', () => {
        const f = $('ticketPrice');
        f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        f.focus();
      });
      // G43: partial Qloo evidence below the status, never a verdict number.
      renderPartial(v);
    } else {
      hideVerdict();
      showStatus(`<p>Unexpected response status: ${esc(v.status)}</p>`, 'red');
      setBadge('Unexpected response — no verdict', 'red');
    }
  } catch (e) {
    clearInterval(timer);
    setRunning(false);
    hideVerdict();
    showStatus(`<p>Request failed: ${esc(e.message)}</p><p>No verdict numbers are shown in this state.</p>`, 'red');
    setBadge('Request failed — no verdict', 'red');
  }
}

$('offerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitVerdict(false);
});
$('raceToggleBtn').addEventListener('click', () => submitVerdict(true));

// Image fallback: the hero shows the styled brief panel; icons keep a styled
// placeholder box (G48) instead of display:none layout shift.
document.querySelectorAll('img').forEach((img) => {
  img.addEventListener('error', () => {
    if (img.id === 'heroImg') {
      img.classList.add('img-missing');
      $('heroFallback').classList.add('show');
    } else if (img.dataset.fallback) {
      // Large proof figures show their brief panel, never a 56px placeholder.
      img.classList.add('img-missing');
      const fb = document.getElementById(img.dataset.fallback);
      if (fb) fb.classList.add('show');
    } else {
      const ph = document.createElement('div');
      ph.className = 'icon-placeholder';
      ph.setAttribute('aria-hidden', 'true');
      img.replaceWith(ph);
    }
  });
});

// Scroll-reveal fallback: ONLY when CSS view-timeline is unsupported.
// Content stays visible if this never runs: the hiding class is added by
// this block alone, and reduced-motion CSS forces everything visible.
if (typeof CSS !== 'undefined' && !CSS.supports('animation-timeline', 'view()') && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('io-arm');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

loadHealth();
loadBench();
