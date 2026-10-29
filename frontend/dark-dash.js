/* Dark dashboard pointer effects — vanilla, no verdict logic touched.
   Sets --mx/--my on spotlight panels and glow buttons for pointer:fine
   devices only. No motion: these are static gradients positioned by the
   pointer. Under prefers-reduced-motion the spotlight is hidden by CSS
   and this script does nothing. */
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;
  function track(el) {
    el.addEventListener('pointermove', function (ev) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100) + '%');
      el.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100) + '%');
    });
  }
  document.querySelectorAll('.spotlight, .btn--primary').forEach(track);
})();
