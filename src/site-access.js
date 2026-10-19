(() => {
  "use strict";
  const KEY = "p2EnabledSiteOrigins";
  const PENDING_KEY = "p2PendingSiteRequests";
  const INITIALIZED_KEY = "p2SiteDefaultsInitialized";
  const DEFAULT_ORIGIN = "https://www.pixiv.net";
  const REQUEST_LIFETIME_MS = 2 * 60 * 1000;
  const PREFIX = "p2-site-";
  const sites = globalThis.P2NazurinSites;
  let pending = Promise.resolve();
  const serial = (job) => {
    const result = pending.then(job);
    pending = result.catch(() => {});
    return result;
  };
  const idFor = (origin) => PREFIX + Array.from(origin, (character) => character.charCodeAt(0).toString(16)).join("-");
  function originFor(value) { return sites.scriptsForUrl(value)?.origin || null; }
  async function enabledOrigins() {
    const stored = await chrome.storage.local.get(KEY);
    return [...new Set(Array.isArray(stored[KEY]) ? stored[KEY].filter((value) => originFor(value) === value) : [])];
  }
  async function isEnabled(value) {
    const origin = originFor(value);
    return Boolean(origin && (await enabledOrigins()).includes(origin) &&
      await chrome.permissions.contains({ origins: [`${origin}/*`] }));
  }
  function validRequests(value) {
    return Array.isArray(value) ? value.filter((entry) => entry && originFor(entry.origin) === entry.origin &&
      typeof entry.id === "string" && /^[a-z0-9-]{1,80}$/i.test(entry.id) &&
      Number.isFinite(entry.createdAt) && Date.now() - entry.createdAt >= 0 &&
      Date.now() - entry.createdAt < REQUEST_LIFETIME_MS) : [];
  }
  async function reconcile() {
    const stored = await chrome.storage.local.get([KEY, PENDING_KEY, INITIALIZED_KEY]);
    const previous = await enabledOrigins();
    const removedOrigins = (Array.isArray(stored[KEY]) ? stored[KEY] : []).filter((value) => !originFor(value));
    const requests = validRequests(stored[PENDING_KEY]);
    const desired = [...new Set([...previous,
      ...(stored[INITIALIZED_KEY] === true ? [] : [DEFAULT_ORIGIN]), ...requests.map((entry) => entry.origin)])];
    const enabled = [];
    for (const origin of desired) {
      if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) enabled.push(origin);
    }
    const wanted = enabled.map((origin) => ({ id: idFor(origin), ...sites.scriptsForUrl(origin) }));
    for (const script of wanted) delete script.origin;
    const registered = (await chrome.scripting.getRegisteredContentScripts()).filter((entry) => entry.id.startsWith(PREFIX));
    const stale = registered.filter((entry) => !wanted.some((script) => script.id === entry.id));
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale.map((entry) => entry.id) });
    for (const script of wanted) {
      const old = registered.find((entry) => entry.id === script.id);
      if (!old) await chrome.scripting.registerContentScripts([script]);
      else if (["matches", "js", "css", "runAt", "allFrames", "persistAcrossSessions"].some((key) =>
        JSON.stringify(old[key]) !== JSON.stringify(script[key]))) await chrome.scripting.updateContentScripts([script]);
    }
    // Commit only after registration succeeds. A permissions.onAdded event or a
    // worker restart can finish a persisted request even after its popup closes.
    const remaining = requests.filter((entry) => !enabled.includes(entry.origin));
    const changes = {};
    if (JSON.stringify(stored[KEY] || []) !== JSON.stringify(enabled)) changes[KEY] = enabled;
    if (JSON.stringify(stored[PENDING_KEY] || []) !== JSON.stringify(remaining)) changes[PENDING_KEY] = remaining;
    if (stored[INITIALIZED_KEY] !== true) changes[INITIALIZED_KEY] = true;
    if (Object.keys(changes).length) await chrome.storage.local.set(changes);
    const sharedServer = await serverOrigin();
    for (const origin of removedOrigins) {
      try {
        const url = new URL(origin);
        if (url.protocol === "https:" && url.origin === origin && origin !== sharedServer && origin !== DEFAULT_ORIGIN) {
          await chrome.permissions.remove({ origins: [`${origin}/*`] });
        }
      } catch { /* Ignore malformed old storage values. */ }
    }
    return enabled;
  }
  function prepareRequest(origin, id) {
    return serial(async () => {
      if (originFor(origin) !== origin || typeof id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error("Invalid site request");
      const stored = await chrome.storage.local.get(PENDING_KEY);
      const requests = validRequests(stored[PENDING_KEY]).filter((entry) => entry.origin !== origin);
      requests.push({ origin, id, createdAt: Date.now() });
      await chrome.storage.local.set({ [PENDING_KEY]: requests });
      // Handles the inverse race: Chrome granted access before this message
      // reached the worker. Never infer opt-in from a grant without a request.
      return { ok: true, origins: await reconcile() };
    });
  }
  function cancelRequest(origin, id) {
    return serial(async () => {
      const stored = await chrome.storage.local.get(PENDING_KEY);
      await chrome.storage.local.set({ [PENDING_KEY]: validRequests(stored[PENDING_KEY])
        .filter((entry) => entry.origin !== origin || entry.id !== id) });
      return { ok: true };
    });
  }
  async function serverOrigin() {
    const key = globalThis.PixivPreviewSettings.NAZURIN_API_HOST_STORAGE_KEY;
    const stored = await chrome.storage.local.get(key);
    try { return new URL(stored[key]).origin; } catch { return null; }
  }
  function setEnabled(value, enabled) {
    return serial(async () => {
      const origin = originFor(value);
      if (!origin || value !== origin) throw new Error("Unsupported site origin");
      const previous = await enabledOrigins();
      if (enabled && !await chrome.permissions.contains({ origins: [`${origin}/*`] })) throw new Error("Site permission missing");
      const stored = await chrome.storage.local.get(PENDING_KEY);
      const next = enabled ? [...new Set([...previous, origin])] : previous.filter((entry) => entry !== origin);
      await chrome.storage.local.set({ [KEY]: next, [INITIALIZED_KEY]: true,
        [PENDING_KEY]: validRequests(stored[PENDING_KEY]).filter((entry) => entry.origin !== origin) });
      try { await reconcile(); }
      catch (error) {
        await chrome.storage.local.set({ [KEY]: previous });
        await reconcile().catch(() => {});
        throw error;
      }
      // Pixiv is required at install time. Disabling its page features cannot
      // revoke that manifest grant. Optional server/site shared grants stay too.
      if (!enabled && origin !== DEFAULT_ORIGIN && origin !== await serverOrigin()) {
        await chrome.permissions.remove({ origins: [`${origin}/*`] });
      }
      return { ok: true, origins: await enabledOrigins() };
    });
  }
  function sync() { return serial(reconcile); }
  async function list() { return { ok: true, origins: await sync() }; }
  globalThis.P2SiteAccess = Object.freeze({ KEY, PENDING_KEY, DEFAULT_ORIGIN, originFor, isEnabled,
    enabledOrigins, prepareRequest, cancelRequest, setEnabled, sync, list });
})();
