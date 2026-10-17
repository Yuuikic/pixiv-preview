(() => {
  "use strict";

  const settings = globalThis.PixivPreviewSettings;
  const { t } = globalThis.P2I18n;
  globalThis.P2LinkSubmit = ({
    resolveTarget, createMessage, duplicateKey, getTargetKey = (target) => target,
    requireTrustedEvents = false
  }) => {
    let shortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
    let pointer = null;
    let active = true;
    let processing = false;
    let revision = 0;
    let runtimeValid = true;
    let toast = null;
    let toastTimer = 0;
    const queue = [];
    const pending = new Set();

    function deactivate() {
      active = false;
      revision += 1;
      processing = false;
      pointer = null;
      queue.length = 0;
      pending.clear();
      clearTimeout(toastTimer);
      toast?.remove();
      toast = null;
    }

    function showToast(message, tone = "neutral") {
      clearTimeout(toastTimer);
      toast?.remove();
      toast = document.createElement("div");
      toast.className = "p2-link-submit-toast";
      toast.dataset.tone = tone;
      toast.textContent = message;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.documentElement.append(toast);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; }, 3600);
    }

    async function send(message) {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch {
        return { ok: false, status: "background-unavailable" };
      }
    }

    function failureMessage(response) {
      const keys = {
        "not-configured": "nazurinNotConfigured", "not-verified": "nazurinNotVerified",
        "permission-missing": "nazurinPermissionMissing", timeout: "nazurinTimeout",
        "network-error": "nazurinNetworkError", "http-error": "nazurinHttpError",
        "api-error": "apiError", "invalid-response": "nazurinInvalidResponse",
        "background-unavailable": "backgroundUnavailable",
        "unsupported-url": "nazurinUnsupportedUrl",
        "konachan-conversion-disabled": "konachanConversionDisabled"
      };
      return response?.message || t(keys[response?.status] || "nazurinSubmitFailed");
    }

    async function processQueue() {
      const currentRevision = revision;
      processing = true;
      while (active && currentRevision === revision && queue.length) {
        const { target, key } = queue.shift();
        showToast(t("nazurinSending"));
        const response = await send({
          ...createMessage(target),
          requestId: `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        });
        // An old page/BFCache generation must not mutate a restored page's queue.
        if (!active || currentRevision !== revision) break;
        if (response?.status === "background-unavailable") {
          // Updating/unloading the extension invalidates this tab's runtime.
          runtimeValid = false;
          deactivate();
          showToast(t("backgroundUnavailable"), "error");
          return;
        }
        pending.delete(key);
        showToast(response?.ok ? t("submissionSuccess") : failureMessage(response),
          response?.ok ? "success" : "error");
        if (["not-configured", "not-verified", "permission-missing", "background-unavailable"].includes(response?.status)) {
          queue.length = 0;
          pending.clear();
          break;
        }
        // Keep rapid submissions serialized and give the service time between requests.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (currentRevision === revision) processing = false;
    }

    document.addEventListener("pointermove", (event) => {
      if (requireTrustedEvents && !event.isTrusted) return;
      pointer = { x: event.clientX, y: event.clientY };
    }, { capture: true, passive: true });
    document.addEventListener("pointerover", (event) => {
      if (requireTrustedEvents && !event.isTrusted) return;
      pointer = { x: event.clientX, y: event.clientY };
    }, { capture: true, passive: true });
    document.addEventListener("pointerout", (event) => {
      if (requireTrustedEvents && !event.isTrusted) return;
      if (!event.relatedTarget) pointer = null;
    }, true);
    window.addEventListener("blur", () => { pointer = null; });
    window.addEventListener("pagehide", deactivate);
    window.addEventListener("pageshow", () => { active = runtimeValid; });

    document.addEventListener("keydown", (event) => {
      if (requireTrustedEvents && !event.isTrusted) return;
      if (!active || event.defaultPrevented || event.code !== shortcutCode || event.repeat ||
          event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
      if ([event.target, document.activeElement].some((element) =>
        element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) return;
      const target = resolveTarget(pointer);
      if (!target) return;
      const key = getTargetKey(target);
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending.has(key)) {
        showToast(t(duplicateKey));
        return;
      }
      pending.add(key);
      queue.push({ target, key });
      showToast(t("nazurinQueued"));
      if (!processing) void processQueue();
    }, true);

    // Read only the shortcut here. Host and Token remain in the background script.
    let shortcutRevision = 0;
    const initialRevision = shortcutRevision;
    chrome.storage.sync.get({
      [settings.NAZURIN_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_NAZURIN_SHORTCUT_CODE
    }).then((stored) => {
      if (shortcutRevision === initialRevision) shortcutCode = settings.normalizeShortcutCode(
        stored[settings.NAZURIN_SHORTCUT_STORAGE_KEY], settings.DEFAULT_NAZURIN_SHORTCUT_CODE);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY]) {
        shortcutRevision += 1;
        shortcutCode = settings.normalizeShortcutCode(
          changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY].newValue, settings.DEFAULT_NAZURIN_SHORTCUT_CODE);
      }
    });
  };
})();
