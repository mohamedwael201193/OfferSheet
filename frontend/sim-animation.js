// OfferSheet recorded-demo animation — display only.
// It types recorded strings that are already in the markup and toggles
// step visibility on a timer. It fetches nothing, computes nothing, and
// contains no verdict logic: every number shown is static page text
// from the recorded 29 Oct 2026 trial (see index.html).
(function () {
  var stage = document.getElementById('simStage');
  if (!stage) return;
  var phase = document.getElementById('simPhase');
  var bar = document.getElementById('simProgressBar');
  var steps = Array.prototype.slice.call(stage.querySelectorAll('.sim-step'));
  var values = Array.prototype.slice.call(stage.querySelectorAll('[data-sim-text]'));
  var phases = [
    'Step 1 of 4 — the offer',
    'Step 2 of 4 — the ceil step',
    'Step 3 of 4 — the verdict',
    'Step 4 of 4 — the receipts'
  ];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showAll() {
    steps.forEach(function (s) { s.classList.add('is-on'); });
    values.forEach(function (v) { v.textContent = v.getAttribute('data-sim-text'); });
    if (phase) phase.textContent = 'Recorded demo — final state';
    if (bar) bar.style.width = '100%';
  }
  if (reduced) { stage.classList.add('sim-js'); showAll(); return; }

  stage.classList.add('sim-js');
  var timers = [];
  var stepIndex = 0;
  var valueIndex = 0;

  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); }); timers = []; }
  function typeValue(el, done) {
    var full = el.getAttribute('data-sim-text') || '';
    var i = 0;
    el.textContent = '';
    var caret = document.createElement('span');
    caret.className = 'sim-caret';
    caret.setAttribute('aria-hidden', 'true');
    el.appendChild(caret);
    (function tick() {
      if (i >= full.length) { caret.remove(); done(); return; }
      caret.before(document.createTextNode(full.charAt(i)));
      i += 1;
      timers.push(setTimeout(tick, 45));
    })();
  }
  function runStep(done) {
    var step = steps[stepIndex];
    if (!step) { done(); return; }
    step.classList.add('is-on');
    if (phase) phase.textContent = phases[stepIndex] || phases[0];
    if (bar) bar.style.width = ((stepIndex + 1) / steps.length * 100) + '%';
    var mine = Array.prototype.slice.call(step.querySelectorAll('[data-sim-text]'));
    (function next(j) {
      if (j >= mine.length) { timers.push(setTimeout(done, 900)); return; }
      typeValue(mine[j], function () { next(j + 1); });
    })(0);
  }
  function cycle() {
    clearTimers();
    steps.forEach(function (s) { s.classList.remove('is-on'); });
    values.forEach(function (v) { v.textContent = ''; });
    stepIndex = 0; valueIndex = 0;
    (function nextStep() {
      if (stepIndex >= steps.length) { timers.push(setTimeout(cycle, 3200)); return; }
      runStep(function () { stepIndex += 1; nextStep(); });
    })();
  }
  var inView = true;
  function startIfVisible() { if (inView && !document.hidden) cycle(); }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimers(); }
    else { startIfVisible(); }
  });
  // Pause the loop while the phone section is offscreen: the typing
  // timers and the 3.2s loop pause do no work until the stage is near
  // the viewport again (200px margin pre-starts it before it is seen).
  if ('IntersectionObserver' in window) {
    var simObserver = new IntersectionObserver(function (entries) {
      inView = !!(entries[0] && entries[0].isIntersecting);
      if (inView) { startIfVisible(); } else { clearTimers(); }
    }, { rootMargin: '200px' });
    simObserver.observe(stage);
  }
  startIfVisible();
})();
