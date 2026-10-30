/* U20b effects, vanilla ports. All are off under prefers-reduced-motion;
   the spotlight is also off on touch (no hover) devices.
   - Count up (idea from React Bits "Count Up"): animates figures marked
     [data-u20-count] from 0 to the value already in the DOM. The final
     text is the server text, untouched; only the in-between frames change.
   - Spotlight (idea from Cursify "spotlight cursor", ported as a card
     glow): a soft gold radial light that follows the pointer inside a card. */
(function () {
  // U20c layout (not motion, so it runs under reduced motion too): the two
  // closing discs (integration depth, what Qloo doesn't decide) share one
  // slim row. Sections move into a wrapper that carries their tab key; ids
  // and content are unchanged.
  function slimRow() {
    var d = document.getElementById('depth'), l = document.getElementById('limits');
    if (!d || !l || d.parentElement.classList.contains('u20c-slim')) return;
    var key = d.getAttribute('data-u17'); if (!key) return;
    var w = document.createElement('div'); w.className = 'u20c-slim'; w.setAttribute('data-u17', key);
    d.parentElement.insertBefore(w, d); w.appendChild(d); w.appendChild(l);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(slimRow, 0); }); else setTimeout(slimRow, 0);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (reduce) { document.documentElement.classList.add('u20-still'); return; }

  function countUp(el) {
    if (el.dataset.u20Done === el.textContent) return;
    var finalText = el.textContent;
    var m = finalText.match(/^(\D*)([\d,]+)(.*)$/);
    if (!m) return;
    var target = Number(m[2].replace(/,/g, ''));
    if (!isFinite(target) || target === 0) { el.dataset.u20Done = finalText; return; }
    var t0 = null, dur = 700;
    function frame(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? m[1] + Math.round(target * e).toLocaleString('en-US') + m[3] : finalText;
      if (k < 1) requestAnimationFrame(frame); else el.dataset.u20Done = finalText;
    }
    requestAnimationFrame(frame);
  }
  function scan(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.u20-tally b'), function (b) {
      var r = b.getBoundingClientRect();
      if (r.width && !b.dataset.u20Done && /^\d[\d,]*$/.test(b.textContent)) countUp(b);
    });
  }
  var mo = new MutationObserver(function () { scan(); });
  document.addEventListener('DOMContentLoaded', function () {
    var t = document.getElementById('tallyTable'); if (t) mo.observe(t, { childList: true });
    window.addEventListener('hashchange', function () { setTimeout(scan, 60); });
    scan();
  });

  if (touch) return;
  var SEL = '#evidence > details, .u20-trial, #workspace .ws-panel, .sheet.verdict-card, #verdict';
  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest(SEL);
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--u20-mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--u20-my', (e.clientY - r.top) + 'px');
    card.classList.add('u20-lit');
  }, { passive: true });
  document.addEventListener('pointerout', function (e) {
    var card = e.target.closest && e.target.closest(SEL);
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('u20-lit');
  }, { passive: true });
})();
