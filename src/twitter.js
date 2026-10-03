(() => {
  "use strict";

  const settings = globalThis.PixivPreviewSettings;
  const { t } = globalThis.P2I18n;
  const tweetSelector = 'article[data-testid="tweet"]';
  let shortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
  let pointer = null;
  let active = true;
  let processing = false;
  let toast = null;
  let toastTimer = 0;
  const queue = [];
  const pending = new Set();

  function tweetUrlFromLink(link) {
    try {
      const url = new URL(link.href, location.href);
      if (url.protocol !== "https:" ||
          !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/i);
      return match ? `https://twitter.com/${match[1]}/status/${match[2]}` : null;
    } catch {
      return null;
    }
  }

  function hoveredTweetUrl() {
    if (!pointer) return null;
    // Resolve at keypress time: X can recycle timeline nodes or scroll under the pointer.
    const target = document.elementFromPoint(pointer.x, pointer.y);
    const article = target?.closest(tweetSelector);
    if (!article) return null;
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter((link) =>
      link.closest(tweetSelector) === article &&
      !link.closest('[data-testid="tweetText"], [data-testid="quoteTweet"]') &&
      !link.parentElement?.closest('[role="link"]'));
    // The timestamp belongs to the outer tweet, even when hovering a quote or retweet.
    const permalink = links.find((link) => link.querySelector("time") && tweetUrlFromLink(link));
    return permalink ? tweetUrlFromLink(permalink) :
      links.map(tweetUrlFromLink).find(Boolean) || null;
  }

  function currentPhotoTweetUrl() {
    // Read on every keypress: opening, switching, and closing X's photo viewer
    // changes the URL without reloading this content script.
    const url = new URL(location.href);
    if (!/^\/[a-z0-9_]{1,15}\/status\/\d+\/photo\/\d+\/?$/i.test(url.pathname)) return null;
    return tweetUrlFromLink({ href: url.href });
  }

  function showToast(message, tone = "neutral") {
    clearTimeout(toastTimer);
    toast?.remove();
    toast = document.createElement("div");
    toast.className = "p2-twitter-toast";
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
      // Updating/unloading the extension invalidates this tab's runtime.
      active = false;
      queue.length = 0;
      return { ok: false, status: "background-unavailable" };
    }
  }

  function failureMessage(response) {
    const keys = {
      "not-configured": "nazurinNotConfigured", "not-verified": "nazurinNotVerified",
      "permission-missing": "nazurinPermissionMissing", timeout: "nazurinTimeout",
      "network-error": "nazurinNetworkError", "http-error": "nazurinHttpError",
      "api-error": "apiError", "invalid-response": "nazurinInvalidResponse",
      "background-unavailable": "backgroundUnavailable"
    };
    return response?.message || t(keys[response?.status] || "nazurinSubmitFailed");
  }

  async function processQueue() {
    processing = true;
    while (active && queue.length) {
      const tweetUrl = queue.shift();
      showToast(t("nazurinSending"));
      const response = await send({
        type: "pfp-nazurin-twitter-submit", tweetUrl,
        requestId: `tw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      });
      pending.delete(tweetUrl);
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
    processing = false;
  }

  document.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
  document.addEventListener("pointerover", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) pointer = null;
  }, true);
  window.addEventListener("blur", () => { pointer = null; });
  window.addEventListener("pagehide", () => {
    active = false;
    pointer = null;
    queue.length = 0;
    pending.clear();
  });
  window.addEventListener("pageshow", () => { active = true; });

  document.addEventListener("keydown", (event) => {
    if (!active || event.defaultPrevented || event.code !== shortcutCode || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    if ([event.target, document.activeElement].some((element) =>
      element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) return;
    const tweetUrl = currentPhotoTweetUrl() || hoveredTweetUrl();
    if (!tweetUrl) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending.has(tweetUrl)) {
      showToast(t("tweetAlreadyQueued"));
      return;
    }
    pending.add(tweetUrl);
    queue.push(tweetUrl);
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
})();
