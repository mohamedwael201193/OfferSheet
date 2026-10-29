// OfferSheet landing — motion only. No framework, no build step, no keys,
// no data calls of any kind. This page is display-only: every number on it
// is static page text, and the working app lives on app.html.
const $ = (id) => document.getElementById(id);

// Image fallback: the hero shows the styled brief panel; figures keep a
// styled placeholder box instead of display:none layout shift.
document.querySelectorAll('img').forEach((img) => {
  img.addEventListener('error', () => {
    if (img.id === 'heroImg') {
      img.classList.add('img-missing');
      $('heroFallback').classList.add('show');
    } else if (img.dataset.fallback) {
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

// Motion layer (transform/opacity only, all guarded).
// Scroll progress is page state (like a scrollbar) and updates always;
// ghost drift, stack tilt, parallax, and magnetic buttons are decoration
// and skip reduced motion entirely. Any failure leaves the page usable.
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
