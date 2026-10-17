(() => {
  "use strict";

  const sites = globalThis.P2NazurinSites;
  const settings = globalThis.PixivPreviewSettings;
  if (!sites.isGenericSourceUrl(location.href)) return;

  let ready = false;
  let visible = true;
  let revision = 0;
  let retryTimer = 0;

  function refreshReady() {
    const currentRevision = ++revision;
    clearTimeout(retryTimer);
    ready = false;

    async function query(attempt = 0) {
      if (!visible || currentRevision !== revision) return;
      try {
        const status = await chrome.runtime.sendMessage({ type: "pfp-nazurin-status" });
        if (!visible || currentRevision !== revision) return;
        if (typeof status?.configured !== "boolean" || typeof status?.verified !== "boolean") {
          throw new Error("Invalid Nazurin status");
        }
        ready = status.configured && status.verified;
        return;
      } catch {
        if (visible && currentRevision === revision && attempt < 3) {
          retryTimer = setTimeout(() => void query(attempt + 1), (attempt + 1) * 500);
        }
      }
    }
    void query();
  }

  globalThis.P2LinkSubmit({
    resolveTarget(pointer) {
      if (!ready || !sites.isGenericSourceUrl(location.href)) return null;
      // Like X's photo viewer, a recognized detail page owns the shortcut.
      // This also works over an unlinked main <img> or empty page space.
      const current = sites.currentWorkUrl(location.href);
      if (current) return current;
      const link = pointer && document.elementFromPoint(pointer.x, pointer.y)?.closest("a[href]");
      return (link && sites.targetUrl(link.href)) || null;
    },
    createMessage: (url) => ({ type: "pfp-nazurin-link-submit", url }),
    getTargetKey: (url) => sites.normalizeTargetUrl(url),
    requireTrustedEvents: true,
    duplicateKey: "linkAlreadyQueued"
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && [
      settings.NAZURIN_API_HOST_STORAGE_KEY, settings.NAZURIN_API_TOKEN_STORAGE_KEY,
      settings.NAZURIN_VERIFIED_STORAGE_KEY
    ].some((key) => Object.hasOwn(changes, key))) refreshReady();
  });
  window.addEventListener("pagehide", () => {
    visible = false;
    ready = false;
    revision += 1;
    clearTimeout(retryTimer);
  });
  window.addEventListener("pageshow", () => { visible = true; refreshReady(); });
  window.addEventListener("focus", refreshReady);
  refreshReady();
})();
