(() => {
  "use strict";
  // Each caller owns a transition, so rapid navigation cannot apply stale content.
  function create() {
    let revision = 0;
    let animations = [];
    const swap = async (elements, change) => {
      const current = ++revision;
      for (const animation of animations) animation.cancel();
      animations = [];
      const before = elements().filter(Boolean);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
          before.some((element) => typeof element.animate !== "function")) {
        change(); return;
      }
      animations = before.map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 110, easing: "ease", fill: "forwards" }));
      await Promise.allSettled(animations.map((animation) => animation.finished));
      if (current !== revision) return;
      change();
      for (const animation of animations) animation.cancel();
      animations = elements().filter(Boolean).map((element) => element.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 160, easing: "ease" }));
      await Promise.allSettled(animations.map((animation) => animation.finished));
      if (current === revision) animations = [];
    };
    swap.cancel = () => {
      revision += 1;
      for (const animation of animations) animation.cancel();
      animations = [];
    };
    return swap;
  }
  globalThis.P2SettingsMotion = Object.freeze({ create });
})();
