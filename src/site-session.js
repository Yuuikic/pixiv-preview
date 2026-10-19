(() => {
  "use strict";
  if (globalThis.P2SiteSession?.active) return;
  const cleanups = new Set();
  let active = true;
  const claims = new Set();
  function stop() {
    if (!active) return;
    active = false;
    for (const cleanup of Array.from(cleanups).reverse()) {
      try { cleanup(); } catch { /* Continue removing other listeners and UI. */ }
    }
    cleanups.clear();
  }
  function listen(target, type, callback, options) {
    const handler = (...args) => { if (active) callback(...args); };
    target.addEventListener(type, handler, options);
    cleanups.add(() => target.removeEventListener(type, handler, options));
  }
  function storageListener(callback) {
    const handler = (...args) => { if (active) callback(...args); };
    chrome.storage.onChanged.addListener(handler);
    cleanups.add(() => chrome.storage.onChanged.removeListener(handler));
  }
  const session = {
    get active() { return active; },
    claim(name) { if (!active || claims.has(name)) return false; claims.add(name); return true; },
    onStop(callback) { if (active) cleanups.add(callback); else callback(); return () => cleanups.delete(callback); },
    listen, storageListener, stop
  };
  globalThis.P2SiteSession = session;
  storageListener((changes, area) => {
    if (area === "local" && changes.p2EnabledSiteOrigins &&
        !changes.p2EnabledSiteOrigins.newValue?.includes(location.origin)) stop();
  });
  const verify = async () => {
    if (!active) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "p2-site-status" });
      if (!result?.enabled) stop();
    } catch {
      stop();
    }
  };
  const changed = (message) => { if (message?.type === "p2-site-access-changed") void verify(); };
  chrome.runtime.onMessage.addListener(changed);
  cleanups.add(() => chrome.runtime.onMessage.removeListener(changed));
  listen(window, "pageshow", verify);
  listen(window, "focus", verify);
  void verify();
})();
