(() => {
  "use strict";
  const { t } = globalThis.P2I18n;
  const sites = globalThis.P2NazurinSites;
  const DEFAULT_ORIGIN = "https://www.pixiv.net";
  const byId = (id) => document.getElementById(id);
  const status = byId("site-access-status");
  const list = byId("enabled-sites");
  const current = byId("current-site-access");
  const button = byId("enable-current-site");
  const grid = byId("site-access-grid");
  const allButton = byId("enable-all-sites");
  const pixivButton = byId("enable-pixiv");
  const optionalOrigins = sites.accessSites.flatMap((site) => site.origins);
  let currentOrigin = null;
  let enabled = [];
  let busy = false;
  const message = (text) => { status.textContent = text; };
  const send = (type, origin, requestId) => chrome.runtime.sendMessage({ type,
    ...(origin ? { origin } : {}), ...(requestId ? { requestId } : {}) });
  function render() {
    list.replaceChildren();
    if (!enabled.length) {
      const empty = document.createElement("p");
      empty.className = "hint"; empty.textContent = t("siteAccessEmpty"); list.append(empty);
    }
    for (const origin of enabled) {
      const row = document.createElement("div"); row.className = "site-access-row";
      const name = document.createElement("span"); name.textContent = new URL(origin).hostname;
      const disable = document.createElement("button"); disable.type = "button";
      disable.textContent = t("siteDisable"); disable.disabled = busy;
      disable.addEventListener("click", () => void disableSite(origin));
      row.append(name, disable); list.append(row);
    }
    current.hidden = document.body.dataset.settingsSurface !== "popup" || !currentOrigin;
    button.hidden = !currentOrigin;
    button.disabled = busy || !currentOrigin || enabled.includes(currentOrigin);
    button.textContent = t(enabled.includes(currentOrigin) ? "siteAlreadyEnabled" : "siteEnable");
    if (grid) {
      grid.replaceChildren();
      for (const site of sites.accessSites) {
        const count = site.origins.filter((origin) => enabled.includes(origin)).length;
        const granted = count === site.origins.length;
        const state = t(granted ? "siteGranted" : count ? "sitePartiallyGranted" : "siteNotGranted");
        const grant = document.createElement("button");
        grant.type = "button"; grant.className = "site-grant-button";
        grant.dataset.granted = String(granted);
        grant.setAttribute("aria-label", `${site.name}: ${state}`);
        grant.title = site.origins.join("\n"); grant.disabled = busy || granted;
        const name = document.createElement("strong"); name.textContent = site.name;
        const label = document.createElement("span"); label.textContent = state;
        grant.append(name, label);
        grant.addEventListener("click", () => enableSites(site.origins));
        grid.append(grant);
      }
    }
    if (allButton) allButton.disabled = busy || [DEFAULT_ORIGIN, ...optionalOrigins].every((origin) => enabled.includes(origin));
    if (pixivButton) {
      pixivButton.hidden = enabled.includes(DEFAULT_ORIGIN);
      pixivButton.disabled = busy;
    }
    const pixivStatus = byId("pixiv-access-status");
    if (pixivStatus) pixivStatus.textContent = t(enabled.includes(DEFAULT_ORIGIN) ? "pixivDefaultReady" : "pixivDefaultInactive");
  }
  async function refresh() {
    const result = await send("p2-site-list");
    if (!result?.ok || !Array.isArray(result.origins)) throw new Error("Could not read sites");
    enabled = result.origins;
    render();
  }
  async function enableSites(origins) {
    if (busy || !origins.length || origins.some((origin) => sites.scriptsForUrl(origin)?.origin !== origin)) return;
    const requested = [...new Set(origins)].filter((origin) => !enabled.includes(origin));
    if (!requested.length) return;
    busy = true; render();
    const requestId = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // Dispatch the durable intent before opening Chrome's prompt, without an
    // await that could lose the click's user activation. The worker completes
    // it on permissions.onAdded even if Chrome destroys this popup.
    const preparations = requested.map((origin) => send("p2-site-prepare", origin, requestId));
    const preparation = Promise.allSettled(preparations);
    try {
      const approval = chrome.permissions.request({ origins: requested.map((origin) => `${origin}/*`) });
      const granted = await approval;
      if (!granted) {
        await preparation;
        await Promise.all(requested.map((origin) => send("p2-site-cancel", origin, requestId)));
        message(t("sitePermissionDenied")); return;
      }
      const prepared = await preparation;
      if (prepared.some((result) => result.status !== "fulfilled" || !result.value?.ok)) throw new Error("Could not prepare sites");
      const results = await Promise.all(requested.map((origin) => send("p2-site-enable", origin)));
      if (results.some((result) => !result?.ok)) throw new Error("Could not enable sites");
      await refresh();
      message(t("siteEnabledRefresh"));
    } catch {
      // Keep an accepted grant available for retry; never revoke it merely
      // because this UI lost the response or the worker is temporarily busy.
      message(t("siteAccessFailed"));
    } finally { busy = false; render(); }
  }
  button.addEventListener("click", () => enableSites([currentOrigin]));
  allButton?.addEventListener("click", () => enableSites([DEFAULT_ORIGIN, ...optionalOrigins]));
  pixivButton?.addEventListener("click", () => enableSites([DEFAULT_ORIGIN]));
  async function disableSite(origin) {
    if (busy) return;
    busy = true; render();
    try {
      const result = await send("p2-site-disable", origin);
      if (!result?.ok) throw new Error("Could not disable site");
      enabled = result.origins;
      message(t(origin === DEFAULT_ORIGIN ? "pixivDisabled" : "siteDisabled"));
    } catch { message(t("siteAccessFailed")); }
    finally { busy = false; render(); }
  }
  async function initialize() {
    if (document.body.dataset.settingsSurface === "popup") {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentOrigin = sites.scriptsForUrl(tab?.url)?.origin || null;
        byId("current-site-name").textContent = currentOrigin ? new URL(currentOrigin).hostname : "";
      } catch { currentOrigin = null; }
    }
    try { await refresh(); } catch { message(t("siteAccessFailed")); render(); }
  }
  chrome.permissions.onAdded.addListener(() => { void refresh().catch(() => message(t("siteAccessFailed"))); });
  chrome.permissions.onRemoved.addListener(() => { void refresh().catch(() => message(t("siteAccessFailed"))); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.p2EnabledSiteOrigins) {
      enabled = Array.isArray(changes.p2EnabledSiteOrigins.newValue) ? changes.p2EnabledSiteOrigins.newValue : [];
      render();
    }
  });
  void initialize();
})();
