/* U16 · dashboard motion (Direction B). Reads only what app.js already rendered;
   computes nothing, fetches nothing. Reduced motion: no animation at all. */
(function () {
  var g = window.gsap;
  var $ = function (s) { return document.querySelector(s); };
  var v = $('#verdict'), bt = $('#beTickets');
  if (bt && bt.parentNode && !document.querySelector('.u16-rule')) {
    var r = document.createElement('div'); r.className = 'u16-rule'; r.setAttribute('aria-hidden', 'true'); bt.parentNode.after(r);
  }
  if (!g || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var tl = g.timeline({ defaults: { ease: 'expo.out', duration: 0.7 } });
  tl.from('.flow-step', { y: 8, autoAlpha: 0, stagger: 0.05, duration: 0.5 }, 0)
    .from('#tool', { y: 20, autoAlpha: 0 }, 0.1)
    .from('#tool .field', { y: 10, autoAlpha: 0, stagger: 0.03, duration: 0.45 }, 0.25)
    .from('.u16-empty', { x: 24, autoAlpha: 0 }, 0.35);
  if (!v) return;
  var shown = !v.hidden;
  new MutationObserver(function () {
    if (v.hidden) { shown = false; return; }
    if (shown) return; shown = true;
    var t = g.timeline({ defaults: { ease: 'expo.out' } });
    t.fromTo(v, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7 }, 0);
    var to = bt ? parseInt(bt.textContent.replace(/[^0-9]/g, ''), 10) : NaN;
    if (bt && to > 0 && /^[0-9,]+$/.test(bt.textContent.trim())) {
      var final = bt.textContent, o = { n: 0 };
      t.to(o, { n: to, duration: 1.2, ease: 'power3.out', onUpdate: function () { bt.textContent = Math.round(o.n).toLocaleString('en-US'); }, onComplete: function () { bt.textContent = final; } }, 0.15);
    }
    t.from('.u16-rule', { scaleX: 0, duration: 0.8, ease: 'power3.inOut' }, 0.25)
      .from('#verdict .facts > div', { y: 8, autoAlpha: 0, stagger: 0.05, duration: 0.4 }, 0.4);
  }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
})();
