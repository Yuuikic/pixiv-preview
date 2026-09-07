(() => {
  "use strict";

  const settings = globalThis.PixivPreviewSettings;
  const i18n = globalThis.P2I18n;
  const t = i18n.t;
  const sync = globalThis.chrome?.storage?.sync;
  const local = globalThis.chrome?.storage?.local;
  const byId = (id) => document.getElementById(id);
  const delayRange = byId("delay-range");
  const delayNumber = byId("delay-number");
  const residueRange = byId("residue-range");
  const residueNumber = byId("residue-number");
  const occluded = byId("occluded-switch");
  const original = byId("original-upgrade");
  const autoArrange = byId("auto-arrange");
  const stickyShortcut = byId("sticky-shortcut");
  const nazurinShortcut = byId("nazurin-shortcut");
  const reset = byId("reset-button");
  const saveStatus = byId("save-status");
  const hostInput = byId("nazurin-host");
  const tokenInput = byId("nazurin-token");
  const httpWarning = byId("nazurin-http-warning");
  const nazurinSave = byId("nazurin-save");
  const nazurinTest = byId("nazurin-test");
  const nazurinClear = byId("nazurin-clear");
  const nazurinStatus = byId("nazurin-status");
  const verificationIndicator = byId("nazurin-verification-indicator");
  let savedHost = "";
  let statusTimer = 0;
  let nazurinStatusTimer = 0;
  let saveTimer = 0;
  let residueTimer = 0;
  let stickyCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
  let nazurinCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;

  i18n.localizeDocument();
  document.title = t("settingsTitle");
  const version = globalThis.chrome?.runtime?.getManifest?.().version;
  byId("extension-version").textContent = version ? `· v${version}` : "";
  byId("open-options")?.addEventListener("click", () => globalThis.chrome.runtime.openOptionsPage());

  for (const input of [delayRange, delayNumber]) {
    input.min = String(settings.MIN_HOVER_DELAY_MS);
    input.max = String(settings.MAX_HOVER_DELAY_MS);
    input.step = String(settings.HOVER_DELAY_STEP_MS);
  }
  for (const input of [residueRange, residueNumber]) {
    input.min = String(settings.MIN_HOVER_RESIDUE_MS);
    input.max = String(settings.MAX_HOVER_RESIDUE_MS);
    input.step = String(settings.HOVER_RESIDUE_STEP_MS);
  }

  function showStatus(key) {
    clearTimeout(statusTimer);
    saveStatus.textContent = t(key);
    statusTimer = window.setTimeout(() => { saveStatus.textContent = ""; }, 1600);
  }

  function showNazurin(message, tone = "success", persistent = false) {
    clearTimeout(nazurinStatusTimer);
    nazurinStatus.textContent = message;
    nazurinStatus.dataset.tone = tone;
    if (!persistent) nazurinStatusTimer = window.setTimeout(() => {
      nazurinStatus.textContent = "";
      delete nazurinStatus.dataset.tone;
    }, 3200);
  }

  function setVerified(value) {
    verificationIndicator.dataset.verified = String(value === true);
  }

  function setNazurinBusy(value) {
    for (const button of [nazurinSave, nazurinTest, nazurinClear]) button.disabled = value;
  }

  function displayDelay(value) {
    const normalized = settings.normalizeHoverDelay(value);
    delayRange.value = delayNumber.value = String(normalized);
    return normalized;
  }

  function displayResidue(value) {
    const normalized = settings.normalizeHoverResidue(value);
    residueRange.value = residueNumber.value = String(normalized);
    return normalized;
  }

  async function saveSync(values) {
    if (!sync) return showStatus("cannotSave");
    try { await sync.set(values); showStatus("saved"); }
    catch { showStatus("saveFailed"); }
  }

  function updateShortcutUi() {
    stickyShortcut.textContent = settings.shortcutCodeLabel(stickyCode);
    nazurinShortcut.textContent = settings.shortcutCodeLabel(nazurinCode);
  }

  function bindShortcut(button, type) {
    button.addEventListener("click", () => {
      document.querySelectorAll(".shortcut-key").forEach((element) => element.classList.remove("pfp-is-capturing"));
      button.classList.add("pfp-is-capturing");
      button.textContent = t("pressShortcut");
      button.focus();
    });
    button.addEventListener("keydown", async (event) => {
      if (!button.classList.contains("pfp-is-capturing")) return;
      event.preventDefault();
      event.stopPropagation();
      const fallback = type === "sticky" ? settings.DEFAULT_STICKY_SHORTCUT_CODE : settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
      const code = settings.normalizeShortcutCode(event.code, "");
      if (!code) return;
      const other = type === "sticky" ? nazurinCode : stickyCode;
      if (code === other) {
        showStatus("shortcutConflict");
        updateShortcutUi();
        button.classList.remove("pfp-is-capturing");
        return;
      }
      if (type === "sticky") stickyCode = code || fallback;
      else nazurinCode = code || fallback;
      button.classList.remove("pfp-is-capturing");
      updateShortcutUi();
      await saveSync({ [type === "sticky" ? settings.STICKY_SHORTCUT_STORAGE_KEY : settings.NAZURIN_SHORTCUT_STORAGE_KEY]: code });
    });
    button.addEventListener("blur", () => {
      button.classList.remove("pfp-is-capturing");
      updateShortcutUi();
    });
  }
  bindShortcut(stickyShortcut, "sticky");
  bindShortcut(nazurinShortcut, "nazurin");

  async function saveDelay(value) { await saveSync({ [settings.STORAGE_KEY]: displayDelay(value) }); }
  async function saveResidue(value) { await saveSync({ [settings.RESIDUE_STORAGE_KEY]: displayResidue(value) }); }
  delayRange.addEventListener("input", () => {
    delayNumber.value = delayRange.value;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveDelay(delayRange.value), 150);
  });
  delayRange.addEventListener("change", () => saveDelay(delayRange.value));
  delayNumber.addEventListener("change", () => saveDelay(delayNumber.value));
  delayNumber.addEventListener("keydown", (event) => { if (event.key === "Enter") delayNumber.blur(); });
  residueRange.addEventListener("input", () => {
    residueNumber.value = residueRange.value;
    clearTimeout(residueTimer);
    residueTimer = window.setTimeout(() => saveResidue(residueRange.value), 150);
  });
  residueRange.addEventListener("change", () => saveResidue(residueRange.value));
  residueNumber.addEventListener("change", () => saveResidue(residueNumber.value));
  residueNumber.addEventListener("keydown", (event) => { if (event.key === "Enter") residueNumber.blur(); });
  occluded.addEventListener("change", () => saveSync({ [settings.OCCLUDED_SWITCH_STORAGE_KEY]: settings.normalizeOccludedSwitch(occluded.checked) }));
  original.addEventListener("change", () => saveSync({ [settings.ORIGINAL_UPGRADE_STORAGE_KEY]: settings.normalizeOriginalUpgrade(original.checked) }));
  autoArrange.addEventListener("change", () => saveSync({
    [settings.AUTO_ARRANGE_STORAGE_KEY]: settings.normalizeAutoArrange(autoArrange.checked)
  }));

  function updateHttpWarning() {
    httpWarning.hidden = !settings.isInsecureRemoteNazurinHost(hostInput.value);
  }
  hostInput.addEventListener("input", updateHttpWarning);

  function validateNazurin() {
    const host = settings.normalizeNazurinApiHost(hostInput.value);
    const token = settings.normalizeNazurinApiToken(tokenInput.value);
    if (!host) { showNazurin(t("invalidHost"), "error", true); hostInput.focus(); return null; }
    if (!token) { showNazurin(t("invalidToken"), "error", true); tokenInput.focus(); return null; }
    return { host, token, permissionPattern: settings.getNazurinPermissionPattern(host) };
  }

  function nazurinResult(response) {
    if (response?.ok) return t("connectionSuccess");
    const key = {
      "not-configured": "notConfigured", "not-verified": "notVerified", "permission-missing": "permissionMissing",
      timeout: "timeout", "network-error": "networkError", "http-error": "httpError",
      "api-error": "apiError", "invalid-response": "invalidResponse"
    }[response?.status];
    return response?.message || t(key || "operationFailed");
  }

  nazurinSave.addEventListener("click", async () => {
    const config = validateNazurin();
    if (!config || !local || !globalThis.chrome?.permissions) return;
    const oldPattern = settings.getNazurinPermissionPattern(savedHost);
    setNazurinBusy(true);
    let saved = false;
    try {
      if (!await globalThis.chrome.permissions.request({ origins: [config.permissionPattern] })) {
        showNazurin(t("permissionDenied"), "error", true);
        return;
      }
      await local.set({
        [settings.NAZURIN_API_HOST_STORAGE_KEY]: config.host,
        [settings.NAZURIN_API_TOKEN_STORAGE_KEY]: config.token,
        [settings.NAZURIN_VERIFIED_STORAGE_KEY]: false
      });
      saved = true;
      savedHost = config.host;
      hostInput.value = config.host;
      setVerified(false);
      if (oldPattern && oldPattern !== config.permissionPattern) {
        try { await globalThis.chrome.permissions.remove({ origins: [oldPattern] }); }
        catch { showNazurin(t("configSavedOldPermissionFailed"), "warning", true); return; }
      }
      updateHttpWarning();
      showNazurin(t("configSavedNeedsTest"), "warning", true);
    } catch {
      if (!saved && oldPattern !== config.permissionPattern) {
        try { await globalThis.chrome.permissions.remove({ origins: [config.permissionPattern] }); } catch { /* best effort */ }
      }
      showNazurin(t("configSaveFailed"), "error", true);
    } finally { setNazurinBusy(false); }
  });

  nazurinTest.addEventListener("click", async () => {
    const current = validateNazurin();
    if (!current || !local) return;
    if (current.host !== savedHost) return showNazurin(t("hostChanged"), "warning", true);
    const saved = await local.get([settings.NAZURIN_API_TOKEN_STORAGE_KEY]).catch(() => ({}));
    if (current.token !== saved[settings.NAZURIN_API_TOKEN_STORAGE_KEY]) return showNazurin(t("tokenChanged"), "warning", true);
    setNazurinBusy(true);
    showNazurin(t("testing"), "warning", true);
    try {
      const response = await globalThis.chrome.runtime.sendMessage({ type: "pfp-nazurin-test", requestId: `test-${Date.now().toString(36)}` });
      if (response?.ok) {
        await local.set({ [settings.NAZURIN_VERIFIED_STORAGE_KEY]: true });
        setVerified(true);
      } else {
        await local.set({ [settings.NAZURIN_VERIFIED_STORAGE_KEY]: false });
        setVerified(false);
      }
      showNazurin(nazurinResult(response), response?.ok ? "success" : "error", !response?.ok);
    } catch {
      setVerified(false);
      showNazurin(t("backgroundUnavailable"), "error", true);
    } finally { setNazurinBusy(false); }
  });

  nazurinClear.addEventListener("click", async () => {
    if (!local) return;
    setNazurinBusy(true);
    const pattern = settings.getNazurinPermissionPattern(savedHost);
    try {
      await local.remove([settings.NAZURIN_API_HOST_STORAGE_KEY, settings.NAZURIN_API_TOKEN_STORAGE_KEY, settings.NAZURIN_VERIFIED_STORAGE_KEY]);
      if (pattern) await globalThis.chrome.permissions.remove({ origins: [pattern] });
      savedHost = "";
      hostInput.value = tokenInput.value = "";
      setVerified(false);
      updateHttpWarning();
      showNazurin(t("configCleared"));
    } catch { showNazurin(t("clearFailed"), "error", true); }
    finally { setNazurinBusy(false); }
  });

  reset.addEventListener("click", async () => {
    clearTimeout(saveTimer); clearTimeout(residueTimer);
    stickyCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
    nazurinCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
    displayDelay(settings.DEFAULT_HOVER_DELAY_MS);
    displayResidue(settings.DEFAULT_HOVER_RESIDUE_MS);
    occluded.checked = settings.DEFAULT_OCCLUDED_SWITCH_ENABLED;
    original.checked = settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED;
    autoArrange.checked = settings.DEFAULT_AUTO_ARRANGE_ENABLED;
    updateShortcutUi();
    if (!sync) return showStatus("cannotSave");
    try {
      await sync.set({
        [settings.STORAGE_KEY]: settings.DEFAULT_HOVER_DELAY_MS,
        [settings.RESIDUE_STORAGE_KEY]: settings.DEFAULT_HOVER_RESIDUE_MS,
        [settings.OCCLUDED_SWITCH_STORAGE_KEY]: settings.DEFAULT_OCCLUDED_SWITCH_ENABLED,
        [settings.ORIGINAL_UPGRADE_STORAGE_KEY]: settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED,
        [settings.AUTO_ARRANGE_STORAGE_KEY]: settings.DEFAULT_AUTO_ARRANGE_ENABLED,
        [settings.STICKY_SHORTCUT_STORAGE_KEY]: stickyCode,
        [settings.NAZURIN_SHORTCUT_STORAGE_KEY]: nazurinCode
      });
      showStatus("restored");
    } catch { showStatus("saveFailed"); }
  });

  (async () => {
    try {
      const stored = sync ? await sync.get({
        [settings.STORAGE_KEY]: settings.DEFAULT_HOVER_DELAY_MS,
        [settings.RESIDUE_STORAGE_KEY]: settings.DEFAULT_HOVER_RESIDUE_MS,
        [settings.OCCLUDED_SWITCH_STORAGE_KEY]: settings.DEFAULT_OCCLUDED_SWITCH_ENABLED,
        [settings.ORIGINAL_UPGRADE_STORAGE_KEY]: settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED,
        [settings.AUTO_ARRANGE_STORAGE_KEY]: settings.DEFAULT_AUTO_ARRANGE_ENABLED,
        [settings.STICKY_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_STICKY_SHORTCUT_CODE,
        [settings.NAZURIN_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_NAZURIN_SHORTCUT_CODE
      }) : {};
      displayDelay(stored[settings.STORAGE_KEY]);
      displayResidue(stored[settings.RESIDUE_STORAGE_KEY]);
      occluded.checked = settings.normalizeOccludedSwitch(stored[settings.OCCLUDED_SWITCH_STORAGE_KEY]);
      original.checked = settings.normalizeOriginalUpgrade(stored[settings.ORIGINAL_UPGRADE_STORAGE_KEY]);
      autoArrange.checked = settings.normalizeAutoArrange(stored[settings.AUTO_ARRANGE_STORAGE_KEY]);
      stickyCode = settings.normalizeShortcutCode(stored[settings.STICKY_SHORTCUT_STORAGE_KEY], settings.DEFAULT_STICKY_SHORTCUT_CODE);
      nazurinCode = settings.normalizeShortcutCode(stored[settings.NAZURIN_SHORTCUT_STORAGE_KEY], settings.DEFAULT_NAZURIN_SHORTCUT_CODE);
      if (stickyCode === nazurinCode) nazurinCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
      updateShortcutUi();
    } catch { showStatus("readFailed"); }
  })();

  (async () => {
    if (!local) { setNazurinBusy(true); return showNazurin(t("localStorageUnavailable"), "error", true); }
    try {
      const stored = await local.get({
        [settings.NAZURIN_API_HOST_STORAGE_KEY]: "",
        [settings.NAZURIN_API_TOKEN_STORAGE_KEY]: "",
        [settings.NAZURIN_VERIFIED_STORAGE_KEY]: false
      });
      savedHost = settings.normalizeNazurinApiHost(stored[settings.NAZURIN_API_HOST_STORAGE_KEY]) || "";
      hostInput.value = savedHost;
      tokenInput.value = stored[settings.NAZURIN_API_TOKEN_STORAGE_KEY] || "";
      setVerified(stored[settings.NAZURIN_VERIFIED_STORAGE_KEY] === true);
      updateHttpWarning();
    } catch { showNazurin(t("nazurinReadFailed"), "error", true); }
  })();
})();
