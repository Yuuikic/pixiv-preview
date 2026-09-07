"use strict";

importScripts("settings.js");

const settings = globalThis.PixivPreviewSettings;
const activePageRequests = new Map();
const activeNazurinRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "pfp-nazurin-test") {
    if (!isTrustedExtensionSender(sender)) return undefined;
    handleNazurinRequest({ requestId: message.requestId, testOnly: true }, sendResponse);
    return true;
  }

  if (!isTrustedPixivSender(sender)) return undefined;

  if (message.type === "pfp-nazurin-status") {
    getNazurinStatus().then(sendResponse, () => sendResponse({ configured: false, verified: false }));
    return true;
  }

  if (message.type === "pfp-cancel-pages") {
    cancelRequest(activePageRequests, message.requestId);
    return undefined;
  }

  if (message.type === "pfp-cancel-nazurin") {
    cancelRequest(activeNazurinRequests, message.requestId);
    return undefined;
  }

  if (message.type === "pfp-nazurin-submit") {
    handleNazurinRequest({
      illustId: message.illustId,
      requestId: message.requestId,
      testOnly: false
    }, sendResponse);
    return true;
  }

  if (message.type !== "pfp-get-pages") return undefined;

  const illustId = normalizeIllustId(message.illustId);
  const requestId = normalizeRequestId(message.requestId);
  if (!illustId || !requestId) {
    sendResponse({ ok: false, error: "invalid-request" });
    return undefined;
  }

  const controller = new AbortController();
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
});

async function handleNazurinRequest({ illustId, requestId, testOnly }, sendResponse) {
  const normalizedRequestId = normalizeRequestId(requestId);
  const normalizedIllustId = testOnly ? null : normalizeIllustId(illustId);
  if (!normalizedRequestId || (!testOnly && !normalizedIllustId)) {
    sendResponse(nazurinFailure("invalid-response"));
    return;
  }

  const controller = new AbortController();
  activeNazurinRequests.set(normalizedRequestId, controller);
  try {
    sendResponse(await performNazurinRequest({
      illustId: normalizedIllustId,
      testOnly,
      signal: controller.signal
    }));
  } catch {
    sendResponse(nazurinFailure("network-error"));
  } finally {
    deleteIfCurrent(activeNazurinRequests, normalizedRequestId, controller);
  }
}

async function performNazurinRequest({ illustId, testOnly, signal }) {
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
        url: `https://www.pixiv.net/artworks/${illustId}`
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

function normalizeIllustId(value) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function normalizeRequestId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/i.test(value) ? value : null;
}
