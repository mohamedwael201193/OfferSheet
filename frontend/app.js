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
    // SHIP items 3 + 13: recorded-trial cards + Gut-vs-Graph tally, from
    // the same bench data. Recorded, not live; prefill only, never auto-run.
    renderTrialCards(runs);
    renderTrialTally(runs);
  } catch {
    $('benchBlock').innerHTML = '<p class="empty">Benchmark ledger unavailable. <span class="next-action">Next action:</span> check that the backend is running, then reload.</p>';
    renderTrialCards([]);
    const tt = $('tallyTable'); if (tt) tt.innerHTML = '<p class="empty">Recorded tally unavailable — backend unreachable.</p>';
    const tl = $('tallyLine'); if (tl) tl.textContent = '';
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
  $('raceToggleWrap').hidden = true;
  $('partialSection').hidden = true;
  const sheet = $('verdictSheet');
  if (sheet) sheet.hidden = true;
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
    div.id = `receipt-${idx}`;
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
  // SHIP item 8: ok/partial state badge on every leg row. A leg counts
  // ONLY at ok; anything else is partial, never a pass.
  const state = l.status === 'ok' ? '<span class="leg-state leg-state--ok">ok</span>' : '<span class="leg-state leg-state--partial">partial</span>';
  return `<div><dt>${esc(plain)}${secondary}</dt><dd>${state} ${esc(l.status)}${l.reason ? ` — ${esc(l.reason)}` : ''}${l.note ? ` — ${esc(l.note)}` : ''}</dd></div>`;
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

// Motion hook (v2): the verdict number counts up to its REAL value
// (NumberTicker pattern, vanilla rAF + easeOutQuart). The final value is
// identical to the direct assignment it replaces; reduced motion (or a
// non-numeric value) sets it instantly. Never a fabricated figure.
let ticketsRaf = null;
function animateTickets(value) {
  const el = $('beTickets');
  if (typeof value !== 'number' || !isFinite(value)) { el.textContent = fmt(value); return; }
  if (ticketsRaf) cancelAnimationFrame(ticketsRaf);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmt(value);
    return;
  }
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = fmt(Math.round(value * eased));
    if (t < 1) ticketsRaf = requestAnimationFrame(step);
    else { el.textContent = fmt(value); ticketsRaf = null; }
  };
  ticketsRaf = requestAnimationFrame(step);
}

// ---- SHIP round (30-agent sweep adoptions, 29 Oct 2026) ----
// Display-only helpers: they read the verdict/bench objects the backend
// already returned. Nothing here changes the break-even numerator, the
// receipt pipeline, or the 503 fail-closed gate, and nothing here makes a
// new live Qloo call. Every displayed figure comes from already-computed,
// already-receipted data or the recorded trials.

// Item 1: find the receipt index for a set of operations (MCP tool names
// or rest:<path>). Receipts exist only for legs that returned ok, so a
// missing receipt means "not provable from this run" — the chip is omitted.
function findReceiptIndex(receipts, operations) {
  if (!Array.isArray(receipts)) return -1;
  return receipts.findIndex((r) => r && operations.includes(r.operation));
}

// Item 1: scroll to an existing receipt and flash it. The drawer stays the
// audit layer; chips are shortcuts, not new proof.
function scrollToReceipt(idx) {
  const section = $('receiptSection');
  const el = document.getElementById(`receipt-${idx}`);
  if (section) section.hidden = false;
  if (el && el.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('receipt--flash');
    setTimeout(() => el.classList.remove('receipt--flash'), 2500);
  }
}

// Item 1: citation chips ON the verdict. Each chip names the Qloo signal,
// the tool, and the requestId, and clicks to the existing re-runnable
// receipt. A chip renders ONLY when its mapping is proven from this run's
// receipts; otherwise it is omitted (never guessed).
//   PROVEN: Graph pick (qloo_rank or qloo_recommend receipt); each miss
//     (same Graph receipt — the miss is the LLM pick contradicted by it).
//   OMITTED BY DESIGN: the arithmetic line. Its inputs are the guarantee
//     (user input) and the price (user-supplied, or Ticketmaster history —
//     Ticketmaster has no receipt object), so no receipt can back it. The
//     worked example shows those inputs labelled by source instead.
function renderCiteChips(v) {
  const box = $('citeChips');
  if (!box) return;
  const receipts = v.receipts || [];
  const graphIdx = findReceiptIndex(receipts, ['qloo_rank', 'qloo_recommend']);
  const chips = [];
  if (v.openers?.topPick && graphIdx >= 0) {
    const r = receipts[graphIdx];
    chips.push({ label: `Graph pick ${esc(v.openers.topPick)} — ${esc(r.operation)} · requestId ${esc(r.requestId ?? '—')}`, idx: graphIdx });
  }
  for (const m of v.missTrial?.misses || []) {
    if (graphIdx >= 0) {
      chips.push({ label: `Miss: ${esc(m.arm)} picked ${esc(m.pick)}; Qloo picked ${esc(m.graphPick)} — ${esc(receipts[graphIdx].operation)}`, idx: graphIdx });
    }
  }
  if (chips.length === 0) {
    box.innerHTML = '<p class="label">No Qloo-backed citation chip this run — the receipts below still carry every claim.</p>';
    return;
  }
  box.innerHTML = chips.map((c, i) => `<button type="button" class="cite-chip" data-receipt-idx="${c.idx}" data-chip="${i}">${c.label}</button>`).join('');
  box.querySelectorAll('[data-receipt-idx]').forEach((b) => {
    b.addEventListener('click', () => scrollToReceipt(Number(b.getAttribute('data-receipt-idx'))));
  });
}

// Item 4: deterministic evidence-strength label. Code-set, never LLM.
//   HIGH: all 7 core MCP legs ok AND no leg in error.
//   MEDIUM: core evidence present (a headliner resolution + an opener
//     source) but some leg empty/error/skipped.
//   LOW: thin core — no ranked shortlist AND (no audience areas OR no
//     shared tags), i.e. the verdict rests on partial evidence.
// Tie disclosure: Qloo rank returns names only, no scores, so a near-tie
// cannot be detected from this verdict — stated, never scored.
// Unranked disclosure: ranked empty + candidates present means the top
// pick is the first candidate returned, not a ranked winner.
const CONFIDENCE_CORE = ['findTags', 'describe', 'recommend', 'rank', 'wherePopular', 'demographics', 'entityTags'];
function computeConfidence(v) {
  const legs = v.legs || {};
  const st = (k) => legs[k]?.status;
  const ranked = Array.isArray(v.openers?.ranked) ? v.openers.ranked : [];
  const candidates = Array.isArray(v.openers?.candidates) ? v.openers.candidates : [];
  const areas = Array.isArray(v.audience?.areas) ? v.audience.areas : [];
  const tags = v.sharedTags;
  const tagsEmpty = tags === null || tags === undefined || (Array.isArray(tags) && tags.length === 0);
  const anyError = Object.values(legs).some((l) => l && l.status === 'error');
  const coreOk = CONFIDENCE_CORE.every((k) => st(k) === 'ok');
  const nonOk = Object.entries(legs).filter(([, l]) => l && l.status !== 'ok')
    .map(([k, l]) => `${PLAIN_LEGS[k] || k} (${l.status}${l.reason ? ` — ${l.reason}` : ''})`);
  let level;
  if (ranked.length === 0 && (areas.length === 0 || tagsEmpty)) level = 'LOW';
  else if (coreOk && !anyError) level = 'HIGH';
  else level = 'MEDIUM';
  const reasons = [];
  if (coreOk && !anyError) reasons.push('All 7 core Qloo legs ok; no leg in error.');
  else reasons.push(`Core legs: ${CONFIDENCE_CORE.filter((k) => st(k) === 'ok').length}/7 ok.`);
  if (nonOk.length) reasons.push(`Legs without usable data: ${nonOk.join('; ')}.`);
  if (ranked.length === 0 && candidates.length > 0) reasons.push('Unranked shortlist: the Graph pick is the first candidate returned, not a ranked winner.');
  else reasons.push('Tie check: Qloo rank returns names only, no scores — a near-tie cannot be ruled out from this verdict.');
  return { level, reasons };
}

function renderConfidence(v) {
  const box = $('confidenceBox');
  if (!box) return;
  const c = computeConfidence(v);
  box.innerHTML = `<p><strong>${c.level}</strong> · evidence strength, not probability</p><ul>${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
}

// Item 8: leg summary + rejected-evidence counts next to the verdict.
// Labels derive from existing leg status only; a leg counts ONLY at ok.
function renderLegSummary(v) {
  const box = $('legSummary');
  if (!box) return;
  const legs = v.legs || {};
  const bad = Object.entries(legs).filter(([, l]) => l && l.status !== 'ok');
  const ranked = Array.isArray(v.openers?.ranked) ? v.openers.ranked : [];
  const candidates = Array.isArray(v.openers?.candidates) ? v.openers.candidates : [];
  const unranked = Math.max(0, candidates.length - ranked.length);
  const parts = [];
  if (bad.length === 0) parts.push('All legs ok.');
  else parts.push(`${bad.length} leg${bad.length === 1 ? '' : 's'} dropped: ${bad.map(([k, l]) => `${PLAIN_LEGS[k] || k} (${l.status}${l.reason ? ` — ${l.reason}` : ''})`).join('; ')}.`);
  if (unranked > 0) parts.push(`${unranked} opener candidate${unranked === 1 ? '' : 's'} shown unranked (no ranked winner this run).`);
  box.textContent = parts.join(' ');
}

// Item 9: thin-data badge. Shown when the verdict rests on thin core
// evidence (no ranked shortlist, no audience areas, or no demographics
// bands) — a badge, not a refusal: the verdict still stands on what
// cleared the evidence checks.
function renderThinBadge(v) {
  const badge = $('thinBadge');
  if (!badge) return;
  const ranked = Array.isArray(v.openers?.ranked) ? v.openers.ranked : [];
  const areas = Array.isArray(v.audience?.areas) ? v.audience.areas : [];
  const bands = v.demographics;
  const bandsEmpty = bands === null || bands === undefined || (Array.isArray(bands) && bands.length === 0);
  if (ranked.length === 0 || areas.length === 0 || bandsEmpty) {
    badge.hidden = false;
    badge.textContent = 'Thin data — some Qloo legs returned empty; this verdict uses only what cleared the evidence checks.';
  } else {
    badge.hidden = true;
    badge.textContent = '';
  }
}

// Item 10: "Before you sign" checklist above the number. Reflects actual
// input states only — never adds claimed facts.
function buildSignChecklist(v) {
  const be = v.breakEven || {};
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const tm = v.ticketmaster || {};
  const rows = [];
  rows.push(['Opener', v.openers?.topPick ? `${v.openers.topPick} (Graph pick)` : 'Not picked this run']);
  rows.push(['Venue', tm.venueName || 'Not resolved this run']);
  rows.push(['Ticket price', `${money(be.price?.value ?? 0)} (${be.price?.source ?? 'unknown source'})`]);
  rows.push(['Capacity', known ? `${fmt(cap.value)} (${cap.source})` : 'Unknown — no sellout percentage shown']);
  rows.push(['Variable cost', be.variableCost?.provided ? money(be.variableCost.value) : 'Not entered — net is before variable costs']);
  const unknowns = [];
  if (!known) unknowns.push('capacity');
  if (!be.variableCost?.provided) unknowns.push('variable cost');
  if (!tm.venueName) unknowns.push('venue');
  if (!v.openers?.topPick) unknowns.push('opener pick');
  return { rows, unknowns };
}

function renderSignChecklist(v) {
  const box = $('signChecklist');
  if (!box) return;
  const { rows, unknowns } = buildSignChecklist(v);
  box.innerHTML = `<p class="label">Before you sign — check each line against the offer:</p><ul>${rows.map(([k, val]) => `<li><strong>${esc(k)}:</strong> ${esc(val)}</li>`).join('')}</ul>${unknowns.length ? `<p class="label">Unknowns: ${esc(unknowns.join(', '))}.</p>` : ''}`;
}

// Items 7 + 11: one-page verdict sheet + copy-ready promoter brief,
// generated from the SAME verdict object — never a diverging copy.
// Item 11's struck-through refused candidates live on the sheet: the
// refusing rule is the miss ledger (the LLM pick contradicted by the
// Qloo Graph pick).
function sheetBriefText(v) {
  const be = v.breakEven || {};
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const lines = [];
  lines.push(`OfferSheet verdict — ${v.artist || 'artist'} in ${v.city || 'city'}`);
  lines.push(`Guarantee ${money(v.guarantee ?? 0)} · ticket price ${money(be.price?.value ?? 0)} (${be.price?.source ?? 'unknown source'}) · net per ticket ${money(be.net ?? 0)}${be.variableCost?.provided === false ? ' (before variable costs)' : ''}`);
  lines.push(`Break-even: ${fmt(be.tickets ?? 0)} tickets${known ? ` (${((be.tickets / cap.value) * 100).toFixed(1)}% of room capacity ${fmt(cap.value)}, ${cap.source})` : ' (capacity unknown — no sellout percentage)'}`);
  if (v.openers?.topPick) lines.push(`Graph pick: ${v.openers.topPick}`);
  for (const m of v.missTrial?.misses || []) lines.push(`Miss: ${m.arm} picked ${m.pick}; Qloo picked ${m.graphPick}.`);
  const unknowns = buildSignChecklist(v).unknowns;
  if (unknowns.length) lines.push(`Unknowns: ${unknowns.join(', ')}.`);
  lines.push('Aggregate taste signals only — not a sellout prediction, not a signing recommendation. The promoter decides.');
  return lines.join('\n');
}

function renderVerdictSheet(v) {
  const sheet = $('verdictSheet');
  const body = $('sheetBody');
  if (!sheet || !body) return;
  const be = v.breakEven || {};
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const receiptsHtml = (v.receipts || []).map((r) => `<li>${esc(r.claim || r.operation)} — ${esc(r.operation)} · requestId ${esc(r.requestId ?? '—')} · ${esc(String(r.resultCount ?? '—'))} results</li>`).join('');
  const unknowns = buildSignChecklist(v).unknowns;
  body.innerHTML = [
    `<h3>${esc(v.artist || '')} in ${esc(v.city || '')}</h3>`,
    `<p><strong>${fmt(be.tickets ?? 0)} tickets to break even</strong>${known ? ` — ${((be.tickets / cap.value) * 100).toFixed(1)}% of room capacity ${fmt(cap.value)} (${esc(cap.source)})` : ' — capacity unknown, no sellout percentage'}</p>`,
    `<p>Guarantee ${money(v.guarantee ?? 0)} · ticket price ${money(be.price?.value ?? 0)} (${esc(be.price?.source ?? 'unknown source')}) · net per ticket ${money(be.net ?? 0)}${be.variableCost?.provided === false ? ' (before variable costs)' : ''}</p>`,
    v.openers?.topPick ? `<p>Graph pick: ${esc(v.openers.topPick)}</p>` : '',
    (v.missTrial?.misses || []).length ? `<p>Miss ledger: ${(v.missTrial.misses || []).map((m) => `${esc(m.arm)} picked ${esc(m.pick)}; Qloo picked ${esc(m.graphPick)}`).join(' ')}</p>` : '',
    unknowns.length ? `<p>Unknowns: ${esc(unknowns.join(', '))}.</p>` : '',
    receiptsHtml ? `<p>Key receipts:</p><ul>${receiptsHtml}</ul>` : '',
    `<p class="label">Aggregate taste signals only — not a sellout prediction, not a signing recommendation. The promoter decides.</p>`,
  ].filter(Boolean).join('');
  const refused = $('refusedBlock');
  if (refused) {
    const misses = v.missTrial?.misses || [];
    refused.innerHTML = misses.length
      ? `<h3>Refused picks</h3><ul>${misses.map((m) => `<li><s>${esc(m.pick)}</s> — refused: ${esc(m.arm)} pick contradicted by the Qloo Graph pick ${esc(m.graphPick)}.</li>`).join('')}</ul>`
      : '<p class="label">No refused picks this run.</p>';
  }
  const printBtn = $('printSheetBtn');
  if (printBtn) printBtn.onclick = () => window.print();
  const copyBtn = $('copyBriefBtn');
  const note = $('copyNote');
  if (copyBtn) copyBtn.onclick = async () => {
    const text = sheetBriefText(v);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); if (note) note.textContent = 'Promoter brief copied.'; }
      else throw new Error('clipboard unavailable');
    } catch {
      if (note) note.textContent = 'Copy failed — select the sheet text manually.';
    }
  };
  sheet.hidden = false;
}

// Items 3 + 13: prefill the existing form from a recorded trial. Display
// only — the verdict still requires pressing "Run the verdict".
function prefillForm(input) {
  const set = (id, value) => { const el = $(id); if (el) el.value = value ?? ''; };
  set('artist', input.artist);
  set('city', input.city);
  set('guarantee', input.guarantee);
  set('ticketPrice', input.ticketPrice);
  set('venue', '');
  set('variableCost', '');
  set('capacity', '');
  set('entityHint', '');
  const form = $('offerForm');
  if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Item 13: "four cards" — the recorded trials as tappable cards plus one
// blank "your artist" card. Tap prefills; nothing auto-runs.
function renderTrialCards(runs) {
  const row = $('trialCardsRow');
  if (!row) return;
  const cards = (runs || []).map((run) => {
    const input = run.input || {};
    const date = (run.recordedAt || '').slice(0, 10);
    return `<button type="button" class="trial-card" data-prefill='${esc(JSON.stringify(input))}'>
      <strong>${esc(input.artist || '')}</strong>
      <span>${esc(input.city || '')} · guarantee ${money(input.guarantee ?? 0)} · price ${money(input.ticketPrice ?? 0)}</span>
      <span class="trial-card-be">${fmt(run.breakEvenTickets ?? 0)} tickets — recorded ${esc(date)}, not live</span>
    </button>`;
  }).join('');
  const your = `<button type="button" class="trial-card trial-card--blank" data-your-artist="1">
    <strong>Your artist</strong><span>Start blank — fill in your own offer.</span>
  </button>`;
  row.innerHTML = cards + your;
  row.querySelectorAll('[data-prefill]').forEach((b) => {
    b.addEventListener('click', () => { try { prefillForm(JSON.parse(b.getAttribute('data-prefill'))); } catch {} });
  });
  const blank = row.querySelector('[data-your-artist]');
  if (blank) blank.addEventListener('click', () => {
    prefillForm({ artist: '', city: '', guarantee: '', ticketPrice: '' });
    const artist = $('artist'); if (artist && artist.focus) artist.focus();
  });
}

// Item 3: a run's pick for one LLM arm. Bench runs record misses only;
// an arm with no miss entry matched the Graph pick that run.
function pickFor(run, arm) {
  const miss = (run.misses || []).find((m) => m.arm === arm);
  return miss ? miss.pick : (run.graphPick || '');
}

function trialMissed(run, arm) {
  return (run.misses || []).some((m) => m.arm === arm);
}

function computeTrialTally(runs) {
  const n = runs.length;
  const gutSame = runs.filter((r) => !trialMissed(r, 'gut')).length;
  const webSame = runs.filter((r) => !trialMissed(r, 'web')).length;
  const changed = runs.filter((r) => trialMissed(r, 'gut') || trialMissed(r, 'web')).length;
  return { n, gutSame, webSame, changed };
}

function shortPick(text, limit) {
  const t = String(text || '');
  if (t.length <= limit) return { short: t, full: null };
  return { short: t.slice(0, limit) + '…', full: t };
}

// Item 3: Gut-vs-Graph side-by-side table + running tally across the
// recorded trials. The tally must match bench/results.json exactly.
function renderTrialTally(runs) {
  const table = $('tallyTable');
  const line = $('tallyLine');
  if (!table || !line) return;
  const t = computeTrialTally(runs);
  const cell = (c) => c.full ? `${esc(c.short)}<details><summary>Full pick</summary>${esc(c.full)}</details>` : esc(c.short);
  const rows = (runs || []).map((run) => {
    const input = run.input || {};
    const gutPick = pickFor(run, 'gut');
    const webPick = pickFor(run, 'web');
    const gutMiss = trialMissed(run, 'gut');
    const webMiss = trialMissed(run, 'web');
    const missNames = [];
    if (gutMiss) missNames.push(`Gut missed: ${gutPick}`);
    if (webMiss) missNames.push(`Web missed: ${webPick}`);
    return `<tr>
      <td>${esc(input.artist || '')} · ${esc(input.city || '')}<br><span class="label">${money(input.guarantee ?? 0)} / ${money(input.ticketPrice ?? 0)} → ${fmt(run.breakEvenTickets ?? 0)} tickets</span></td>
      <td>${cell(shortPick(gutPick, 120))}</td>
      <td>${esc(run.graphPick || '')}</td>
      <td>${gutMiss ? 'different' : 'same'}</td>
      <td>${cell(shortPick(webPick, 120))}</td>
      <td>${webMiss ? 'different' : 'same'}</td>
      <td>${missNames.length ? esc(missNames.join('; ')) : 'No miss — both arms matched Graph.'}</td>
      <td><button type="button" class="btn" data-rerun='${esc(JSON.stringify(input))}'>Use these inputs</button></td>
    </tr>`;
  }).join('');
  table.innerHTML = `<div class="table-wrap"><table class="depth-table"><thead><tr><th>Trial</th><th>Gut pick</th><th>Qloo pick</th><th>Gut same?</th><th>Web pick</th><th>Web same?</th><th>Named miss</th><th>Re-run</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  table.querySelectorAll('[data-rerun]').forEach((b) => {
    b.addEventListener('click', () => { try { prefillForm(JSON.parse(b.getAttribute('data-rerun'))); } catch {} });
  });
  line.textContent = `Qloo changed the pick in ${t.changed}/${t.n} trials (Gut agreed ${t.gutSame}/${t.n}; Web agreed ${t.webSame}/${t.n}). Recorded, not live.`;
}

function renderVerdict(v, race) {
  hideStatus();
  lastVerdict = v;
  if (window.OfferSheetOracle) window.OfferSheetOracle.record(v);
  const be = v.breakEven;
  const cap = v.capacity || {};
  const known = cap.state === 'known' && typeof cap.value === 'number';
  const cannot = known && be.tickets > cap.value;

  $('verdict').hidden = false;
  // G21: the race section shows only when the secondary toggle ran a race.
  $('raceSection').hidden = !race;
  $('receiptSection').hidden = false;
  $('formula').hidden = false;
  $('raceToggleWrap').hidden = false;

  $('verdictSubject').textContent = `${v.artist} in ${v.city} · guarantee ${money(v.guarantee)}`;
  // SHIP item 10: checklist above the number.
  renderSignChecklist(v);
  animateTickets(be.tickets);
  // SHIP item 4: confidence label next to the verdict. Item 9: thin badge.
  renderConfidence(v);
  renderThinBadge(v);
  $('beVerdict').textContent = be.verdict || (be.note === 'no guarantee' ? 'No guarantee to cover — 0 tickets.' : '');
  // SHIP item 1: citation chips on the verdict.
  renderCiteChips(v);
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
  $('openerList').innerHTML = ranked.map((o) => `<li>${esc(o.name || o.id || '')}</li>`).join('') || '<li>No equivalent cleared the evidence checks — this does not mean none exists. <span class="next-action">Next action:</span> run the verdict again.</li>';
  // SHIP item 9: no forced winner. A first candidate from an unranked
  // shortlist is labelled as such, never as a ranked Graph pick.
  $('topPick').textContent = v.openers.topPick
    ? (v.openers.ranked.length > 0 ? `Graph pick: ${v.openers.topPick}` : `First candidate (unranked — no ranked winner this run): ${v.openers.topPick}`)
    : '';
  $('demoBlock').innerHTML = kvOrList(v.demographics, 'Who this audience is');
  $('trendBlock').innerHTML = kvOrList(v.trends, 'Whether the artist is rising');
  $('tagsBlock').innerHTML = kvOrList(v.sharedTags, 'Shared tags');
  $('overlapBlock').innerHTML = kvOrList(v.overlap, 'How the fan bases overlap');
  renderArms(v);
  renderReceipts(v);
  renderLegs(v);
  // SHIP items 8 + 7: leg summary next to the verdict, then the sheet.
  renderLegSummary(v);
  renderVerdictSheet(v);
  setBadge('Qloo live — verdict computed from live calls', 'green');
}

function renderNeedsInput(v) {
  hideVerdict();
  // Badge rule: green ONLY while a live verdict stands. A needs_input run
  // shows no verdict, so a stale green from an earlier run must not survive.
  setBadge('Qloo configured — awaiting your pick', 'amber');
  const candidates = Array.isArray(v.candidates) ? v.candidates : [];
  const btns = candidates.map((c) => `<button class="btn btn-sm" data-entity="${esc(c.id || c.name || '')}">${esc(c.name || c.id || '')}</button>`).join(' ');
  // A needs_input card must never be a dead end. Candidates render as
  // pickable options, and Try again always offers a way forward: it focuses
  // the artist field for an edited name, since re-running the same name
  // would just return this same card. When the payload carries zero
  // candidates, the card says so honestly instead of asking the user to
  // pick from nothing.
  const body = candidates.length > 0
    ? `<p class="big">More than one match — pick the one you mean.</p><p>${esc(v.message)}</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">${btns}</div>`
    : `<p class="big">No candidates to pick from.</p><p>Qloo returned no candidate entities for this name. Try a more specific or correctly spelled headliner name.</p>`;
  showStatus(`${body}<div style="margin-top:12px"><button class="btn" type="button" id="needsTryAgainBtn">Try again</button></div>`, 'amber');
  document.querySelectorAll('[data-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      submitVerdict(false, btn.getAttribute('data-entity'));
    });
  });
  const tryAgain = $('needsTryAgainBtn');
  if (tryAgain) tryAgain.addEventListener('click', () => {
    const f = $('artist');
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f.focus();
  });
}

function appendLegProgress(leg) {
  let ul = $('legProgress');
  if (!ul) {
    ul = document.createElement('ul');
    ul.id = 'legProgress';
    ul.className = 'leg-progress';
    ul.setAttribute('aria-label', 'Live verdict progress');
    $('status').appendChild(ul);
  }
  const li = document.createElement('li');
  li.textContent = `${leg.call || 'leg'} — ${leg.status} (${leg.elapsedMs ?? '?'}ms)`;
  ul.appendChild(li);
}

// Streamed verdict legs (LEGENDARY): GET /api/verdict/stream emits one
// 'leg' event per REAL completed backend call (tool/path + status + ms),
// then a 'verdict' event with the full verdict object, or an 'error'
// event. Returns the verdict object, or null when the stream ends without
// one (caller falls back to POST /api/verdict — never a partial verdict).
async function submitVerdictStreamed(body) {
  const qs = new URLSearchParams();
  for (const [k, val] of Object.entries(body)) {
    if (val !== undefined && val !== null && val !== '') qs.set(k, String(val));
  }
  const res = await fetch('/api/verdict/stream?' + qs.toString());
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (ev === 'leg' && data) {
          try { appendLegProgress(JSON.parse(data)); } catch { /* skip malformed leg line */ }
        } else if (ev === 'verdict' && data) {
          try { await reader.cancel(); } catch { /* already closed */ }
          return JSON.parse(data);
        } else if (ev === 'error') {
          try { await reader.cancel(); } catch { /* already closed */ }
          return null;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
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
    // Streamed legs first (non-race only): real per-call progress events.
    // Any stream failure before a verdict event falls back to the POST
    // path below — never a partial verdict, never a second live run
    // after a delivered verdict.
    let v = null;
    let resOk = false;
    let resStatus = 200;
    if (!race) {
      try { v = await submitVerdictStreamed(body); } catch { v = null; }
      if (v) { resOk = true; resStatus = 200; }
    }
    if (!v) {
      const res = await fetch(race ? '/api/race' : '/api/verdict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      v = await res.json();
      resOk = res.ok;
      resStatus = res.status;
    }
    clearInterval(timer);
    $('raceTimer').textContent = '';
    setRunning(false);
    if (!resOk) {
      hideVerdict();
      if (v.error?.code === 'NOT_CONFIGURED' || resStatus === 503) {
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
      if (window.OfferSheetWorkspace) window.OfferSheetWorkspace.seed(v);
      if (race && v.race) {
        $('raceBlock').innerHTML = `<p class="race-timer">Race timing — total ${v.race.totalMs}ms · Gut ${v.race.gutMs ?? '—'}ms · Web ${v.race.webMs ?? '—'}ms. Both arms ran live against the same question.</p>`;
      } else {
        $('raceBlock').innerHTML = '';
      }
    } else if (v.status === 'verdict_withheld') {
      hideVerdict();
      const plainMissing = (v.missingLegs || []).map((m) => plainLegName(m));
      // SHIP item 9: named refusal state. Map grouped missing names to
      // their leg keys; an errored leg means OUTAGE, empty/skipped means
      // THIN DATA. The 503 gate itself is untouched.
      const missingKeyMap = { 'rank-or-recommend': ['rank', 'recommend'], 'where_popular': ['wherePopular'], 'demographics': ['demographics'], 'compare-or-entity_tags': ['compare', 'entityTags'] };
      const missingStatuses = (v.missingLegs || []).flatMap((m) => missingKeyMap[m] || [m]).map((k) => v.legs?.[k]?.status);
      const kindLine = missingStatuses.includes('error')
        ? '<p>Refusal kind: OUTAGE — a required leg errored (outage), not thin data.</p>'
        : '<p>Refusal kind: THIN DATA — required legs returned empty or skipped (thin data), not an outage. No equivalent cleared the evidence checks — this does not mean none exists.</p>';
      showStatus(`<p class="big">Verdict withheld: evidence incomplete</p><p>${esc(v.message)}</p><p>Missing: ${esc(plainMissing.join(', '))}</p>${kindLine}<p>No numbers are shown in this state.</p><button class="btn" type="button" id="tryAgainBtn">Try again</button>`, 'red');
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

// ---- Redesign v2 motion layer (transform/opacity only, all guarded) ----
// Scroll progress is page state (like a scrollbar) and updates always;
// ghost drift, stack tilt, and magnetic buttons are decoration and skip
// reduced motion entirely. Any failure leaves the page fully usable.
try {
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ghost = document.querySelector('.ghost-strip span');
  let lastY = window.scrollY, vel = 0, ghostX = 0;
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    document.documentElement.style.setProperty('--sp', ratio.toFixed(4));
    if (!reducedMotion && ghost) {
      const y = window.scrollY;
      vel = vel * 0.85 + (y - lastY) * 0.15;
      lastY = y;
      ghostX = Math.max(-240, Math.min(240, ghostX + vel * 0.35));
      ghost.style.transform = `translateX(${ghostX.toFixed(1)}px)`;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Parallax-lite (polish v3): figures drift a few px at different rates
  // via the independent `translate` property, which composes with (never
  // fights) reveal transform animations. Reduced motion skips it.
  const plxFigs = Array.from(document.querySelectorAll('.fig[data-plx]'));
  const updatePlx = () => {
    if (reducedMotion) return;
    const vh = window.innerHeight;
    plxFigs.forEach((el) => {
      const r = el.getBoundingClientRect();
      const off = (r.top + r.height / 2 - vh / 2) * parseFloat(el.dataset.plx || '0');
      el.style.setProperty('--pl', off.toFixed(1));
    });
  };
  window.addEventListener('scroll', updatePlx, { passive: true });
  updatePlx();
  if (!reducedMotion) {
    // Hero-stack pointer tilt (TiltedCard pattern, vanilla): perspective
    // 1200px on the stage, base pose 10/-12, pointer adds at most 8deg.
    const stage = document.getElementById('heroStage');
    const stack = document.getElementById('dealStack');
    if (stage && stack) {
      stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        stack.style.transform = `rotateX(${(10 - py * 8).toFixed(2)}deg) rotateY(${(-12 + px * 8).toFixed(2)}deg)`;
      });
      const resetStack = () => { stack.style.transform = ''; };
      stage.addEventListener('pointerleave', resetStack);
      stage.addEventListener('pointercancel', resetStack);
    }
    // Magnetic primary buttons: a few pixels toward the pointer, spring back.
    document.querySelectorAll('.btn--primary').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = `translate(${(dx * 6).toFixed(1)}px, ${(dy * 4).toFixed(1)}px)`;
      });
      const resetBtn = () => { btn.style.transform = ''; };
      btn.addEventListener('pointerleave', resetBtn);
      btn.addEventListener('pointercancel', resetBtn);
    });
  }
} catch { /* motion is enhancement-only; the page works without it */ }
