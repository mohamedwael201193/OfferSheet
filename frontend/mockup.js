// OfferSheet landing phone mockup — recorded-trial replay ONLY.
// Presentation-only navigation between pre-written screens.
// This file contains no network call, no verdict computation, no
// editable input, and no auto-advance. Every number shown is
// pre-written recorded-trial copy already present in index.html.
(function () {
  var frame = document.getElementById("mockupFrame");
  if (!frame) {
    return;
  }
  var screens = frame.querySelectorAll(".mockup-screen");
  var currentTrial = null;

  function show(screen, trial) {
    var target = null;
    screens.forEach(function (panel) {
      var isTarget =
        panel.getAttribute("data-screen") === screen &&
        (!panel.getAttribute("data-trial") ||
          panel.getAttribute("data-trial") === trial);
      panel.classList.toggle("is-active", isTarget);
      if (isTarget) {
        target = panel;
      }
    });
    return target;
  }

  frame.classList.add("mockup--js");
  show("0", null);

  frame.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-goto]");
    if (!button) {
      return;
    }
    var goto = button.getAttribute("data-goto");
    var trial = button.getAttribute("data-trial");
    if (trial) {
      currentTrial = trial;
    }
    if (goto === "1") {
      show("1", null);
    } else if (goto === "2") {
      show("2", currentTrial);
    } else if (goto === "3") {
      show("3", currentTrial);
    } else if (goto === "4") {
      show("4", null);
    } else if (goto === "5") {
      show("5", null);
    } else if (goto === "0") {
      currentTrial = null;
      show("0", null);
    }
  });
})();
