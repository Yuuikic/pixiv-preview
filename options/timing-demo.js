(() => {
  "use strict";
  const settings = globalThis.PixivPreviewSettings;
  const { t } = globalThis.P2I18n;
  const byId = (id) => document.getElementById(id);
  const demo = byId("timing-demo");
  const target = byId("timing-demo-target");
  const hint = byId("timing-demo-hint");
  const wide = window.matchMedia("(min-width: 1280px)");
  const swapHint = globalThis.P2SettingsMotion.create();
  const logo = new URL("../assets/icon.png", document.baseURI).href;
  const thumbnail = new URL("../assets/icon-128.png", document.baseURI).href;
  const work = { key: "settings:logo", id: "logo", url: logo };
  let mode = document.body.dataset.setupMode || "0";
  let stickyCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
  let hintText = hint.textContent;
  const available = () => wide.matches && mode !== "2" && !document.hidden;
  const readShortcut = () => {
    const key = byId("sticky-shortcut").textContent.trim();
    if (/^[A-Z0-9]$/.test(key)) stickyCode = /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key}`;
    return stickyCode;
  };
  const readSettings = () => ({
    [settings.STORAGE_KEY]: byId("delay-number").value,
    [settings.RESIDUE_STORAGE_KEY]: byId("residue-number").value,
    [settings.STICKY_SHORTCUT_STORAGE_KEY]: readShortcut(),
    [settings.AUTO_ARRANGE_STORAGE_KEY]: byId("auto-arrange").checked
  });
  const manager = globalThis.P2PreviewCore.start({
    id: "settings-demo", anchorSelector: "#timing-demo-target", toolbar: false,
    copyLink: false, nazurin: false, readSettings,
    canPreview: available, canPin: () => available() && mode !== "0",
    workFromAnchor: (anchor) => anchor === target && available() ? work : null,
    safeImageUrl: (url) => url === logo || url === thumbnail ? url : null,
    load: async () => ({ pages: [{ regular: logo, width: 240, height: 240 }] })
  });
  if (!manager) return;
  const close = () => manager.closeAll({ cancelNazurin: true });
  function updateHint(initial = false) {
    const text = mode === "1" ? t("timingDemoStickyHint", { key: settings.shortcutCodeLabel(readShortcut()) }) : t("timingDemoHint");
    if (text === hintText) return;
    hintText = text;
    if (initial) hint.textContent = text;
    else void swapHint(() => [hint], () => { hint.textContent = text; });
  }
  function updateMode(initial = false) {
    const nextMode = document.body.dataset.setupMode || "0";
    if (!initial && nextMode === mode) return;
    mode = nextMode;
    demo.hidden = mode === "2";
    manager.pageActive = available();
    close();
    updateHint(initial);
  }
  new MutationObserver(() => updateMode()).observe(document.body, { attributes: true, attributeFilter: ["data-setup-mode"] });
  new MutationObserver(() => updateHint()).observe(byId("sticky-shortcut"), { childList: true, characterData: true, subtree: true });
  wide.addEventListener("change", () => { manager.pageActive = available(); close(); });
  target.addEventListener("focus", () => {
    if (!available() || !target.matches(":focus-visible")) return;
    const image = target.querySelector("img");
    const rect = image.getBoundingClientRect();
    manager.pointerX = rect.right; manager.pointerY = rect.top;
    manager.beginHover({ anchor: target, image, work, workKey: work.key });
  });
  target.addEventListener("blur", () => manager.scheduleHoverClose(manager.hoverWindow));
  for (const id of ["delay-number", "delay-range", "residue-number", "residue-range"]) {
    byId(id).addEventListener("input", close);
    byId(id).addEventListener("change", close);
  }
  byId("reset-button").addEventListener("click", close);
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
  updateMode(true);
})();
