/* U16 · landing motion (Direction A). Vanilla + self-hosted GSAP 3 / ScrollTrigger.
   Rules: transforms + opacity only (SVG stroke draw is the one paint-only exception);
   no verdict calls, no app state. The counter target is read from trial-pack.json
   (Trial 1 breakEvenTickets, cross-checked against ceil(guarantee / ticketPrice));
   the HTML already holds the final value, so no-JS / reduced-motion / fetch failure
   all render the complete static frame. */
(function () {
  var g = window.gsap, ST = window.ScrollTrigger;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  /* Trial-1 target from the recorded pack; null when unavailable (HTML value stays). */
  var target = fetch('trial-pack.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (p) {
    var t = p && p.trials && p.trials[0];
    if (!t || !t.inputs) return null;
    var calc = Math.ceil(t.inputs.guarantee / t.inputs.ticketPrice);
    return calc === t.breakEvenTickets ? calc : null;
  }).catch(function () { return null; });

  /* Card spotlight follows the pointer (CSS custom props only). */
  $$('body.v3 .card').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* Active nav link (IntersectionObserver; harmless without motion). */
  if ('IntersectionObserver' in window) {
    var links = $$('.topbar .nav-links a[href^="#"]');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) io.observe(s); });
    var st = $('#story'); if (st) io.observe(st);
  }

  if (reduced || !g || !ST) return;
  g.registerPlugin(ST);
  document.documentElement.classList.add('u16-js');

  /* Seamless ticker: duplicate track content once (clone is aria-hidden). */
  var track = $('.u16-ticker-track');
  if (track) { var clone = document.createElement('span'); clone.setAttribute('aria-hidden', 'true'); clone.style.display = 'contents'; clone.innerHTML = track.innerHTML; track.appendChild(clone); }

  /* Scroll progress bar. */
  var bar = document.createElement('div'); bar.className = 'u16-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
  g.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

  /* Split hero h1 into word masks (keeps text + <br>, aria-label carries the line). */
  var h1 = $('#hero h1');
  if (h1) {
    h1.setAttribute('aria-label', h1.textContent.replace(/\s+/g, ' ').trim());
    h1.innerHTML = h1.innerHTML.split(/(<br\s*\/?>)/i).map(function (part) {
      if (/^<br/i.test(part)) return part;
      return part.split(/(\s+)/).map(function (w) { return /^\s+$/.test(w) || !w ? w : '<span class="u16-w" aria-hidden="true"><span>' + w + '</span></span>'; }).join('');
    }).join('');
  }

  function countUp(el, to, dur) {
    var o = { v: 0 };
    return g.to(o, { v: to, duration: dur || 1.6, ease: 'power3.out', onUpdate: function () { el.textContent = fmt(o.v); }, onComplete: function () { el.textContent = fmt(to); } });
  }

  var mm = g.matchMedia();

  /* ---------- hero intro ---------- */
  var intro = g.timeline({ defaults: { ease: 'expo.out', duration: 1 } });
  intro.from('#hero img.bg', { scale: 1.14, duration: 2.2, ease: 'power2.out' }, 0)
    .from('.u16-beams i', { scaleY: 0, autoAlpha: 0, transformOrigin: '50% 0', stagger: 0.12, duration: 1.6, ease: 'power3.out' }, 0.1)
    .from('#hero .eyebrow', { y: 16, autoAlpha: 0 }, 0.25)
    .from('#hero h1 .u16-w > span', { yPercent: 110, stagger: 0.06, duration: 1.1 }, 0.3)
    .from('#hero p.sub, #hero .cta-row', { y: 24, autoAlpha: 0, stagger: 0.1 }, 0.7)
    .from('.u16-fig', { y: 48, autoAlpha: 0, duration: 1.1 }, 0.85)
    .from('.u16-fig-rule', { scaleX: 0, duration: 1, ease: 'power3.inOut' }, 1.2)
    .from('.u16-fig-ceil, .u16-fig-who', { y: 10, autoAlpha: 0, stagger: 0.08, duration: 0.6 }, 1.4)
    .from('.u16-ticker', { autoAlpha: 0, duration: 0.8 }, 1.2);
  var heroNum = $('.u16-fig .u16-count');
  target.then(function (t) { if (t && heroNum) intro.add(countUp(heroNum, t, 1.8), 1.0); });

  /* Beam sway (slow, infinite, transform only). */
  $$('.u16-beams i').forEach(function (b, i) { g.to(b, { rotation: '+=' + (i % 2 ? -7 : 7), duration: 5 + i, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 2 }); });

  /* Hero parallax out on scroll. */
  g.to('#hero img.bg', { yPercent: 14, scale: 1.08, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
  g.to('#hero .inner, .u16-fig', { yPercent: -18, autoAlpha: 0.2, ease: 'none', scrollTrigger: { trigger: '#hero', start: '35% top', end: 'bottom top', scrub: true } });

  /* ---------- statement: words light up as you scroll ---------- */
  var big = $('#statement h2.big');
  if (big) {
    big.setAttribute('aria-label', big.textContent.replace(/\s+/g, ' ').trim());
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
            var s = document.createElement('span'); s.className = 'u16-sw'; s.setAttribute('aria-hidden', 'true'); s.textContent = w; frag.appendChild(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(big);
    g.to('#statement .u16-sw', { opacity: 1, stagger: 0.08, ease: 'none', scrollTrigger: { trigger: big, start: 'top 80%', end: 'bottom 45%', scrub: 0.6 } });
  }

  /* ---------- generic reveals ---------- */
  var revealSel = 'section.wrap > .eyebrow, section.wrap > h2, section.wrap > .lede, section.wrap > .tally, #statement .sub2, .fig, #flow .step, #evidence .card, .proof, .formula-big > p, .trial, .evmini, .workstrip, .empty, .table-wrap, .ms-section > *:not(.ms-layout), .ms-copy > *, .footer-inner > *';
  g.set(revealSel, { y: 36, autoAlpha: 0 });
  ST.batch(revealSel, { start: 'top 88%', once: true, onEnter: function (els) { g.to(els, { y: 0, autoAlpha: 1, stagger: 0.08, duration: 1, ease: 'expo.out', overwrite: true }); } });

  /* SVG diagrams draw themselves. */
  $$('.fig svg').forEach(function (svg) {
    var shapes = $$('line, circle, path', svg);
    shapes.forEach(function (s) { var l = s.getTotalLength ? s.getTotalLength() : 0; if (l) { s.style.strokeDasharray = l; s.style.strokeDashoffset = l; } });
    var texts = $$('text', svg);
    var tl = g.timeline({ scrollTrigger: { trigger: svg, start: 'top 80%', once: true } });
    tl.to(shapes, { strokeDashoffset: 0, duration: 1.2, stagger: 0.08, ease: 'power2.inOut' })
      .from(texts, { autoAlpha: 0, y: 6, stagger: 0.04, duration: 0.5 }, 0.5);
  });

  /* Photo band parallax. */
  g.fromTo('.photo-band img', { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: '.photo-band', start: 'top bottom', end: 'bottom top', scrub: true } });

  /* Recorded trial numbers count up (values already in the HTML; read them back). */
  $$('.trial .t-num').forEach(function (el) {
    var to = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10); if (!to) return;
    ST.create({ trigger: el, start: 'top 85%', once: true, onEnter: function () { countUp(el, to, 1.6); } });
  });

  /* Dashboard picture tilts up into place. */
  g.from('#dashboard .shell', { rotationX: 14, y: 80, scale: 0.94, autoAlpha: 0, transformPerspective: 1400, ease: 'none', scrollTrigger: { trigger: '#dashboard .shell', start: 'top 95%', end: 'top 45%', scrub: 0.8 } });

  /* ---------- pinned story ---------- */
  var steps = $$('.u16-story-steps li'), cards = $$('.u16-story-stage > .u16-card'), prog = $('.u16-story-progress i');
  var storyNum = $('.u16-card--verdict .u16-count');
  function setStep(i) { steps.forEach(function (s, k) { s.classList.toggle('on', k === i); }); }

  mm.add('(min-width: 901px)', function () {
    g.set(cards, { autoAlpha: 0, yPercent: 12, rotationX: -10, scale: 0.96 });
    g.set(cards[0], { autoAlpha: 1, yPercent: 0, rotationX: 0, scale: 1 });
    g.set(prog, { scaleX: 0.25 });
    var tl = g.timeline({ defaults: { ease: 'power2.inOut', duration: 1 },
      scrollTrigger: { trigger: '.u16-story', start: 'top top', end: '+=' + (cards.length * 80) + '%', pin: '.u16-story-pin', scrub: 0.8, anticipatePin: 1,
        onUpdate: function (self) { setStep(Math.min(cards.length - 1, Math.floor(self.progress * cards.length * 0.999 + 0.12))); } } });
    for (var i = 1; i < cards.length; i++) {
      tl.to(cards[i - 1], { autoAlpha: 0, yPercent: -10, rotationX: 12, scale: 0.95, duration: 0.4, ease: 'power2.in' }, i - 0.3)
        .to(cards[i], { autoAlpha: 1, yPercent: 0, rotationX: 0, scale: 1, duration: 0.55, ease: 'power3.out' }, i + 0.1)
        .to(prog, { scaleX: (i + 1) / cards.length, ease: 'none' }, i);
    }
    tl.to({}, { duration: 0.6 });
    var counted = false;
    target.then(function (t) {
      if (!t || !storyNum) return;
      ST.create({ trigger: '.u16-story', start: 'top top', end: '+=' + (cards.length * 80) + '%', onUpdate: function (self) {
        if (!counted && self.progress > 0.7) { counted = true; countUp(storyNum, t, 1.4); }
      } });
    });
    return function () { g.set(cards, { clearProps: 'all' }); setStep(0); };
  });
  mm.add('(max-width: 900px)', function () {
    cards.forEach(function (c, i) {
      g.from(c, { y: 48, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: c, start: 'top 88%', once: true, onEnter: function () { setStep(i); } } });
    });
    target.then(function (t) { if (t && storyNum) ST.create({ trigger: storyNum, start: 'top 85%', once: true, onEnter: function () { countUp(storyNum, t, 1.4); } }); });
  });
  g.from('.u16-story-steps li', { x: -24, autoAlpha: 0, stagger: 0.1, duration: 0.9, ease: 'expo.out', scrollTrigger: { trigger: '.u16-story', start: 'top 75%', once: true } });

  /* ---------- phone section ---------- */
  var dev = $('.ms-device');
  if (dev) {
    g.fromTo(dev, { rotationX: 28, rotationY: -18, rotationZ: 4, y: 140, scale: 0.86, transformPerspective: 1400 },
      { rotationX: 0, rotationY: 0, rotationZ: 0, y: 0, scale: 1, ease: 'none', scrollTrigger: { trigger: '#get-the-app', start: 'top 90%', end: 'center 55%', scrub: 1 } });
    var rows = $$('.record-stage > *:not(.record-topbar)');
    var phoneNum = $('.record-verdict-num');
    var pt = g.timeline({ scrollTrigger: { trigger: dev, start: 'top 60%', once: true } });
    pt.from(rows, { y: 14, autoAlpha: 0, stagger: 0.09, duration: 0.6, ease: 'power3.out' });
    target.then(function (t) { if (t && phoneNum) pt.add(countUp(phoneNum, t, 1.4), 0.45); });
    $$('.u16-chip').forEach(function (c, i) {
      g.from(c, { y: 30, autoAlpha: 0, scale: 0.9, duration: 0.9, ease: 'back.out(1.6)', delay: 0.2 + i * 0.15, scrollTrigger: { trigger: dev, start: 'top 65%', once: true } });
      g.to(c, { y: i % 2 ? 10 : -10, duration: 2.6 + i * 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.4 });
    });
  }

  /* ---------- fine-pointer extras: magnetic CTA + cursor ring ---------- */
  mm.add('(pointer: fine) and (min-width: 901px)', function () {
    var cta = $('#hero .cta-gold');
    var cleanups = [];
    if (cta) {
      var xt = g.quickTo(cta, 'x', { duration: 0.4, ease: 'power3' }), yt = g.quickTo(cta, 'y', { duration: 0.4, ease: 'power3' });
      var mv = function (e) { var r = cta.getBoundingClientRect(); xt((e.clientX - r.left - r.width / 2) * 0.25); yt((e.clientY - r.top - r.height / 2) * 0.35); };
      var lv = function () { xt(0); yt(0); };
      cta.addEventListener('pointermove', mv); cta.addEventListener('pointerleave', lv);
      cleanups.push(function () { cta.removeEventListener('pointermove', mv); cta.removeEventListener('pointerleave', lv); });
    }
    var ring = document.createElement('div'); ring.className = 'u16-cursor'; ring.setAttribute('aria-hidden', 'true'); document.body.appendChild(ring);
    var cx = g.quickTo(ring, 'x', { duration: 0.35, ease: 'power3' }), cy = g.quickTo(ring, 'y', { duration: 0.35, ease: 'power3' });
    var mmv = function (e) { ring.classList.add('is-on'); cx(e.clientX); cy(e.clientY); ring.classList.toggle('is-hot', !!(e.target.closest && e.target.closest('a,button,summary,.card'))); };
    window.addEventListener('pointermove', mmv, { passive: true });
    return function () { window.removeEventListener('pointermove', mmv); ring.remove(); cleanups.forEach(function (f) { f(); }); };
  });

  window.addEventListener('load', function () { ST.refresh(); });
})();
