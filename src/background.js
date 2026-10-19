"use strict";

importScripts("settings.js", "nazurin-sites.js", "site-access.js");

const settings = globalThis.PixivPreviewSettings;
const sites = globalThis.P2NazurinSites;
const siteAccess = globalThis.P2SiteAccess;
const activePageRequests = new Map();
const activeNazurinRequests = new Map();
const UPGRADE_GUIDE_SHOWN_KEY = "p2V120GuideShown";

function compareVersions(left, right) {
  if (typeof left !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(left)) return NaN;
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const version = chrome.runtime.getManifest().version;
  // Cover users who skip 1.2.0 and update straight from a legacy release later.
  const upgradingFromLegacy = details.reason === "update" &&
    compareVersions(details.previousVersion, "1.1.1") <= 0 && compareVersions(version, "1.2.0") >= 0;
  if (details.reason !== "install" && !upgradingFromLegacy) return;
  try {
    if (upgradingFromLegacy) {
      const stored = await chrome.storage.local.get(UPGRADE_GUIDE_SHOWN_KEY);
      if (stored[UPGRADE_GUIDE_SHOWN_KEY] === true) return;
      // Reuse the guide's restart flag without changing preferences or credentials.
      await chrome.storage.local.set({ p2SetupRestartRequested: true });
    }
    await chrome.runtime.openOptionsPage();
    // Record opening, not completion: closing or skipping must not cause another
    // automatic tab on a later upgrade. Failed opens remain retryable.
    if (compareVersions(version, "1.2.0") >= 0) {
      await chrome.storage.local.set({ [UPGRADE_GUIDE_SHOWN_KEY]: true });
    }
  } catch (error) {
    console.error("P2 setup could not be opened", error);
  }
});

// Dynamic registrations persist across browser restarts; reconcile on worker
// startup, updates and permission changes. Optional grants require persisted opt-in.
const syncSiteAccess = () => siteAccess.sync().catch((error) => console.error("P2 site registration failed", error));
if (chrome.scripting) {
  void syncSiteAccess();
  chrome.runtime.onStartup?.addListener(syncSiteAccess);
  chrome.runtime.onInstalled.addListener(syncSiteAccess);
  chrome.permissions.onAdded.addListener(syncSiteAccess);
  chrome.permissions.onRemoved.addListener(() => {
    // Cancel in-flight work whose source was revoked, before broadcasting stop.
    for (const registry of [activePageRequests, activeNazurinRequests]) {
      for (const controller of registry.values()) {
        if (controller.sourceUrl) void siteAccess.isEnabled(controller.sourceUrl).then((enabled) => { if (!enabled) controller.abort(); });
      }
    }
    void syncSiteAccess().then(async () => {
      // Tab IDs are available without the broad tabs permission. This message
      // makes already-injected sessions recheck access and dispose themselves.
      for (const tab of await chrome.tabs.query({})) {
        chrome.tabs.sendMessage(tab.id, { type: "p2-site-access-changed" }).catch(() => {});
      }
    }).catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;
  if (["p2-site-prepare", "p2-site-cancel", "p2-site-enable", "p2-site-disable", "p2-site-list"].includes(message.type)) {
    if (!isTrustedExtensionSender(sender)) return undefined;
    const task = message.type === "p2-site-prepare" ? siteAccess.prepareRequest(message.origin, message.requestId) :
      message.type === "p2-site-cancel" ? siteAccess.cancelRequest(message.origin, message.requestId) :
      message.type === "p2-site-list" ? siteAccess.list() :
      siteAccess.setEnabled(message.origin, message.type === "p2-site-enable");
    task.then((result) => {
      if (message.type === "p2-site-disable") abortSiteRequests(message.origin);
      sendResponse(result);
    }, () => sendResponse({ ok: false, status: "site-access-failed" }));
    return true;
  }
  if (message.type === "pfp-nazurin-test") return handleMessage(message, sender, sendResponse);
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sites.scriptsForUrl(sender.url)) return undefined;
  if (message.type === "p2-site-status") {
    siteAccess.isEnabled(sender.url).then((enabled) => sendResponse({ enabled }), () => sendResponse({ enabled: false }));
    return true;
  }
  if (!["pfp-nazurin-link-submit", "pfp-nazurin-status", "pfp-nazurin-twitter-submit", "pfp-cancel-pages",
    "pfp-cancel-nazurin", "pfp-nazurin-submit", "pfp-get-pages"].includes(message.type)) return undefined;
  const pixiv = isTrustedPixivSender(sender);
  const twitter = isTrustedTwitterSender(sender);
  const pixivision = isTrustedPixivisionSender(sender);
  const board = sites.isBoardSourceUrl(sender.url);
  const allowed = message.type === "pfp-nazurin-status" ||
    (message.type === "pfp-nazurin-link-submit" && board) ||
    (message.type === "pfp-nazurin-twitter-submit" && twitter) ||
    (message.type === "pfp-nazurin-submit" && (pixiv || pixivision)) ||
    (["pfp-get-pages", "pfp-cancel-pages"].includes(message.type) && pixiv) ||
    (message.type === "pfp-cancel-nazurin" && (pixiv || twitter || pixivision || board));
  if (!allowed) return undefined;
  // Authorize each message as well as script injection. An old content script
  // must lose access immediately when a site is disabled or its grant revoked.
  siteAccess.isEnabled(sender.url).then((enabled) => {
    if (!enabled) {
      sendResponse(message.type === "pfp-nazurin-status" ? { configured: false, verified: false } : nazurinFailure("permission-missing"));
    } else if (handleMessage(message, sender, sendResponse) === undefined) sendResponse(undefined);
  }).catch(() => sendResponse(nazurinFailure("permission-missing")));
  return true;
});

function handleMessage(message, sender, sendResponse) {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "pfp-nazurin-test") {
    if (!isTrustedExtensionSender(sender)) return undefined;
    handleNazurinRequest({ requestId: message.requestId, testOnly: true }, sendResponse);
    return true;
  }

  const pixivSender = isTrustedPixivSender(sender);
  const twitterSender = isTrustedTwitterSender(sender);
  const pixivisionSender = isTrustedPixivisionSender(sender);
  const boardSender = sender.id === chrome.runtime.id && sender.frameId === 0 &&
    sites.isBoardSourceUrl(sender.url);

  if (message.type === "pfp-nazurin-link-submit") {
    if (!boardSender) return undefined;
    handleNazurinRequest({
      sourceUrl: sender.url, linkUrl: message.url, requestId: message.requestId, testOnly: false, boardLink: true
    }, sendResponse);
    return true;
  }

  if (message.type === "pfp-nazurin-status" && boardSender) {
    getNazurinStatus().then(sendResponse, () => sendResponse({ configured: false, verified: false }));
    return true;
  }
  if (message.type === "pfp-cancel-nazurin" && boardSender) {
    cancelRequest(activeNazurinRequests, message.requestId);
    return undefined;
  }
  if (!pixivSender && !twitterSender && !pixivisionSender) return undefined;

  if (message.type === "pfp-nazurin-twitter-submit") {
    if (!twitterSender) return undefined;
    handleNazurinRequest({
      sourceUrl: sender.url,
      tweetUrl: message.tweetUrl,
      requestId: message.requestId,
      testOnly: false
    }, sendResponse);
    return true;
  }

  if (message.type === "pfp-nazurin-status") {
    getNazurinStatus().then(sendResponse, () => sendResponse({ configured: false, verified: false }));
    return true;
  }

  if (message.type === "pfp-cancel-pages") {
    if (!pixivSender) return undefined;
    cancelRequest(activePageRequests, message.requestId);
    return undefined;
  }

  if (message.type === "pfp-cancel-nazurin") {
    cancelRequest(activeNazurinRequests, message.requestId);
    return undefined;
  }

  if (message.type === "pfp-nazurin-submit") {
    if (!pixivSender && !pixivisionSender) return undefined;
    handleNazurinRequest({
      sourceUrl: sender.url,
      illustId: message.illustId,
      requestId: message.requestId,
      testOnly: false
    }, sendResponse);
    return true;
  }

  if (!pixivSender || message.type !== "pfp-get-pages") return undefined;

  const illustId = normalizeIllustId(message.illustId);
  const requestId = normalizeRequestId(message.requestId);
  if (!illustId || !requestId) {
    sendResponse({ ok: false, error: "invalid-request" });
    return undefined;
  }

  const controller = new AbortController();
  controller.sourceUrl = sender.url;
  activePageRequests.set(requestId, controller);
  fetchPages(illustId, controller.signal)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.name === "AbortError" ? "aborted" : "request-failed"
      });
    })
    .finally(() => deleteIfCurrent(activePageRequests, requestId, controller));

  return true;
}

async function handleNazurinRequest({ sourceUrl, illustId, tweetUrl, linkUrl, requestId, testOnly, boardLink = false }, sendResponse) {
  const normalizedRequestId = normalizeRequestId(requestId);
  const artworkUrl = testOnly ? null : boardLink ? sites.targetUrl(linkUrl) : tweetUrl !== undefined
    ? normalizeTweetUrl(tweetUrl)
    : normalizeIllustId(illustId) && `https://www.pixiv.net/artworks/${illustId}`;
  if (!normalizedRequestId || (!testOnly && !artworkUrl)) {
    sendResponse(nazurinFailure(boardLink && normalizedRequestId ? "unsupported-url" : "invalid-response"));
    return;
  }

  const controller = new AbortController();
  controller.sourceUrl = sourceUrl;
  activeNazurinRequests.set(normalizedRequestId, controller);
  try {
    sendResponse(await performNazurinRequest({
      artworkUrl,
      sourceUrl,
      testOnly,
      signal: controller.signal
    }));
  } catch {
    sendResponse(nazurinFailure("network-error"));
  } finally {
    deleteIfCurrent(activeNazurinRequests, normalizedRequestId, controller);
  }
}

async function performNazurinRequest({ artworkUrl, sourceUrl, testOnly, signal }) {
  const stored = await chrome.storage.local.get([
    settings.NAZURIN_API_HOST_STORAGE_KEY,
    settings.NAZURIN_API_TOKEN_STORAGE_KEY,
    settings.NAZURIN_VERIFIED_STORAGE_KEY
  ]);
  const host = settings.normalizeNazurinApiHost(stored[settings.NAZURIN_API_HOST_STORAGE_KEY]);
  const token = settings.normalizeNazurinApiToken(stored[settings.NAZURIN_API_TOKEN_STORAGE_KEY]);
  const endpoint = settings.buildNazurinApiEndpoint(host, token);
  const permissionPattern = settings.getNazurinPermissionPattern(host);
  if (!endpoint || !permissionPattern) return nazurinFailure("not-configured");

  const permitted = await chrome.permissions.contains({ origins: [permissionPattern] });
  if (!permitted) return nazurinFailure("permission-missing");

  if (!testOnly && stored[settings.NAZURIN_VERIFIED_STORAGE_KEY] !== true) {
    return nazurinFailure("not-verified");
  }

  if (signal.aborted || (sourceUrl && !await siteAccess.isEnabled(sourceUrl))) return nazurinFailure("permission-missing");
  const timeoutController = new AbortController();
  const abortForParent = () => timeoutController.abort("cancelled");
  signal.addEventListener("abort", abortForParent, { once: true });
  const timeout = setTimeout(() => timeoutController.abort("timeout"), settings.NAZURIN_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(testOnly ? {} : {
        url: artworkUrl
      }),
      signal: timeoutController.signal
    });

    if (testOnly && (response.status === 400 || response.status === 422)) {
      return { ok: true, status: "reachable" };
    }
    if (!response.ok) return nazurinFailure("http-error", `HTTP ${response.status}`);
    if (testOnly) return nazurinFailure("invalid-response");

    let payload;
    try {
      payload = await response.json();
    } catch {
      return nazurinFailure("invalid-response");
    }
    if (!payload || typeof payload !== "object" || typeof payload.error !== "number") {
      return nazurinFailure("invalid-response");
    }
    if (payload.error !== 0) {
      return nazurinFailure("api-error", sanitizeApiMessage(payload.message || payload.detail));
    }
    return { ok: true, status: "accepted" };
  } catch {
    if (timeoutController.signal.aborted && timeoutController.signal.reason === "timeout") {
      return nazurinFailure("timeout");
    }
    return nazurinFailure("network-error");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortForParent);
  }
}

async function getNazurinStatus() {
  const stored = await chrome.storage.local.get([
    settings.NAZURIN_API_HOST_STORAGE_KEY,
    settings.NAZURIN_API_TOKEN_STORAGE_KEY,
    settings.NAZURIN_VERIFIED_STORAGE_KEY
  ]);
  const host = settings.normalizeNazurinApiHost(stored[settings.NAZURIN_API_HOST_STORAGE_KEY]);
  const token = settings.normalizeNazurinApiToken(stored[settings.NAZURIN_API_TOKEN_STORAGE_KEY]);
  const permissionPattern = settings.getNazurinPermissionPattern(host);
  const configured = Boolean(host && token && permissionPattern);
  const permitted = configured && await chrome.permissions.contains({ origins: [permissionPattern] });
  return {
    configured,
    verified: Boolean(configured && permitted && stored[settings.NAZURIN_VERIFIED_STORAGE_KEY] === true)
  };
}

function nazurinFailure(status, message) {
  return { ok: false, status, ...(message ? { message } : {}) };
}

function sanitizeApiMessage(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  return normalized || undefined;
}

function abortSiteRequests(origin) {
  for (const registry of [activePageRequests, activeNazurinRequests]) {
    for (const controller of registry.values()) {
      try { if (new URL(controller.sourceUrl).origin === origin) controller.abort(); } catch { /* Test-only request. */ }
    }
  }
}

function cancelRequest(registry, requestId) {
  const normalizedRequestId = normalizeRequestId(requestId);
  registry.get(normalizedRequestId)?.abort();
  registry.delete(normalizedRequestId);
}

function deleteIfCurrent(registry, requestId, controller) {
  if (registry.get(requestId) === controller) registry.delete(requestId);
}

async function fetchPages(illustId, signal) {
  const endpoint = `https://www.pixiv.net/ajax/illust/${illustId}/pages?lang=zh`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal
  });

  if (!response.ok) throw new Error(`Pixiv metadata request failed with ${response.status}`);
  return response.json();
}

function isTrustedPixivSender(sender) {
  try {
    const url = new URL(sender.url || "");
    return sender.id === chrome.runtime.id && url.protocol === "https:" && url.hostname === "www.pixiv.net";
  } catch {
    return false;
  }
}

function isTrustedExtensionSender(sender) {
  try {
    const url = new URL(sender.url || "");
    return sender.id === chrome.runtime.id && url.protocol === "chrome-extension:" &&
      url.hostname === chrome.runtime.id;
  } catch {
    return false;
  }
}

function isTrustedPixivisionSender(sender) {
  return sender.id === chrome.runtime.id && sites.siteForUrl(sender.url) === "pixivision";
}

function isTrustedTwitterSender(sender) {
  try {
    const url = new URL(sender.url || "");
    return sender.id === chrome.runtime.id && url.protocol === "https:" &&
      sites.siteForUrl(url.href) === "twitter";
  } catch {
    return false;
  }
}

function normalizeTweetUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        sites.siteForUrl(url.href) !== "twitter") return null;
    return sites.targetUrl(value);
  } catch {
    return null;
  }
}

function normalizeIllustId(value) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function normalizeRequestId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/i.test(value) ? value : null;
}
