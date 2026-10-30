/* U17 · real tabbed views for the dashboard. Presentation only: it never runs,
   hides or invents a verdict. It groups the existing sections (ids unchanged)
   into five panels, shows one at a time, and routes by URL hash so back/forward
   and deep links work. The existing .flow-step row becomes the ARIA tablist. */
(function () {
  var main = document.querySelector('.app-shell main.wrap');
  var row = document.querySelector('.flow-steps');
  if (!main || !row) return;
  var KEYS = ['offer', 'verdict', 'evidence', 'workspace', 'ledger'];
  var META = {
    offer: ['The offer', 'Enter artist, city and guarantee, then run the verdict.', 'verdict', 'Verdict'],
    verdict: ['The verdict', 'The break-even number first, then the checklist, formula and sheet.', 'evidence', 'Evidence'],
    evidence: ['The evidence', 'Every Qloo claim behind the number, each with a receipt you can replay.', 'workspace', 'Workspace'],
    workspace: ['The workspace', 'Save this offer, try a replacement or a renegotiation, compare up to five.', 'ledger', 'Ledger'],
    ledger: ['The ledger', 'Recorded trials and the Gut-vs-Graph tally — measured, never claimed.', null, null]
  };
  var NEEDS_RUN = { verdict: 1, evidence: 1 };
  var MAP = {
    tool: 'offer', 'u16-preview': 'offer',
    verdict: 'verdict', formula: 'verdict', verdictSheet: 'verdict', raceToggleWrap: 'verdict', raceSection: 'verdict', partialSection: 'verdict',
    evrow: 'evidence', evidence: 'evidence', receiptSection: 'evidence', depth: 'evidence', limits: 'evidence',
    workspace: 'workspace', trialTally: 'ledger', ledger: 'ledger'
  };
  var ALWAYS = ['breadcrumb', 'title-block', 'flow-steps', 'configBanner', 'status', 'safety', 'app-rule', 'u17-head'];
  var keyOf = function (el) {
    if (el.id && MAP[el.id]) return MAP[el.id];
    for (var k in MAP) if (el.classList.contains(k)) return MAP[k];
    return null;
  };
  var isAlways = function (el) { return ALWAYS.some(function (a) { return el.id === a || el.classList.contains(a); }); };
  var verdictEl = document.getElementById('verdict');
  var hasRun = function () { return !!(verdictEl && !verdictEl.hidden); };

  /* Panel heads (title + purpose) and "Next" buttons — no ids added. */
  var heads = {}, nexts = {};
  KEYS.forEach(function (k) {
    var h = document.createElement('div'); h.className = 'u17-head'; h.setAttribute('data-u17', k);
    h.innerHTML = '<p class="u17-kicker">' + String(KEYS.indexOf(k) + 1).padStart(2, '0') + ' of 05</p><h2 class="u17-title">' + META[k][0] + '</h2><p class="u17-purpose">' + META[k][1] + '</p>';
    heads[k] = h;
    if (META[k][2]) {
      var n = document.createElement('div'); n.className = 'u17-next'; n.setAttribute('data-u17', k);
      n.innerHTML = '<button type="button" class="u17-next-btn" data-go="' + META[k][2] + '">Next: ' + META[k][3] + ' <span aria-hidden="true">→</span></button><span class="u17-next-hint" hidden>Run a verdict first — the next step fills with it.</span>';
      nexts[k] = n;
    }
  });
  function place() {
    var kids = Array.prototype.slice.call(main.children), last = {}, first = {};
    // unknown dynamic children inherit the panel of the next known sibling
    for (var i = kids.length - 1, nextKey = null; i >= 0; i--) {
      var el = kids[i];
      if (el.classList.contains('u17-head') || el.classList.contains('u17-next')) continue;
      if (isAlways(el)) { el.removeAttribute('data-u17'); continue; }
      var k = keyOf(el) || nextKey || 'evidence';
      el.setAttribute('data-u17', k); nextKey = k;
      if (!last[k]) last[k] = el; first[k] = el;
    }
    KEYS.forEach(function (k) {
      if (first[k] && heads[k].nextSibling !== first[k]) main.insertBefore(heads[k], first[k]);
      if (nexts[k] && last[k] && last[k].nextSibling !== nexts[k]) last[k].after(nexts[k]);
    });
  }

  /* ARIA tablist on the existing step row. */
  row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', 'Dashboard views');
  var tabs = Array.prototype.slice.call(row.querySelectorAll('.flow-step'));
  tabs.forEach(function (t, i) {
    var k = KEYS[i]; t.setAttribute('role', 'tab'); t.setAttribute('data-tab', k);
    var ctl = Object.keys(MAP).filter(function (id) { return MAP[id] === k && document.getElementById(id); });
    if (ctl.length) t.setAttribute('aria-controls', ctl.join(' '));
    t.addEventListener('click', function () { go(k, true); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (e.key === 'Home') d = -i; if (e.key === 'End') d = tabs.length - 1 - i;
      if (d) { e.preventDefault(); var j = (i + d + tabs.length) % tabs.length; tabs[j].focus(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(k, true); }
    });
  });
  var hint = document.createElement('p'); hint.className = 'u17-hint'; hint.setAttribute('aria-live', 'polite');
  row.after(hint);

  var current = null;
  function syncDisabled() {
    var run = hasRun();
    tabs.forEach(function (t) {
      var dis = !run && NEEDS_RUN[t.getAttribute('data-tab')];
      t.setAttribute('aria-disabled', dis ? 'true' : 'false');
      t.title = dis ? 'Run a verdict first' : '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#appNav .nav-item .nav-state'), function (st, i) {
      if (i === 1 || i === 2) st.textContent = run ? 'open' : 'run a verdict to unlock';
    });
    Object.keys(nexts).forEach(function (k) {
      var target = META[k][2], dis = !run && NEEDS_RUN[target];
      var b = nexts[k].querySelector('button'), h = nexts[k].querySelector('.u17-next-hint');
      b.setAttribute('aria-disabled', dis ? 'true' : 'false'); h.hidden = !dis;
    });
  }
  function show(k) {
    current = k; place();
    main.setAttribute('data-u17-active', k);
    tabs.forEach(function (t) { var on = t.getAttribute('data-tab') === k; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
    Array.prototype.forEach.call(document.querySelectorAll('#appNav .nav-item'), function (it, i) { it.classList.toggle('u17-current', KEYS[i] === k); });
  }
  function go(k, push, scrollEl) {
    if (NEEDS_RUN[k] && !hasRun()) { hint.textContent = 'Run a verdict first — the ' + META[k][0].replace('The ', '') + ' view fills with it.'; return false; }
    if (!hint.classList.contains('u17-done') || k !== 'verdict') { hint.textContent = ''; hint.classList.remove('u17-done'); }
    show(k);
    var h = k === 'offer' ? '#offer' : '#' + k;
    if (push && location.hash !== h) history.pushState({ u17: k }, '', h);
    var target = scrollEl || main;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(function () {
      if (scrollEl) scrollEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
    return true;
  }
  function route() {
    var h = (location.hash || '').slice(1);
    if (!h) return go('offer', false);
    if (KEYS.indexOf(h) >= 0) return go(h, false) || go('offer', false);
    var el = document.getElementById(h);
    if (el) {
      var node = el; while (node && node.parentElement !== main) node = node.parentElement;
      var k = node ? (node.getAttribute('data-u17') || keyOf(node)) : null;
      if (k) return go(k, false, el) || go('offer', false);
    }
    go('offer', false);
  }
  main.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.u17-next-btn');
    if (!b) return;
    if (b.getAttribute('aria-disabled') === 'true') { b.parentNode.querySelector('.u17-next-hint').hidden = false; return; }
    go(b.getAttribute('data-go'), true);
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  /* Run → Verdict: when a real verdict appears, switch to its view; on reset, back to Offer. */
  if (verdictEl) new MutationObserver(function () {
    syncDisabled(); place();
    if (hasRun()) { if (current !== 'verdict' && document.documentElement.classList.contains('u17-live')) { go('verdict', true, verdictEl); hint.textContent = 'Done — your verdict is ready.'; hint.classList.add('u17-done'); document.documentElement.classList.remove('u17-live'); } }
    else if (NEEDS_RUN[current]) go('offer', true);
  }).observe(verdictEl, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(function () { place(); }).observe(main, { childList: true });

  document.documentElement.classList.add('u17-tabs');
  syncDisabled(); route();
})();

/* U17 · inline validation, run-start cleanup, done signal, verdict tidy-up. */
(function () {
  var form = document.getElementById('offerForm'); if (!form) return;
  var main = document.querySelector('.app-shell main.wrap');
  var $ = function (id) { return document.getElementById(id); };
  function clearErr(input) {
    input.removeAttribute('aria-invalid'); input.setCustomValidity('');
    var n = input.parentNode.querySelector('.u17-err'); if (n) n.remove();
  }
  function setErr(input, msg) {
    input.setAttribute('aria-invalid', 'true'); input.setCustomValidity(msg);
    var n = input.parentNode.querySelector('.u17-err');
    if (!n) { n = document.createElement('span'); n.className = 'u17-err'; n.setAttribute('role', 'alert'); input.after(n); }
    n.textContent = msg;
  }
  ['guarantee', 'ticketPrice', 'variableCost', 'artist', 'city', 'roomCost', 'productionCost', 'marketingCost', 'otherFixedCosts', 'sponsorOffset', 'capacity']
    .forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', function () { clearErr(el); }); });
  function validate() {
    var errs = [];
    var g = $('guarantee'), tp = $('ticketPrice'), vc = $('variableCost'), a = $('artist'), c = $('city');
    [a, c, g, tp, vc].forEach(function (el) { if (el) clearErr(el); });
    if (a && !a.value.trim()) errs.push([a, 'Enter the headliner\u2019s name.']);
    if (c && !c.value.trim()) errs.push([c, 'Enter the city of the show.']);
    if (g && (g.value === '' || !(Number(g.value) > 0))) errs.push([g, 'Enter the guarantee in US dollars — a number above 0.']);
    var price = tp && tp.value !== '' ? Number(tp.value) : null;
    if (tp && tp.value !== '' && !(price > 0)) errs.push([tp, 'A ticket price must be above $0 — or leave it blank so event history can supply it.']);
    if (vc && vc.value !== '') {
      var v = Number(vc.value);
      if (!(v >= 0)) errs.push([vc, 'Variable cost cannot be negative.']);
      else if (price !== null && v >= price) errs.push([vc, 'Variable cost must stay below the ticket price, or no break-even count exists.']);
    }
    ['roomCost', 'productionCost', 'marketingCost', 'otherFixedCosts', 'sponsorOffset', 'capacity'].forEach(function (id) {
      var el = $(id); if (!el) return; clearErr(el);
      if (el.value !== '' && !(Number(el.value) >= (id === 'capacity' ? 1 : 0))) errs.push([el, id === 'capacity' ? 'Capacity must be at least 1 — or leave it blank.' : 'Costs cannot be negative — leave it blank if not known.']);
    });
    errs.forEach(function (e) { setErr(e[0], e[1]); });
    if (errs.length) {
      var first = errs[0][0];
      var d = first.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
      first.focus(); first.scrollIntoView({ block: 'center' });
      return false;
    }
    return true;
  }
  form.setAttribute('novalidate', '');
  form.addEventListener('submit', function (e) {
    if (!validate()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    // a live run is starting: the recorded example leaves the screen so it can never read as the answer
    if (main) main.classList.add('u17-ran');
    var pv = document.querySelector('.u16-preview'); if (pv) pv.hidden = true;
    document.documentElement.classList.add('u17-live');
    setTimeout(function () { var st = $('status'); if (st && !st.hidden) st.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, 80);
  }, true);

  /* done signal + tidy verdict once a real verdict renders */
  var v = $('verdict');
  if (!v) return;
  function tidy() {
    var fig = $('headlinerImage'), img = $('headlinerImageImg');
    if (fig && img) {
      var ok = function () { fig.classList.toggle('u17-img-ok', !!(img.getAttribute('src') && img.naturalWidth > 0)); };
      ok(); img.addEventListener('load', ok); img.addEventListener('error', ok);
    }
    // merge runs of adjacent "Source: …" tags into one clean line
    Array.prototype.forEach.call(v.querySelectorAll('.source-tag'), function (t) {
      if (t.dataset.u17) return;
      var group = [t], n = t.nextSibling;
      while (n && (n.nodeType === 3 && !n.textContent.trim() || n.nodeType === 1 && n.classList.contains('source-tag'))) { if (n.nodeType === 1) group.push(n); n = n.nextSibling; }
      if (group.length < 2) { t.dataset.u17 = '1'; return; }
      var labels = [], chips = [];
      group.forEach(function (g) {
        g.dataset.u17 = '1';
        var chip = g.querySelector('.source-tag-chip'); if (chip) chips.push(chip);
        var txt = Array.prototype.filter.call(g.childNodes, function (x) { return x.nodeType === 3; }).map(function (x) { return x.textContent; }).join('').replace(/^\s*Source:\s*/, '').trim();
        if (txt && labels.indexOf(txt) < 0) labels.push(txt);
      });
      t.textContent = 'Sources: ' + labels.join(' · ') + ' ';
      chips.forEach(function (c) { t.appendChild(c); });
      group.slice(1).forEach(function (g) { g.remove(); });
    });
  }
  new MutationObserver(function () {
    if (v.hidden) return;
    tidy();
    var st = $('status');
    if (st && !st.hidden && !st.querySelector('.u17-done')) {
      var p = document.createElement('p'); p.className = 'u17-done'; p.textContent = 'Done — your verdict is ready.'; st.prepend(p);
    }
  }).observe(v, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
})();
