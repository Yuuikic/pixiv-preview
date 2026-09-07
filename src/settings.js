(() => {
  "use strict";

  const STORAGE_KEY = "hoverDelayMs";
  const RESIDUE_STORAGE_KEY = "hoverResidueMs";
  const OCCLUDED_SWITCH_STORAGE_KEY = "switchOccludedArtwork";
  const ORIGINAL_UPGRADE_STORAGE_KEY = "upgradeToOriginal";
  const AUTO_ARRANGE_STORAGE_KEY = "autoArrangePinnedWindows";
  const NAZURIN_API_HOST_STORAGE_KEY = "nazurinApiHost";
  const NAZURIN_API_TOKEN_STORAGE_KEY = "nazurinApiToken";
  const NAZURIN_VERIFIED_STORAGE_KEY = "nazurinConnectionVerified";
  const STICKY_SHORTCUT_STORAGE_KEY = "stickyShortcutCode";
  const NAZURIN_SHORTCUT_STORAGE_KEY = "nazurinShortcutCode";
  const DEFAULT_HOVER_DELAY_MS = 500;
  const DEFAULT_HOVER_RESIDUE_MS = 500;
  const DEFAULT_OCCLUDED_SWITCH_ENABLED = true;
  const DEFAULT_ORIGINAL_UPGRADE_ENABLED = false;
  const DEFAULT_AUTO_ARRANGE_ENABLED = false;
  const MIN_HOVER_DELAY_MS = 100;
  const MAX_HOVER_DELAY_MS = 3000;
  const HOVER_DELAY_STEP_MS = 50;
  const MIN_HOVER_RESIDUE_MS = 0;
  const MAX_HOVER_RESIDUE_MS = 1000;
  const HOVER_RESIDUE_STEP_MS = 50;
  const NAZURIN_REQUEST_TIMEOUT_MS = 10000;
  const DEFAULT_STICKY_SHORTCUT_CODE = "KeyS";
  const DEFAULT_NAZURIN_SHORTCUT_CODE = "KeyD";

  function normalizeHoverDelay(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_HOVER_DELAY_MS;
    }

    const clampedValue = Math.min(MAX_HOVER_DELAY_MS, Math.max(MIN_HOVER_DELAY_MS, numericValue));
    return Math.round(clampedValue / HOVER_DELAY_STEP_MS) * HOVER_DELAY_STEP_MS;
  }

  function normalizeOriginalUpgrade(value) {
    return value === true;
  }

  function normalizeAutoArrange(value) {
    return value === true;
  }

  function normalizeOccludedSwitch(value) {
    return value !== false;
  }

  function normalizeHoverResidue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_HOVER_RESIDUE_MS;
    }

    const clampedValue = Math.min(MAX_HOVER_RESIDUE_MS, Math.max(MIN_HOVER_RESIDUE_MS, numericValue));
    return Math.round(clampedValue / HOVER_RESIDUE_STEP_MS) * HOVER_RESIDUE_STEP_MS;
  }

  function normalizeNazurinApiHost(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname ||
          url.username || url.password || url.search || url.hash) return null;
      if (!url.pathname.endsWith("/")) url.pathname += "/";
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeNazurinApiToken(value) {
    if (typeof value !== "string") return null;
    const token = value.trim();
    return token && token.length <= 256 && !/[\s\\/?#&=%]/.test(token) ? token : null;
  }

  function buildNazurinApiEndpoint(host, token) {
    const normalizedHost = normalizeNazurinApiHost(host);
    const normalizedToken = normalizeNazurinApiToken(token);
    if (!normalizedHost || !normalizedToken) return null;
    return new URL(`./${normalizedToken}/api`, normalizedHost).href;
  }

  function getNazurinPermissionPattern(host) {
    const normalizedHost = normalizeNazurinApiHost(host);
    return normalizedHost ? `${new URL(normalizedHost).origin}/*` : null;
  }

  function isInsecureRemoteNazurinHost(host) {
    const normalizedHost = normalizeNazurinApiHost(host);
    if (!normalizedHost) return false;
    const url = new URL(normalizedHost);
    if (url.protocol !== "http:") return false;
    return !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }

  function normalizeShortcutCode(value, fallback) {
    return typeof value === "string" && /^(?:Key[A-Z]|Digit[0-9])$/.test(value)
      ? value
      : fallback;
  }

  function shortcutCodeLabel(code) {
    const normalized = normalizeShortcutCode(code, "");
    return normalized.startsWith("Key") ? normalized.slice(3) :
      normalized.startsWith("Digit") ? normalized.slice(5) : "";
  }

  globalThis.PixivPreviewSettings = Object.freeze({
    STORAGE_KEY,
    RESIDUE_STORAGE_KEY,
    OCCLUDED_SWITCH_STORAGE_KEY,
    ORIGINAL_UPGRADE_STORAGE_KEY,
    AUTO_ARRANGE_STORAGE_KEY,
    NAZURIN_API_HOST_STORAGE_KEY,
    NAZURIN_API_TOKEN_STORAGE_KEY,
    NAZURIN_VERIFIED_STORAGE_KEY,
    STICKY_SHORTCUT_STORAGE_KEY,
    NAZURIN_SHORTCUT_STORAGE_KEY,
    DEFAULT_HOVER_DELAY_MS,
    DEFAULT_HOVER_RESIDUE_MS,
    DEFAULT_OCCLUDED_SWITCH_ENABLED,
    DEFAULT_ORIGINAL_UPGRADE_ENABLED,
    DEFAULT_AUTO_ARRANGE_ENABLED,
    MIN_HOVER_DELAY_MS,
    MAX_HOVER_DELAY_MS,
    HOVER_DELAY_STEP_MS,
    MIN_HOVER_RESIDUE_MS,
    MAX_HOVER_RESIDUE_MS,
    HOVER_RESIDUE_STEP_MS,
    NAZURIN_REQUEST_TIMEOUT_MS,
    DEFAULT_STICKY_SHORTCUT_CODE,
    DEFAULT_NAZURIN_SHORTCUT_CODE,
    normalizeHoverDelay,
    normalizeHoverResidue,
    normalizeOccludedSwitch,
    normalizeOriginalUpgrade,
    normalizeAutoArrange,
    normalizeNazurinApiHost,
    normalizeNazurinApiToken,
    buildNazurinApiEndpoint,
    getNazurinPermissionPattern,
    isInsecureRemoteNazurinHost,
    normalizeShortcutCode,
    shortcutCodeLabel
  });
})();
