/* OfferSheet dark landing — motion only, vanilla, no data calls.
   Every effect is JS-gated so no-JS renders full content, and every
   effect is skipped under prefers-reduced-motion (static final frames).
   Nothing here computes a verdict, fetches, or touches app state. */
(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* APK link: the download is a real <a href> in index.html, so it works
     with no JavaScript. No handler is needed or kept here. */

  /* Image fallback: a failed figure becomes a neutral placeholder box
     instead of a broken-image icon; layout does not shift. */
  document.querySelectorAll('img').forEach(function (img) {
    img.addEventListener('error', function () {
      var ph = document.createElement('div');
      ph.className = 'icon-placeholder';
      ph.setAttribute('aria-hidden', 'true');
      img.replaceWith(ph);
    });
  });

  if (reduced) return;

  /* Preloader with counter (JS-created only; safety timeout removes it
     even if the counter stalls, so it can never trap the page). */
  (function () {
    var pre = document.createElement('div');
    pre.className = 'preloader';
    pre.setAttribute('aria-hidden', 'true');
    var num = document.createElement('span');
    num.className = 'preloader-num';
    num.textContent = '0';
    pre.appendChild(num);
    document.body.appendChild(pre);
    var start = null, done = false;
    function finish() {
      if (done) return;
      done = true;
      pre.classList.add('done');
      setTimeout(function () { if (pre.parentNode) pre.parentNode.removeChild(pre); }, 350);
    }
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / 900, 1);
      num.textContent = String(Math.round(p * 100));
      if (p < 1) requestAnimationFrame(step); else finish();
    }
    requestAnimationFrame(step);
    setTimeout(finish, 2500);
  })();

  /* Letter-by-letter headline reveals + clip-mask statement: all
     observed, all one-shot, all transform / opacity only. (The
     formula section no longer has a scroll-drawn diagram: its labeled
     breakdown renders statically, so there is nothing to observe.) */
  if ('IntersectionObserver' in window) {
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      var text = el.textContent;
      el.textContent = '';
      var idx = 0;
      /* Split into WORDS first: each word is a white-space:nowrap
         wrapper holding its character spans, and spaces stay as text
         nodes between word wrappers — so lines break only between
         words, never mid-word, at any width. */
      text.split(' ').forEach(function (word, wi) {
        if (wi > 0) el.appendChild(document.createTextNode(' '));
        if (word === '') return;
        var wrap = document.createElement('span');
        wrap.className = 'rl-word';
        Array.prototype.forEach.call(word, function (ch) {
          var sp = document.createElement('span');
          sp.className = 'rl';
          sp.style.setProperty('--d', Math.min(idx * 28, 840) + 'ms');
          idx += 1;
          sp.textContent = ch;
          wrap.appendChild(sp);
        });
        el.appendChild(wrap);
      });
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
    document.querySelectorAll('[data-clip]').forEach(function (el) {
      el.classList.add('js-clip');
      io.observe(el);
    });
    /* Hero figure scroll reveal (d-hero): one short fade/rise, once,
       observed like the other reveals. JS-gated: the .js-hero class is
       only added here, so no-JS and reduced-motion (which returns
       before this block) render the figure at full opacity. */
    var heroFigure = document.querySelector('.hero-figure');
    if (heroFigure) {
      heroFigure.classList.add('js-hero');
      var ioHero = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('revealed'); ioHero.unobserve(e.target); }
        });
      }, { threshold: 0.15 });
      ioHero.observe(heroFigure);
    }
  }

  /* One rAF scroll loop: parallax fan + footer wordmark velocity-stretch.
     Transform-only, clamped, and only while the element is on screen. */
  (function () {
    var fans = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
    var wordmark = document.querySelector('.footer-wordmark');
    var ticking = false, lastY = window.scrollY, vel = 0;
    function update() {
      ticking = false;
      var vh = window.innerHeight;
      fans.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var off = (r.top + r.height / 2 - vh / 2) * parseFloat(el.dataset.parallax || '0');
        el.style.setProperty('--py', Math.max(-40, Math.min(40, off)).toFixed(1) + 'px');
      });
      if (wordmark) {
        var wr = wordmark.getBoundingClientRect();
        if (wr.bottom >= 0 && wr.top <= vh) {
          var y = window.scrollY;
          vel = vel * 0.85 + (y - lastY) * 0.15;
          lastY = y;
          var stretch = 1 + Math.min(Math.abs(vel) * 0.0015, 0.12);
          wordmark.style.transform = 'scaleX(' + stretch.toFixed(3) + ')';
        } else {
          wordmark.style.transform = '';
        }
      }
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();
})();
