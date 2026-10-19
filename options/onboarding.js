(() => {
  "use strict";
  const { t } = globalThis.P2I18n;
  const local = chrome.storage.local;
  const byId = (id) => document.getElementById(id);
  const guide = byId("setup-guide");
  const controls = byId("setup-controls");
  const groups = [...document.querySelectorAll("[data-setup-section]")];
  const steps = [...document.querySelectorAll("[data-setup-step]")];
  const next = byId("setup-next");
  const back = byId("setup-back");
  const status = byId("setup-status");
  const swap = globalThis.P2SettingsMotion.create();
  let active = false;
  let step = 0;
  let writes = Promise.resolve();
  const save = (values) => {
    const operation = writes.then(() => local.set(values));
    writes = operation.catch(() => {});
    return operation;
  };
  function render(focus = false) {
    document.body.dataset.setupMode = active ? String(step) : "settings";
    guide.hidden = controls.hidden = !active;
    byId("settings-navigation").hidden = active;
    byId("settings-footer").hidden = active;
    for (const group of groups) group.hidden = active && Number(group.dataset.setupSection) !== step;
    for (const button of steps) {
      const selected = Number(button.dataset.setupStep) === step;
      if (selected) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
    }
    byId("setup-progress").textContent = t("setupProgress", { current: step + 1, total: groups.length });
    back.disabled = step === 0;
    next.textContent = t(step === groups.length - 1 ? "setupFinish" : "setupNext");
    if (active && step === 2) document.querySelector(".nazurin-settings").open = true;
    if (focus && active) {
      const heading = groups[step].querySelector("h2");
      heading.tabIndex = -1; heading.focus({ preventScroll: true });
      guide.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
  function selectStep(value) {
    return swap(() => groups.filter((group) => !group.hidden), () => {
      step = Math.max(0, Math.min(groups.length - 1, value));
      render(true);
      void save({ p2SetupStep: step }).catch(() => { status.textContent = t("setupSaveFailed"); });
    });
  }
  async function finish() {
    swap.cancel?.();
    next.disabled = true;
    try {
      await save({ p2SetupCompleted: true, p2SetupStep: 0, p2SetupRestartRequested: false });
      active = false; render();
      byId("settings-title").focus();
    } catch { status.textContent = t("setupSaveFailed"); }
    finally { next.disabled = false; }
  }
  function start() {
    swap.cancel?.();
    active = true; step = 0; status.textContent = ""; render(true);
    void save({ p2SetupCompleted: false, p2SetupStep: 0, p2SetupRestartRequested: false })
      .catch(() => { status.textContent = t("setupSaveFailed"); });
  }
  steps.forEach((button) => button.addEventListener("click", () => selectStep(Number(button.dataset.setupStep))));
  document.querySelectorAll(".nazurin-config-tip").forEach((tip) => tip.addEventListener("click", () => {
    if (active) selectStep(2);
  }));
  next.addEventListener("click", () => step === groups.length - 1 ? finish() : selectStep(step + 1));
  back.addEventListener("click", () => selectStep(step - 1));
  byId("setup-skip").addEventListener("click", finish);
  byId("restart-setup").addEventListener("click", start);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.p2SetupRestartRequested?.newValue === true) start();
  });
  void local.get(["p2SetupCompleted", "p2SetupStep", "p2SetupRestartRequested"]).then((stored) => {
    active = stored.p2SetupCompleted !== true || stored.p2SetupRestartRequested === true;
    step = stored.p2SetupRestartRequested ? 0 : Math.max(0, Math.min(groups.length - 1, Number(stored.p2SetupStep) || 0));
    render();
    if (stored.p2SetupRestartRequested) void save({ p2SetupRestartRequested: false });
  }).catch(() => { active = true; render(); status.textContent = t("setupSaveFailed"); });
})();
