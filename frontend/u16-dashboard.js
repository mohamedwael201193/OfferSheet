/* U16 · dashboard motion (Direction B). Reads only what app.js already rendered;
   computes nothing, fetches nothing. Reduced motion: no animation at all. */
(function () {
  var g = window.gsap;
  var $ = function (s) { return document.querySelector(s); };
  var v = $('#verdict'), bt = $('#beTickets');
  if (bt && bt.parentNode && !v.querySelector('.u16-rule')) {
    var r = document.createElement('div'); r.className = 'u16-rule'; r.setAttribute('aria-hidden', 'true'); bt.parentNode.after(r);
  }
  /* Fixed costs: open the folded group before the browser validates a hidden field */
  var costs = document.querySelector('.u16-costs'), form = $('#offerForm');
  if (costs && form) {
    form.addEventListener('invalid', function (e) { if (costs.contains(e.target)) costs.open = true; }, true);
    var sub = function () { if (costs.querySelector(':invalid')) costs.open = true; };
    form.addEventListener('submit', sub, true);
    document.querySelectorAll('button[form="offerForm"], #offerForm button[type="submit"]').forEach(function (b) { b.addEventListener('click', sub, true); });
  }

  /* Recorded preview (sketch B right column): Trial 1 from trial-pack.json, labelled
     Recorded / not live. Missing values say so. Hidden by CSS once a real verdict renders. */
  var pv = document.querySelector('.u16-preview');
  if (pv) fetch('trial-pack.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (p) {
    var t = p && p.trials && p.trials[0]; if (!t || !t.inputs) return;
    var f = function (n) { return Number(n).toLocaleString('en-US'); };
    var q = function (k, v) { var el = pv.querySelector('[data-pv="' + k + '"]'); if (el) el.textContent = v; };
    q('tag', 'Recorded · Trial 1 · ' + (t.timingMs / 1000).toFixed(1) + 's · ' + String(t.recordedAt).slice(0, 10) + ' · not live');
    q('subject', t.inputs.artist + ' · ' + t.inputs.city + ' · $' + f(t.inputs.guarantee) + ' / $' + f(t.inputs.ticketPrice));
    q('num', f(t.breakEvenTickets));
    q('price', '$' + f(t.inputs.ticketPrice));
    q('graph', t.graphPick || '— not in recorded pack');
    pv.hidden = false;
  }).catch(function () {});

  if (!g || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var tl = g.timeline({ defaults: { ease: 'expo.out', duration: 0.7 } });
  /* transform-only intro: text keeps full opacity, so contrast is never reduced mid-animation */
  tl.from('.flow-step', { y: 8, stagger: 0.05, duration: 0.5 }, 0)
    .from('#tool', { y: 20 }, 0.1)
    .from('#tool .field', { y: 10, stagger: 0.03, duration: 0.45 }, 0.25)
    .from('.u16-preview', { x: 24 }, 0.35);
  if (!v) return;
  var shown = !v.hidden;
  new MutationObserver(function () {
    if (v.hidden) { shown = false; return; }
    if (shown) return; shown = true;
    var t = g.timeline({ defaults: { ease: 'expo.out' } });
    t.fromTo(v, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7 }, 0);
    /* the live verdict number is never animated (product rule); only its frame moves */
    t.from('.u16-rule', { scaleX: 0, duration: 0.8, ease: 'power3.inOut' }, 0.25)
      .from('#verdict .facts > div', { y: 8, autoAlpha: 0, stagger: 0.05, duration: 0.4 }, 0.4);
  }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
})();
