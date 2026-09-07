(() => {
  "use strict";

  if (window.top !== window || document.querySelector(".pfp-root")) return;

  const settings = globalThis.PixivPreviewSettings;
  const i18n = globalThis.P2I18n;
  const t = i18n.t;
  const extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version || "development";
  const ORIGINAL_DELAY_MS = 700;
  const POINTER_GAP_PX = 16;
  const VIEWPORT_MARGIN_PX = 8;
  const MAX_PREVIEW_WIDTH_PX = 720;
  const MAX_STICKY_WIDTH_PX = 1200;
  const MIN_STICKY_WIDTH_PX = 320;
  const MIN_ARTWORK_SIZE_PX = 72;
  const CACHE_LIMIT = 100;
  const EXIT_CLEANUP_DELAY_MS = 140;
  const TOOLBAR_ESTIMATED_HEIGHT_PX = 43;
  const WINDOW_BORDER_PX = 2;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const NAZURIN_QUEUE_GAP_MS = 1000;
  const ESCAPE_RESTORE_WINDOW_MS = 10000;
  const NAZURIN_GLOBAL_FAILURES = new Set(["not-configured", "not-verified", "permission-missing"]);
  const NAZURIN_STATE_LABELS = Object.freeze({
    idle: t("nazurinIdle"),
    queued: t("nazurinQueued"),
    sending: t("nazurinSending"),
    accepted: t("nazurinAccepted"),
    error: t("nazurinRetry")
  });

  let hoverDelayMs = settings.DEFAULT_HOVER_DELAY_MS;
  let hoverResidueMs = settings.DEFAULT_HOVER_RESIDUE_MS;
  let occludedSwitchEnabled = settings.DEFAULT_OCCLUDED_SWITCH_ENABLED;
  let originalUpgradeEnabled = settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED;
  let stickyShortcutCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
  let nazurinShortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
  let nazurinEnabled = false;

  class LruCache {
    constructor(limit) {
      this.limit = limit;
      this.items = new Map();
    }

    get(key) {
      if (!this.items.has(key)) return undefined;
      const value = this.items.get(key);
      this.items.delete(key);
      this.items.set(key, value);
      return value;
    }

    set(key, value) {
      this.items.delete(key);
      this.items.set(key, value);
      if (this.items.size > this.limit) this.items.delete(this.items.keys().next().value);
    }
  }

  const metadataCache = new LruCache(CACHE_LIMIT);

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createButton(className, title) {
    const button = createElement("button", `pfp-button ${className}`);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  }

  function createSvgIcon(className, pathData, extras = []) {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    for (const descriptor of extras) {
      const child = document.createElementNS(SVG_NAMESPACE, descriptor.tag);
      for (const [name, value] of Object.entries(descriptor.attributes)) child.setAttribute(name, value);
      svg.append(child);
    }
    return svg;
  }

  function extractIllustId(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.hostname !== "www.pixiv.net") return null;
      return url.pathname.match(/^\/artworks\/(\d+)(?:\/|$)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function safeImageUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value, window.location.href);
      const isPixivImageHost = url.hostname === "i.pximg.net" || url.hostname.endsWith(".pximg.net");
      return url.protocol === "https:" && isPixivImageHost ? url.href : null;
    } catch {
      return null;
    }
  }

  function normalizeImageDimension(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeArtworkResponse(illustId, payload) {
    if (!payload || payload.error || !Array.isArray(payload.body)) {
      throw new Error("Pixiv returned an unsupported metadata response");
    }
    const pages = payload.body.flatMap((page) => {
      const urls = page && typeof page === "object" ? page.urls : null;
      const regular = safeImageUrl(urls?.regular || urls?.small);
      const original = safeImageUrl(urls?.original);
      const width = normalizeImageDimension(page?.width);
      const height = normalizeImageDimension(page?.height);
      return regular ? [{ regular, original, width, height }] : [];
    });
    if (pages.length === 0) throw new Error("Pixiv metadata did not contain displayable pages");
    return { illustId, pages, degraded: false };
  }

  function requestArtworkPages(illustId, signal) {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", handleAbort);
        callback(value);
      };
      const handleAbort = () => {
        globalThis.chrome?.runtime?.sendMessage?.({ type: "pfp-cancel-pages", requestId });
        finish(reject, new DOMException("Metadata request cancelled", "AbortError"));
      };
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
      globalThis.chrome.runtime.sendMessage(
        { type: "pfp-get-pages", illustId, requestId },
        (response) => {
          if (globalThis.chrome.runtime.lastError) {
            finish(reject, new Error(globalThis.chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            const error = response?.error === "aborted"
              ? new DOMException("Metadata request cancelled", "AbortError")
              : new Error("Pixiv metadata request failed");
            finish(reject, error);
            return;
          }
          finish(resolve, response.payload);
        }
      );
    });
  }

  function requestNazurinSubmit(illustId, requestId) {
    return new Promise((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "pfp-nazurin-submit", illustId, requestId },
        (response) => {
          if (globalThis.chrome.runtime.lastError) {
            resolve({ ok: false, status: "network-error" });
            return;
          }
          resolve(response && typeof response === "object"
            ? response
            : { ok: false, status: "invalid-response" });
        }
      );
    });
  }

  function requestNazurinStatus() {
    return new Promise((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "pfp-nazurin-status" }, (response) => {
        if (globalThis.chrome.runtime.lastError) return resolve(false);
        resolve(response?.configured === true && response?.verified === true);
      });
    });
  }

  async function getArtworkMetadata(illustId, signal) {
    const cached = metadataCache.get(illustId);
    if (cached) return cached;
    const payload = await requestArtworkPages(illustId, signal);
    const metadata = normalizeArtworkResponse(illustId, payload);
    metadataCache.set(illustId, metadata);
    return metadata;
  }

  function findArtworkCandidate(element, clientX, clientY) {
    if (!(element instanceof Element) || element.closest(".pfp-root")) return null;
    const anchor = element.closest('a[href*="/artworks/"]');
    const illustId = extractIllustId(anchor);
    if (!anchor || !illustId) return null;
    const image = Array.from(anchor.querySelectorAll("img")).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= MIN_ARTWORK_SIZE_PX && rect.height >= MIN_ARTWORK_SIZE_PX &&
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    return image ? { anchor, image, illustId } : null;
  }

  function findUnderlyingArtworkCandidate(clientX, clientY) {
    if (typeof document.elementsFromPoint !== "function") return null;
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      if (!(element instanceof Element) || element.closest(".pfp-root")) continue;
      const candidate = findArtworkCandidate(element, clientX, clientY);
      if (candidate) return candidate;
    }
    return null;
  }

  function artworkAnchorsForId(illustId, preferredAnchor) {
    const anchors = [];
    if (preferredAnchor?.isConnected && extractIllustId(preferredAnchor) === illustId) anchors.push(preferredAnchor);
    for (const anchor of document.querySelectorAll('a[href*="/artworks/"]')) {
      if (extractIllustId(anchor) === illustId && !anchors.includes(anchor)) anchors.push(anchor);
    }
    return anchors;
  }

  function findBookmarkButton(illustId, preferredAnchor, preferredImage) {
    let best = null;
    let bestScore = Infinity;
    for (const anchor of artworkAnchorsForId(illustId, preferredAnchor)) {
      const images = preferredImage?.isConnected && anchor.contains(preferredImage)
        ? [preferredImage]
        : Array.from(anchor.querySelectorAll("img"));
      const image = images.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width >= MIN_ARTWORK_SIZE_PX && rect.height >= MIN_ARTWORK_SIZE_PX;
      });
      if (!image) continue;
      const imageRect = image.getBoundingClientRect();
      let container = anchor.parentElement;
      for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
        for (const button of container.querySelectorAll("button")) {
          if (button.closest(".pfp-root")) continue;
          const rect = button.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          if (rect.width <= 0 || rect.height <= 0 || centerX < imageRect.left || centerX > imageRect.right ||
              centerY < imageRect.top || centerY > imageRect.bottom) continue;
          const score = Math.abs(imageRect.right - centerX) + Math.abs(imageRect.bottom - centerY) + depth * 4;
          if (score < bestScore) {
            best = button;
            bestScore = score;
          }
        }
        if (best) break;
      }
    }
    return best;
  }

  function isRedColor(value) {
    const text = String(value).trim();
    const rgbMatch = text.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
    const hexMatch = text.match(/#([\da-f]{8}|[\da-f]{6}|[\da-f]{3})(?![\da-f])/i);
    let red;
    let green;
    let blue;
    if (rgbMatch) {
      [, red, green, blue] = rgbMatch.map(Number);
    } else if (hexMatch) {
      const hex = hexMatch[1].length === 3
        ? hexMatch[1].split("").map((character) => character.repeat(2)).join("")
        : hexMatch[1].slice(0, 6);
      red = Number.parseInt(hex.slice(0, 2), 16);
      green = Number.parseInt(hex.slice(2, 4), 16);
      blue = Number.parseInt(hex.slice(4, 6), 16);
    } else {
      return false;
    }
    return red >= 210 && green <= 135 && blue <= 155 && red > green * 1.45;
  }

  function elementHasRedPaint(element) {
    const style = getComputedStyle(element);
    const values = [
      style.color,
      style.fill,
      style.stroke,
      style.backgroundColor,
      element.getAttribute("fill"),
      element.getAttribute("stroke"),
      element.getAttribute("color"),
      element.getAttribute("style")
    ];
    for (const pseudo of ["::before", "::after"]) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      values.push(pseudoStyle.color, pseudoStyle.fill, pseudoStyle.stroke, pseudoStyle.backgroundColor);
    }
    return values.some(isRedColor);
  }

  function readBookmarkState(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    const pressed = button.getAttribute("aria-pressed");
    if (pressed === "true" || pressed === "false") return pressed === "true";
    const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""}`.toLowerCase();
    if (/取消收藏|解除收藏|ブックマークを解除|remove bookmark|unbookmark/.test(label)) return true;
    if (/添加收藏|加入收藏|ブックマークに追加|add bookmark/.test(label)) return false;
    return [button, ...button.querySelectorAll("*")].some(elementHasRedPaint);
  }

  class PreviewWindow {
    constructor(manager, candidate, anchorX, anchorY) {
      Object.assign(this, {
        manager,
        illustId: candidate.illustId,
        sourceAnchor: candidate.anchor,
        sourceImage: candidate.image,
        thumbnailUrl: safeImageUrl(candidate.image.currentSrc || candidate.image.src),
        previewAnchorX: anchorX,
        previewAnchorY: anchorY,
        metadata: null,
        pageIndex: 0,
        sticky: false,
        closed: false,
        requestRevision: 0,
        renderRevision: 0,
        abortController: null,
        originalTimer: 0,
        pendingImageLoads: new Map(),
        baseStageWidth: 320,
        userScale: 1,
        userResized: false,
        preserveTransientPosition: false,
        bookmarkButton: null,
        observedBookmarkButton: null,
        bookmarkObserverTimer: 0,
        bookmarked: false,
        bookmarkExpectedState: null,
        bookmarkExpectedUntil: 0,
        toolClickBlockedUntil: 0,
        nazurinState: "idle",
        nazurinMessage: ""
      });
      this.bookmarkObserver = typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            clearTimeout(this.bookmarkObserverTimer);
            this.bookmarkObserverTimer = window.setTimeout(() => this.syncBookmarkState(), 60);
          })
        : null;
      this.ui = this.createUi();
      const savedNazurinState = this.manager.nazurinStates.get(this.illustId);
      this.setNazurinState(savedNazurinState?.state || "idle", savedNazurinState?.message || "");
      this.resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.handleResizeObserved())
        : null;
      this.resizeObserver?.observe(this.ui.root);
      this.manager.bringToFront(this);
      this.syncBookmarkState();
    }

    createUi() {
      const root = createElement("aside", "pfp-root pfp-is-positioning");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", t("previewDialog"));
      root.setAttribute("aria-hidden", "true");
      root.dataset.pfpVersion = extensionVersion;
      root.dataset.illustId = this.illustId;

      const stage = createElement("div", "pfp-stage");
      const imageLayer = createElement("div", "pfp-image-layer");
      const loading = createElement("div", "pfp-loading");
      const loadingIndicator = createElement("div", "pfp-loading-indicator");
      const loadingSpinner = createElement("span", "pfp-loading-spinner");
      const loadingLabel = createElement("span", "pfp-loading-label", t("loadingPreview"));
      loadingIndicator.append(loadingSpinner, loadingLabel);
      loading.append(loadingIndicator);
      const error = createElement("div", "pfp-error", t("previewUnavailable"));
      stage.append(imageLayer, loading, error);

      const toolbar = createElement("div", "pfp-toolbar");
      const status = createElement("span", "pfp-status", "");
      const pages = createElement("div", "pfp-pages");
      const previous = createButton("pfp-previous-button", t("previousPage"));
      previous.textContent = "‹";
      const counter = createElement("span", "pfp-counter", "");
      const next = createButton("pfp-next-button", t("nextPage"));
      next.textContent = "›";
      pages.append(previous, counter, next);

      const tools = createElement("div", "pfp-tools");
      const bookmark = createButton("pfp-bookmark-button", t("bookmark"));
      bookmark.disabled = true;
      bookmark.append(createSvgIcon("pfp-heart-icon", "M12 20.35 10.55 19.03C5.4 14.36 2 11.27 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09A6.02 6.02 0 0 1 16.5 2C19.58 2 22 4.42 22 7.5c0 3.77-3.4 6.86-8.55 11.54Z"));
      const open = createButton("pfp-open-button", t("openArtwork"));
      open.disabled = true;
      open.append(createSvgIcon(
        "pfp-open-icon",
        "M5 18l4.5-5 3.1 3.1 2.2-2.6L19 18",
        [
          { tag: "rect", attributes: { x: "3", y: "3", width: "18", height: "18", rx: "2" } },
          { tag: "circle", attributes: { cx: "9", cy: "8", r: "1.5" } }
        ]
      ));
      const nazurin = createButton("pfp-nazurin-button", NAZURIN_STATE_LABELS.idle);
      nazurin.disabled = true;
      nazurin.hidden = !nazurinEnabled;
      const nazurinIcon = createElement("img", "pfp-nazurin-icon");
      nazurinIcon.alt = "";
      nazurinIcon.draggable = false;
      nazurinIcon.src = globalThis.chrome.runtime.getURL("assets/nazurin-48.png");
      const nazurinProgress = createElement("span", "pfp-nazurin-progress");
      nazurin.append(nazurinIcon, nazurinProgress);
      tools.append(bookmark, open, nazurin);

      const stickyHint = createButton("pfp-sticky-hint", t("sticky"));
      const stickyKey = createElement("kbd", "pfp-keycap", settings.shortcutCodeLabel(stickyShortcutCode));
      const stickyLabel = createElement("span", "pfp-sticky-label", t("sticky"));
      stickyHint.append(stickyKey, stickyLabel);
      stickyHint.title = t("stickyTitle", { key: settings.shortcutCodeLabel(stickyShortcutCode) });
      stickyHint.setAttribute("aria-pressed", "false");
      const close = createButton("pfp-close-button", t("closeCurrent"));
      close.textContent = "×";
      toolbar.append(status, pages, tools, stickyHint, close);
      root.append(stage, toolbar);

      for (const direction of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
        const handle = createElement("span", `pfp-resize-handle pfp-resize-${direction}`);
        handle.dataset.direction = direction;
        handle.setAttribute("aria-hidden", "true");
        root.append(handle);
        handle.addEventListener("pointerdown", (event) => this.startResize(event, direction));
      }

      previous.addEventListener("click", (event) => { event.stopPropagation(); this.showPage(this.pageIndex - 1); });
      next.addEventListener("click", (event) => { event.stopPropagation(); this.showPage(this.pageIndex + 1); });
      bookmark.addEventListener("click", (event) => { event.stopPropagation(); this.toggleBookmark(); });
      open.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!this.sticky || performance.now() < this.toolClickBlockedUntil) return;
        window.open(`https://www.pixiv.net/artworks/${this.illustId}`, "_blank", "noopener");
      });
      nazurin.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!this.sticky || performance.now() < this.toolClickBlockedUntil ||
            this.nazurinState === "queued" || this.nazurinState === "sending") return;
        this.manager.enqueueNazurin([this]);
      });
      close.addEventListener("click", (event) => { event.stopPropagation(); this.manager.closeWindow(this); });
      stickyHint.addEventListener("click", (event) => {
        event.stopPropagation();
        this.manager.toggleWindowSticky(this);
      });
      root.addEventListener("pointerenter", (event) => this.manager.handlePreviewPointerEnter(this, event));
      root.addEventListener("pointerleave", (event) => this.manager.handlePreviewPointerLeave(this, event));
      root.addEventListener("pointerdown", (event) => {
        this.manager.bringToFront(this);
        if (!this.sticky && event.button === 0 && !event.target.closest(".pfp-sticky-hint")) {
          this.manager.pinWindowFromClick(this, { suppressTools: true });
        }
      });
      root.addEventListener("dblclick", (event) => {
        if (this.sticky && event.button === 0 && !event.target.closest("button")) {
          event.preventDefault();
          this.manager.closeWindow(this);
        }
      });
      root.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
      stage.addEventListener("pointerdown", (event) => this.startDrag(event));
      toolbar.addEventListener("pointerdown", (event) => this.startDrag(event));
      document.documentElement.append(root);

      return { root, stage, imageLayer, loading, loadingLabel, error, toolbar, status, pages,
        previous, counter, next, tools, bookmark, open, nazurin, stickyHint, stickyKey, stickyLabel, close };
    }

    async open() {
      const revision = ++this.requestRevision;
      const controller = new AbortController();
      this.abortController = controller;
      this.showMetadataLoading();
      try {
        const metadata = await getArtworkMetadata(this.illustId, controller.signal);
        if (!this.isCurrentRequest(revision)) return;
        this.metadata = metadata;
        await this.showPage(0);
      } catch (error) {
        if (error?.name === "AbortError" || !this.isCurrentRequest(revision)) return;
        if (this.thumbnailUrl) {
          this.metadata = {
            illustId: this.illustId,
            pages: [{ regular: this.thumbnailUrl, original: null,
              width: this.sourceImage?.naturalWidth || this.sourceImage?.width || null,
              height: this.sourceImage?.naturalHeight || this.sourceImage?.height || null }],
            degraded: true
          };
          await this.showPage(0);
        } else {
          this.showError(t("cannotGetArtwork"));
        }
      } finally {
        if (this.abortController === controller) this.abortController = null;
      }
    }

    isCurrentRequest(revision) {
      return !this.closed && this.requestRevision === revision;
    }

    showMetadataLoading() {
      this.ui.imageLayer.replaceChildren();
      this.clearPageSize();
      const placeholder = this.createThumbnailPlaceholder();
      if (placeholder) this.ui.imageLayer.append(placeholder);
      this.ui.loadingLabel.textContent = t("readingArtwork");
      this.ui.status.textContent = t("readingArtwork");
      this.ui.error.textContent = "";
      this.ui.root.classList.remove("pfp-has-error");
      this.ui.root.classList.add("pfp-is-visible", "pfp-is-loading", "pfp-is-positioning");
      this.ui.root.setAttribute("aria-hidden", "false");
      this.updateControls();
      this.positionAndReveal();
    }

    showError(message) {
      if (this.closed) return;
      this.clearOriginalTimer();
      this.cancelPendingImageLoads();
      this.ui.imageLayer.replaceChildren();
      this.ui.error.textContent = message;
      this.ui.status.textContent = t("previewUnavailableStatus");
      this.ui.root.classList.remove("pfp-is-loading");
      this.ui.root.classList.add("pfp-is-visible", "pfp-has-error");
      this.ui.root.setAttribute("aria-hidden", "false");
      this.updateControls();
      this.reposition();
    }

    async showPage(nextIndex) {
      if (this.closed || !this.metadata || nextIndex < 0 || nextIndex >= this.metadata.pages.length) return;
      this.clearOriginalTimer();
      this.cancelPendingImageLoads();
      const renderRevision = ++this.renderRevision;
      this.pageIndex = nextIndex;
      this.ui.imageLayer.replaceChildren();
      this.ui.stage.classList.remove("pfp-has-ready-image");
      this.ui.root.classList.remove("pfp-has-error");
      this.ui.root.classList.add("pfp-is-visible", "pfp-is-loading");
      this.ui.root.setAttribute("aria-hidden", "false");
      this.ui.loadingLabel.textContent = t("loadingPreview");
      this.ui.status.textContent = this.metadata.degraded ? t("usingThumbnail") : t("loadingPreview");
      this.updateControls();

      const page = this.metadata.pages[nextIndex];
      this.applyPageSize(page, { animate: !this.userResized });
      const placeholder = this.createThumbnailPlaceholder();
      if (placeholder) this.ui.imageLayer.append(placeholder);
      const baseLoad = this.createImageLoad(page.regular, "pfp-image pfp-image-base", page, "preview");
      this.ui.imageLayer.append(baseLoad.image);
      this.reposition();

      try {
        await baseLoad.loaded;
        if (!this.isCurrentRender(renderRevision)) return;
        const naturalRatio = baseLoad.image.naturalWidth / baseLoad.image.naturalHeight;
        const declaredRatio = page.width && page.height ? page.width / page.height : 0;
        if (Number.isFinite(naturalRatio) && naturalRatio > 0 && Math.abs(naturalRatio - declaredRatio) > 0.0001) {
          page.displayWidth = baseLoad.image.naturalWidth;
          page.displayHeight = baseLoad.image.naturalHeight;
          this.applyPageSize(page, { animate: false });
        }
        baseLoad.image.classList.add("pfp-is-ready");
        this.ui.stage.classList.add("pfp-has-ready-image");
        placeholder?.classList.add("pfp-is-hidden");
        this.ui.root.classList.remove("pfp-is-loading");
        this.ui.status.textContent = this.metadata.degraded ? t("usingThumbnail") : t("quickPreview");
        if (placeholder) window.setTimeout(() => {
          if (this.isCurrentRender(renderRevision)) placeholder.remove();
        }, 190);
        if (originalUpgradeEnabled && !this.metadata.degraded && page.original && page.original !== page.regular) {
          this.scheduleOriginalUpgrade(page.original, renderRevision, this.sticky ? 0 : ORIGINAL_DELAY_MS);
        }
      } catch {
        if (this.isCurrentRender(renderRevision)) this.showError(t("imageLoadFailed"));
      }
    }

    createThumbnailPlaceholder() {
      if (!this.thumbnailUrl) return null;
      const image = createElement("img", "pfp-image pfp-image-placeholder");
      image.alt = "";
      image.draggable = false;
      image.src = this.thumbnailUrl;
      return image;
    }

    createImageLoad(url, className, page, loadKind) {
      const image = createElement("img", className);
      image.alt = t("imageAlt");
      image.draggable = false;
      const width = page?.displayWidth || page?.width;
      const height = page?.displayHeight || page?.height;
      if (width && height) {
        image.width = Math.round(width);
        image.height = Math.round(height);
      }
      const loaded = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          image.removeEventListener("load", handleLoad);
          image.removeEventListener("error", handleError);
          this.pendingImageLoads.delete(cancel);
          callback(value);
        };
        const handleLoad = async () => {
          try { await image.decode?.(); } catch { /* A loaded image remains usable. */ }
          finish(resolve, image);
        };
        const handleError = () => finish(reject, new Error("Image failed to load"));
        const cancel = () => {
          image.removeAttribute("src");
          finish(reject, new DOMException("Image load cancelled", "AbortError"));
        };
        this.pendingImageLoads.set(cancel, loadKind);
        image.addEventListener("load", handleLoad);
        image.addEventListener("error", handleError);
        image.src = url;
      });
      return { image, loaded };
    }

    scheduleOriginalUpgrade(url, renderRevision, delay) {
      this.clearOriginalTimer();
      this.originalTimer = window.setTimeout(async () => {
        this.originalTimer = 0;
        const page = this.metadata?.pages[this.pageIndex];
        if (!page) return;
        try {
          const load = this.createImageLoad(url, "pfp-image pfp-image-upgrade", page, "original");
          await load.loaded;
          if (!originalUpgradeEnabled || !this.isCurrentRender(renderRevision)) return;
          this.ui.imageLayer.append(load.image);
          requestAnimationFrame(() => {
            if (this.isCurrentRender(renderRevision)) {
              load.image.classList.add("pfp-is-ready");
              this.ui.status.textContent = t("originalPreview");
            }
          });
        } catch {
          if (originalUpgradeEnabled && this.isCurrentRender(renderRevision)) {
            this.ui.status.textContent = t("originalFailed");
          }
        }
      }, delay);
    }

    isCurrentRender(revision) {
      return !this.closed && this.renderRevision === revision && Boolean(this.metadata);
    }

    applyOriginalSetting() {
      if (this.closed) return;
      if (!originalUpgradeEnabled) {
        this.clearOriginalTimer();
        this.cancelOriginalLoads();
        this.ui.imageLayer.querySelectorAll(".pfp-image-upgrade").forEach((image) => image.remove());
        if (this.ui.imageLayer.querySelector(".pfp-image-base")) {
          this.ui.status.textContent = this.metadata?.degraded ? t("usingThumbnail") : t("quickPreview");
        }
        return;
      }
      const page = this.metadata?.pages[this.pageIndex];
      if (page?.original && page.original !== page.regular &&
          this.ui.imageLayer.querySelector(".pfp-image-base.pfp-is-ready") &&
          !this.ui.imageLayer.querySelector(".pfp-image-upgrade.pfp-is-ready")) {
        this.scheduleOriginalUpgrade(page.original, this.renderRevision, this.sticky ? 0 : ORIGINAL_DELAY_MS);
      }
    }

    pageDimensions(page) {
      return { width: page?.displayWidth || page?.width || 320, height: page?.displayHeight || page?.height || 320 };
    }

    getDefaultFit(page) {
      const { width, height } = this.pageDimensions(page);
      const maxWidth = this.sticky
        ? Math.min(
            MAX_PREVIEW_WIDTH_PX,
            document.documentElement.clientWidth - VIEWPORT_MARGIN_PX * 2 - WINDOW_BORDER_PX
          )
        : this.getAvailableTransientWidth();
      const maxHeight = Math.max(
        160,
        Math.floor(window.innerHeight * 0.85) - TOOLBAR_ESTIMATED_HEIGHT_PX - WINDOW_BORDER_PX
      );
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const targetWidth = width * scale;
      return { width: targetWidth, height: targetWidth * height / width };
    }

    applyPageSize(page, { animate = true } = {}) {
      const base = this.getDefaultFit(page);
      this.baseStageWidth = base.width;
      const desiredWidth = this.sticky && this.userResized ? base.width * this.userScale : base.width;
      const constrained = this.constrainStageWidth(desiredWidth, base.width / base.height);
      const currentRect = this.ui.stage.getBoundingClientRect();
      this.ui.stage.classList.toggle("pfp-no-size-transition", !animate);
      this.ui.root.classList.toggle("pfp-no-size-transition", !animate);
      if (animate && currentRect.width > 0 && currentRect.height > 0) {
        this.ui.root.style.width = `${currentRect.width + WINDOW_BORDER_PX}px`;
        this.ui.stage.style.width = `${currentRect.width}px`;
        this.ui.stage.style.height = `${currentRect.height}px`;
        this.ui.stage.getBoundingClientRect();
      }
      this.ui.stage.style.aspectRatio = `${base.width} / ${base.height}`;
      this.ui.root.style.width = `${constrained.width + WINDOW_BORDER_PX}px`;
      this.ui.stage.style.width = `${constrained.width}px`;
      this.ui.stage.style.height = `${constrained.height}px`;
      if (!animate) {
        this.ui.stage.getBoundingClientRect();
        this.ui.stage.classList.remove("pfp-no-size-transition");
        this.ui.root.classList.remove("pfp-no-size-transition");
      }
      this.userScale = constrained.width / base.width;
      this.reposition();
    }

    clearPageSize() {
      this.ui.stage.classList.add("pfp-no-size-transition");
      this.ui.root.classList.add("pfp-no-size-transition");
      this.ui.root.style.width = `${320 + WINDOW_BORDER_PX}px`;
      this.ui.stage.style.removeProperty("width");
      this.ui.stage.style.removeProperty("height");
      this.ui.stage.style.removeProperty("aspect-ratio");
      this.ui.stage.getBoundingClientRect();
      this.ui.stage.classList.remove("pfp-no-size-transition");
      this.ui.root.classList.remove("pfp-no-size-transition");
      this.baseStageWidth = 320;
      this.userScale = 1;
      this.userResized = false;
    }

    constrainStageWidth(width, ratio) {
      if (!this.sticky) return { width, height: width / ratio };
      const maxByViewport = document.documentElement.clientWidth - VIEWPORT_MARGIN_PX * 2 - WINDOW_BORDER_PX;
      const maxByHeight = (
        document.documentElement.clientHeight - TOOLBAR_ESTIMATED_HEIGHT_PX -
        VIEWPORT_MARGIN_PX * 2 - WINDOW_BORDER_PX
      ) * ratio;
      const maximum = Math.max(1, Math.min(MAX_STICKY_WIDTH_PX, maxByViewport, maxByHeight));
      const minimum = Math.min(MIN_STICKY_WIDTH_PX, maximum);
      const constrainedWidth = Math.min(maximum, Math.max(minimum, width));
      return { width: constrainedWidth, height: constrainedWidth / ratio };
    }

    getAvailableTransientWidth() {
      const viewportWidth = document.documentElement.clientWidth;
      const spaceRight = viewportWidth - this.previewAnchorX - POINTER_GAP_PX - VIEWPORT_MARGIN_PX;
      const spaceLeft = this.previewAnchorX - POINTER_GAP_PX - VIEWPORT_MARGIN_PX;
      return Math.min(
        MAX_PREVIEW_WIDTH_PX,
        Math.max(160, (spaceRight >= spaceLeft ? spaceRight : spaceLeft) - WINDOW_BORDER_PX),
        viewportWidth - VIEWPORT_MARGIN_PX * 2 - WINDOW_BORDER_PX
      );
    }

    positionAndReveal() {
      this.reposition();
      this.ui.root.classList.remove("pfp-is-positioning");
    }

    reposition() {
      if (this.closed || !this.ui.root.classList.contains("pfp-is-visible")) return;
      if (this.sticky || this.preserveTransientPosition) {
        this.clampToViewport();
        return;
      }
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const spaceRight = viewportWidth - this.previewAnchorX - POINTER_GAP_PX - VIEWPORT_MARGIN_PX;
      const spaceLeft = this.previewAnchorX - POINTER_GAP_PX - VIEWPORT_MARGIN_PX;
      const placeRight = spaceRight >= spaceLeft;
      this.ui.root.style.setProperty("--pfp-max-width", `${Math.floor(this.getAvailableTransientWidth())}px`);
      const rect = this.ui.root.getBoundingClientRect();
      this.ui.root.classList.toggle("pfp-side-left", !placeRight);
      if (placeRight) {
        const left = Math.max(VIEWPORT_MARGIN_PX,
          Math.min(this.previewAnchorX + POINTER_GAP_PX, viewportWidth - rect.width - VIEWPORT_MARGIN_PX));
        this.ui.root.style.left = `${left}px`;
        this.ui.root.style.right = "auto";
      } else {
        const right = Math.max(VIEWPORT_MARGIN_PX,
          Math.min(viewportWidth - this.previewAnchorX + POINTER_GAP_PX,
            viewportWidth - rect.width - VIEWPORT_MARGIN_PX));
        this.ui.root.style.left = "auto";
        this.ui.root.style.right = `${right}px`;
      }
      const top = Math.max(VIEWPORT_MARGIN_PX,
        Math.min(this.previewAnchorY - 24, viewportHeight - rect.height - VIEWPORT_MARGIN_PX));
      this.ui.root.style.top = `${top}px`;
    }

    clampToViewport() {
      const rect = this.ui.root.getBoundingClientRect();
      const maxLeft = Math.max(VIEWPORT_MARGIN_PX,
        document.documentElement.clientWidth - rect.width - VIEWPORT_MARGIN_PX);
      const maxTop = Math.max(VIEWPORT_MARGIN_PX,
        document.documentElement.clientHeight - rect.height - VIEWPORT_MARGIN_PX);
      this.ui.root.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.left, maxLeft))}px`;
      this.ui.root.style.right = "auto";
      this.ui.root.style.top = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.top, maxTop))}px`;
    }

    pin() {
      if (this.closed || this.sticky) return;
      const rect = this.ui.root.getBoundingClientRect();
      this.sticky = true;
      this.ui.root.classList.add("pfp-is-sticky");
      this.ui.root.classList.remove("pfp-side-left");
      this.ui.root.style.setProperty("--pfp-max-width",
        `${document.documentElement.clientWidth - VIEWPORT_MARGIN_PX * 2 - WINDOW_BORDER_PX}px`);
      this.ui.root.style.left = `${rect.left}px`;
      this.ui.root.style.right = "auto";
      this.ui.root.style.top = `${rect.top}px`;
      this.ui.stickyLabel.textContent = t("stuck");
      this.ui.stickyHint.title = t("unstickTitle");
      this.ui.stickyHint.setAttribute("aria-label", t("unstickTitle"));
      this.ui.stickyHint.setAttribute("aria-pressed", "true");
      this.ui.open.disabled = false;
      this.setNazurinState(this.nazurinState, this.nazurinMessage);
      this.manager.registerPinned(this);
      this.syncBookmarkState();
      this.applyOriginalSetting();
      this.clampToViewport();
    }

    unpin() {
      if (this.closed || !this.sticky) return;
      const rect = this.ui.root.getBoundingClientRect();
      this.sticky = false;
      this.preserveTransientPosition = true;
      this.ui.root.classList.remove("pfp-is-sticky");
      this.ui.root.style.left = `${rect.left}px`;
      this.ui.root.style.right = "auto";
      this.ui.root.style.top = `${rect.top}px`;
      this.ui.stickyLabel.textContent = t("sticky");
      this.ui.stickyHint.title = t("stickyTitle", { key: settings.shortcutCodeLabel(stickyShortcutCode) });
      this.ui.stickyHint.setAttribute("aria-label", this.ui.stickyHint.title);
      this.ui.stickyHint.setAttribute("aria-pressed", "false");
      this.ui.open.disabled = true;
      this.setNazurinState(this.nazurinState, this.nazurinMessage);
      this.manager.registerUnpinned(this);
      this.syncBookmarkState();
      this.applyOriginalSetting();
      this.clampToViewport();
    }

    updateControls() {
      const pageCount = this.metadata?.pages.length ?? 1;
      this.ui.counter.textContent = pageCount > 1 ? `${this.pageIndex + 1} / ${pageCount}` : "";
      this.ui.previous.disabled = this.pageIndex <= 0;
      this.ui.next.disabled = this.pageIndex >= pageCount - 1;
      this.ui.pages.hidden = pageCount <= 1;
    }

    setNazurinState(state, message = "") {
      if (this.closed) return;
      this.nazurinState = NAZURIN_STATE_LABELS[state] ? state : "error";
      this.nazurinMessage = typeof message === "string" ? message : "";
      this.ui.nazurin.hidden = !nazurinEnabled;
      this.ui.nazurin.dataset.state = this.nazurinState;
      this.ui.nazurin.disabled = !this.sticky || this.nazurinState === "queued" ||
        this.nazurinState === "sending";
      const title = this.nazurinMessage || NAZURIN_STATE_LABELS[this.nazurinState];
      this.ui.nazurin.title = title;
      this.ui.nazurin.setAttribute("aria-label", title);
    }

    handleWheel(event) {
      if (!this.sticky || Math.abs(event.deltaY) < 1) return;
      event.preventDefault();
      this.manager.bringToFront(this);
      const stageRect = this.ui.stage.getBoundingClientRect();
      const ratio = stageRect.width / stageRect.height;
      const constrained = this.constrainStageWidth(stageRect.width * Math.exp(-event.deltaY * 0.00125), ratio);
      if (Math.abs(constrained.width - stageRect.width) < 0.1) return;
      const rootRect = this.ui.root.getBoundingClientRect();
      const anchorX = event.clientX >= stageRect.left && event.clientX <= stageRect.right
        ? (event.clientX - stageRect.left) / stageRect.width : 0.5;
      const anchorY = event.clientY >= stageRect.top && event.clientY <= stageRect.bottom
        ? (event.clientY - stageRect.top) / stageRect.height : 0.5;
      this.setStageSize(constrained.width, constrained.height);
      const nextRect = this.ui.root.getBoundingClientRect();
      this.ui.root.style.left = `${rootRect.left - (nextRect.width - rootRect.width) * anchorX}px`;
      this.ui.root.style.top = `${rootRect.top - (nextRect.height - rootRect.height) * anchorY}px`;
      this.clampToViewport();
    }

    setStageSize(width, height) {
      this.userResized = true;
      this.userScale = width / this.baseStageWidth;
      this.ui.stage.classList.add("pfp-no-size-transition");
      this.ui.root.classList.add("pfp-no-size-transition");
      this.ui.root.style.width = `${width + WINDOW_BORDER_PX}px`;
      this.ui.stage.style.width = `${width}px`;
      this.ui.stage.style.height = `${height}px`;
      this.ui.stage.getBoundingClientRect();
      this.ui.stage.classList.remove("pfp-no-size-transition");
      this.ui.root.classList.remove("pfp-no-size-transition");
    }

    startDrag(event) {
      if (event.button !== 0 || event.target.closest("button, .pfp-pages, .pfp-tools")) return;
      if (!this.sticky) this.manager.pinWindowFromClick(this, { suppressTools: true });
      if (!this.sticky) return;
      event.preventDefault();
      this.manager.bringToFront(this);
      const rootRect = this.ui.root.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      this.ui.root.classList.add("pfp-is-dragging");
      const move = (moveEvent) => {
        this.ui.root.style.left = `${rootRect.left + moveEvent.clientX - startX}px`;
        this.ui.root.style.top = `${rootRect.top + moveEvent.clientY - startY}px`;
        this.clampToViewport();
      };
      const stop = () => {
        this.ui.root.classList.remove("pfp-is-dragging");
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", stop, true);
        window.removeEventListener("pointercancel", stop, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
    }

    startResize(event, direction) {
      if (!this.sticky || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.manager.bringToFront(this);
      const rootRect = this.ui.root.getBoundingClientRect();
      const stageRect = this.ui.stage.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const ratio = stageRect.width / stageRect.height;
      this.ui.root.classList.add("pfp-is-resizing");
      const move = (moveEvent) => {
        const horizontalDelta = direction.includes("e") ? moveEvent.clientX - startX
          : direction.includes("w") ? startX - moveEvent.clientX : null;
        const verticalDelta = direction.includes("s") ? moveEvent.clientY - startY
          : direction.includes("n") ? startY - moveEvent.clientY : null;
        let desiredWidth;
        if (horizontalDelta !== null && verticalDelta !== null) {
          const fromHorizontal = stageRect.width + horizontalDelta;
          const fromVertical = stageRect.width + verticalDelta * ratio;
          desiredWidth = Math.abs(fromHorizontal - stageRect.width) >= Math.abs(fromVertical - stageRect.width)
            ? fromHorizontal : fromVertical;
        } else if (horizontalDelta !== null) {
          desiredWidth = stageRect.width + horizontalDelta;
        } else {
          desiredWidth = stageRect.width + verticalDelta * ratio;
        }
        const constrained = this.constrainStageWidth(desiredWidth, ratio);
        this.setStageSize(constrained.width, constrained.height);
        const nextRect = this.ui.root.getBoundingClientRect();
        this.ui.root.style.left = `${direction.includes("w") ? rootRect.right - nextRect.width : rootRect.left}px`;
        this.ui.root.style.top = `${direction.includes("n") ? rootRect.bottom - nextRect.height : rootRect.top}px`;
        this.clampToViewport();
      };
      const stop = () => {
        this.ui.root.classList.remove("pfp-is-resizing");
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", stop, true);
        window.removeEventListener("pointercancel", stop, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
    }

    syncBookmarkState() {
      if (this.closed) return;
      const button = findBookmarkButton(this.illustId, this.sourceAnchor, this.sourceImage);
      this.bookmarkButton = button;
      if (button !== this.observedBookmarkButton) {
        this.bookmarkObserver?.disconnect();
        this.observedBookmarkButton = button;
        if (button) {
          this.bookmarkObserver?.observe(button, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["aria-pressed", "aria-label", "title", "class", "style", "fill", "stroke", "color", "data-state"]
          });
        }
      }
      const bookmarked = readBookmarkState(button);
      if (bookmarked !== null) {
        const isAwaitingExpectedState = this.bookmarkExpectedState !== null &&
          Date.now() < this.bookmarkExpectedUntil && bookmarked !== this.bookmarkExpectedState;
        if (!isAwaitingExpectedState) {
          this.bookmarked = bookmarked;
          this.bookmarkExpectedState = null;
          this.bookmarkExpectedUntil = 0;
        }
      }
      this.ui.bookmark.disabled = !this.sticky || !button;
      this.ui.bookmark.classList.toggle("pfp-is-bookmarked", this.bookmarked);
      this.ui.bookmark.setAttribute("aria-pressed", String(this.bookmarked));
      this.ui.bookmark.title = button ? (this.bookmarked ? t("unbookmark") : t("bookmark"))
        : t("bookmarkUnavailable");
      this.ui.bookmark.setAttribute("aria-label", this.ui.bookmark.title);
    }

    toggleBookmark() {
      if (!this.sticky || performance.now() < this.toolClickBlockedUntil) return;
      const button = findBookmarkButton(this.illustId, this.sourceAnchor, this.sourceImage);
      if (!button) {
        this.syncBookmarkState();
        return;
      }
      this.bookmarkButton = button;
      const sourceState = readBookmarkState(button);
      this.bookmarked = !(sourceState ?? this.bookmarked);
      this.bookmarkExpectedState = this.bookmarked;
      this.bookmarkExpectedUntil = Date.now() + 3000;
      this.ui.bookmark.classList.toggle("pfp-is-bookmarked", this.bookmarked);
      this.ui.bookmark.setAttribute("aria-pressed", String(this.bookmarked));
      this.ui.bookmark.title = this.bookmarked ? t("unbookmark") : t("bookmark");
      this.ui.bookmark.setAttribute("aria-label", this.ui.bookmark.title);
      button.click();
      this.manager.scheduleBookmarkSync(this.illustId);
    }

    handleResizeObserved() {
      if (this.closed || !this.ui.root.classList.contains("pfp-is-visible")) return;
      if (this.sticky) this.clampToViewport();
      else this.reposition();
    }

    cancelPendingImageLoads() {
      for (const cancel of [...this.pendingImageLoads.keys()]) cancel();
      this.pendingImageLoads.clear();
    }

    cancelOriginalLoads() {
      for (const [cancel, kind] of [...this.pendingImageLoads.entries()]) if (kind === "original") cancel();
    }

    clearOriginalTimer() {
      if (this.originalTimer) {
        clearTimeout(this.originalTimer);
        this.originalTimer = 0;
      }
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      ++this.requestRevision;
      ++this.renderRevision;
      this.abortController?.abort();
      this.abortController = null;
      this.clearOriginalTimer();
      this.cancelPendingImageLoads();
      this.resizeObserver?.disconnect();
      this.bookmarkObserver?.disconnect();
      clearTimeout(this.bookmarkObserverTimer);
      const rect = this.ui.stage.getBoundingClientRect();
      this.ui.stage.classList.add("pfp-no-size-transition");
      this.ui.stage.style.width = `${rect.width}px`;
      this.ui.stage.style.height = `${rect.height}px`;
      this.ui.root.classList.remove("pfp-is-visible", "pfp-is-positioning");
      this.ui.root.setAttribute("aria-hidden", "true");
      window.setTimeout(() => this.ui.root.remove(), EXIT_CLEANUP_DELAY_MS);
    }
  }

  class PreviewManager {
    constructor() {
      this.hoverCandidate = null;
      this.hoverTimer = 0;
      this.hoverWindow = null;
      this.pinnedByIllustId = new Map();
      this.activeWindow = null;
      this.pointerX = 0;
      this.pointerY = 0;
      this.zIndex = 2147480000;
      this.leaveTimer = 0;
      this.leaveWindow = null;
      this.bookmarkSyncRevision = 0;
      this.nazurinQueue = [];
      this.nazurinPendingIds = new Set();
      this.nazurinProcessing = false;
      this.nazurinQueueRevision = 0;
      this.nazurinDelayTimer = 0;
      this.nazurinDelayResolve = null;
      this.nazurinCurrentRequestId = null;
      this.nazurinStats = null;
      this.nazurinStates = new Map();
      this.nazurinToast = null;
      this.nazurinToastTimer = 0;
      this.escapeHistory = null;
      this.escapeHistoryTimer = 0;
    }

    beginHover(candidate) {
      const isSameCandidate = this.hoverCandidate?.anchor === candidate.anchor &&
        this.hoverCandidate.illustId === candidate.illustId;
      if (isSameCandidate && (this.hoverTimer || this.hoverWindow?.illustId === candidate.illustId ||
          this.pinnedByIllustId.has(candidate.illustId))) {
        this.clearLeaveTimer();
        return;
      }
      this.clearHoverTimer();
      this.clearLeaveTimer();
      if (this.hoverWindow?.illustId === candidate.illustId) {
        this.hoverCandidate = candidate;
        return;
      }
      this.hoverCandidate = candidate;
      this.hoverTimer = window.setTimeout(() => {
        this.hoverTimer = 0;
        const current = this.hoverCandidate;
        if (!current) return;
        const previous = this.hoverWindow;
        const pinned = this.pinnedByIllustId.get(current.illustId);
        if (pinned) {
          if (previous && previous !== pinned) this.closeWindow(previous);
          this.hoverWindow = null;
          this.hoverCandidate = current;
          this.bringToFront(pinned);
          return;
        }
        this.discardEscapeHistory();
        const preview = new PreviewWindow(this, current, this.pointerX, this.pointerY);
        this.hoverWindow = preview;
        if (previous && previous !== preview) this.closeWindow(previous);
        this.activeWindow = preview;
        preview.open();
      }, hoverDelayMs);
    }

    handlePointerOver(event) {
      const candidate = findArtworkCandidate(event.target, event.clientX, event.clientY);
      if (!candidate) return;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.beginHover(candidate);
    }

    handlePointerMove(event) {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      const preview = this.hoverWindow;
      if (!occludedSwitchEnabled || !preview || preview.sticky ||
          !(event.target instanceof Element) || !preview.ui.root.contains(event.target)) return;
      this.handleOccludedArtworkAtPoint(preview, event.clientX, event.clientY);
    }

    handleOccludedArtworkAtPoint(preview, clientX, clientY) {
      if (!occludedSwitchEnabled || preview !== this.hoverWindow || preview.sticky) return;
      const candidate = findUnderlyingArtworkCandidate(clientX, clientY);
      if (candidate && candidate.illustId !== preview.illustId) {
        this.beginHover(candidate);
        return;
      }
      this.cancelPendingSwitch(preview);
    }

    cancelPendingSwitch(preview = this.hoverWindow) {
      if (!preview || !this.hoverTimer || this.hoverCandidate?.illustId === preview.illustId) return;
      this.clearHoverTimer();
      this.hoverCandidate = {
        anchor: preview.sourceAnchor,
        image: preview.sourceImage,
        illustId: preview.illustId
      };
    }

    handlePointerOut(event) {
      if (!(event.target instanceof Node)) return;
      const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const relatedCandidate = related
        ? findArtworkCandidate(related, event.clientX, event.clientY)
        : null;

      const pendingAnchor = this.hoverCandidate?.anchor;
      if (pendingAnchor?.contains(event.target) && pendingAnchor !== this.hoverWindow?.sourceAnchor &&
          !(event.relatedTarget instanceof Node && pendingAnchor.contains(event.relatedTarget))) {
        if (relatedCandidate) {
          this.beginHover(relatedCandidate);
        } else {
          this.clearHoverTimer();
          this.hoverCandidate = null;
          this.scheduleHoverClose(this.hoverWindow);
        }
      }

      const preview = this.hoverWindow;
      if (!preview || preview.sticky || !preview.sourceAnchor.contains(event.target) ||
          (event.relatedTarget instanceof Node && preview.sourceAnchor.contains(event.relatedTarget))) return;
      if (related && preview.ui.root.contains(related)) {
        this.clearLeaveTimer();
      } else if (relatedCandidate && relatedCandidate.illustId !== preview.illustId) {
        this.beginHover(relatedCandidate);
      } else {
        this.scheduleHoverClose(preview);
      }
    }

    handlePreviewPointerEnter(preview, event) {
      if (preview !== this.hoverWindow || preview.sticky) return;
      this.clearLeaveTimer();
      this.handleOccludedArtworkAtPoint(preview, event.clientX, event.clientY);
    }

    handlePreviewPointerLeave(preview, event) {
      if (preview !== this.hoverWindow || preview.sticky) return;
      const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (related && preview.sourceAnchor.contains(related)) {
        this.cancelPendingSwitch(preview);
        this.clearLeaveTimer();
        return;
      }
      const candidate = related ? findArtworkCandidate(related, event.clientX, event.clientY) : null;
      if (candidate && candidate.illustId !== preview.illustId) this.beginHover(candidate);
      else {
        this.cancelPendingSwitch(preview);
        this.scheduleHoverClose(preview);
      }
    }

    scheduleHoverClose(preview) {
      if (!preview || preview.closed || preview.sticky || preview !== this.hoverWindow) return;
      this.clearLeaveTimer();
      this.leaveWindow = preview;
      this.leaveTimer = window.setTimeout(() => {
        this.leaveTimer = 0;
        const target = this.leaveWindow;
        this.leaveWindow = null;
        if (!target || target.closed || target.sticky || target !== this.hoverWindow) return;
        const pointed = document.elementFromPoint(this.pointerX, this.pointerY);
        if (pointed instanceof Node && (target.ui.root.contains(pointed) || target.sourceAnchor.contains(pointed))) return;
        this.closeWindow(target);
      }, hoverResidueMs);
    }

    clearLeaveTimer() {
      if (this.leaveTimer) clearTimeout(this.leaveTimer);
      this.leaveTimer = 0;
      this.leaveWindow = null;
    }

    pinHoverWindow({ suppressTools = false } = {}) {
      const preview = this.hoverWindow;
      if (!preview || preview.closed) return false;
      if (suppressTools) preview.toolClickBlockedUntil = performance.now() + 350;
      preview.pin();
      this.clearLeaveTimer();
      this.hoverWindow = null;
      this.hoverCandidate = null;
      this.activeWindow = preview;
      return true;
    }

    pinWindowFromClick(preview, options = {}) {
      if (preview !== this.hoverWindow || preview.closed || preview.sticky) return;
      this.pinHoverWindow(options);
    }

    toggleWindowSticky(preview) {
      if (!preview || preview.closed) return;
      if (preview.sticky) preview.unpin();
      else if (preview === this.hoverWindow) this.pinHoverWindow();
    }

    registerPinned(preview) {
      const existing = this.pinnedByIllustId.get(preview.illustId);
      if (existing && existing !== preview) this.closeWindow(existing);
      this.pinnedByIllustId.set(preview.illustId, preview);
      this.bringToFront(preview);
    }

    registerUnpinned(preview) {
      if (this.pinnedByIllustId.get(preview.illustId) === preview) this.pinnedByIllustId.delete(preview.illustId);
      if (this.hoverWindow && this.hoverWindow !== preview) this.closeWindow(this.hoverWindow);
      this.hoverWindow = preview;
      this.hoverCandidate = {
        anchor: preview.sourceAnchor,
        image: preview.sourceImage,
        illustId: preview.illustId
      };
      this.bringToFront(preview);
      const pointed = document.elementFromPoint(this.pointerX, this.pointerY);
      if (!(pointed instanceof Node) || (!preview.ui.root.contains(pointed) && !preview.sourceAnchor.contains(pointed))) {
        this.scheduleHoverClose(preview);
      }
    }

    unpinTopWindow() {
      const pinned = [...this.pinnedByIllustId.values()];
      if (pinned.length === 0) return false;
      const active = this.activeWindow?.sticky ? this.activeWindow : null;
      const top = active || pinned.reduce((highest, preview) =>
        Number(preview.ui.root.style.zIndex) > Number(highest.ui.root.style.zIndex) ? preview : highest);
      top.unpin();
      return true;
    }

    bringToFront(preview) {
      if (!preview || preview.closed) return;
      this.zIndex += 1;
      preview.ui.root.style.zIndex = String(this.zIndex);
      this.activeWindow = preview;
    }

    closeWindow(preview) {
      if (!preview || preview.closed) return;
      if (this.leaveWindow === preview) this.clearLeaveTimer();
      if (this.hoverWindow === preview) {
        this.hoverWindow = null;
        if (this.hoverCandidate?.illustId === preview.illustId &&
            this.hoverCandidate?.anchor === preview.sourceAnchor) {
          this.hoverCandidate = null;
        }
      }
      if (this.pinnedByIllustId.get(preview.illustId) === preview) this.pinnedByIllustId.delete(preview.illustId);
      if (this.activeWindow === preview) {
        this.activeWindow = [...this.pinnedByIllustId.values()].reduce((highest, candidate) => {
          if (!highest) return candidate;
          return Number(candidate.ui.root.style.zIndex) > Number(highest.ui.root.style.zIndex) ? candidate : highest;
        }, null) || this.hoverWindow || null;
      }
      preview.close();
    }

    closeAll({ cancelNazurin = false } = {}) {
      this.clearHoverTimer();
      this.clearLeaveTimer();
      this.hoverCandidate = null;
      this.discardEscapeHistory();
      const previews = new Set([...(this.hoverWindow ? [this.hoverWindow] : []), ...this.pinnedByIllustId.values()]);
      this.hoverWindow = null;
      this.pinnedByIllustId.clear();
      this.activeWindow = null;
      for (const preview of previews) preview.close();
      if (cancelNazurin) this.cancelNazurinQueue();
    }

    suspendForEscape() {
      const windows = this.allWindows();
      if (!windows.length) return false;
      this.discardEscapeHistory();
      this.clearHoverTimer();
      this.clearLeaveTimer();
      const state = {
        windows: windows.map((preview) => ({
          preview,
          wasHover: preview === this.hoverWindow,
          wasActive: preview === this.activeWindow
        }))
      };
      this.escapeHistory = state;
      this.hoverCandidate = null;
      this.hoverWindow = null;
      this.pinnedByIllustId.clear();
      this.activeWindow = null;
      for (const { preview } of state.windows) {
        preview.ui.root.classList.remove("pfp-is-visible", "pfp-is-positioning");
        preview.ui.root.setAttribute("aria-hidden", "true");
      }
      this.escapeHistoryTimer = window.setTimeout(() => this.discardEscapeHistory(), ESCAPE_RESTORE_WINDOW_MS);
      return true;
    }

    restoreEscapeHistory() {
      const state = this.escapeHistory;
      if (!state) return false;
      clearTimeout(this.escapeHistoryTimer);
      this.escapeHistoryTimer = 0;
      this.escapeHistory = null;
      this.clearHoverTimer();
      this.clearLeaveTimer();
      this.hoverCandidate = null;
      let restoredActive = null;
      for (const entry of state.windows) {
        const preview = entry.preview;
        if (preview.closed) continue;
        preview.ui.root.classList.add("pfp-is-visible");
        preview.ui.root.classList.remove("pfp-is-positioning");
        preview.ui.root.setAttribute("aria-hidden", "false");
        if (preview.sticky) this.pinnedByIllustId.set(preview.illustId, preview);
        else if (entry.wasHover) {
          this.hoverWindow = preview;
          this.hoverCandidate = {
            anchor: preview.sourceAnchor,
            image: preview.sourceImage,
            illustId: preview.illustId
          };
        }
        if (entry.wasActive) restoredActive = preview;
        const nazurinState = this.nazurinStates.get(preview.illustId);
        preview.setNazurinState(
          nazurinState?.state || preview.nazurinState,
          nazurinState?.message || preview.nazurinMessage
        );
        preview.syncBookmarkState();
        preview.applyOriginalSetting();
        preview.clampToViewport();
      }
      this.activeWindow = restoredActive || this.topmostWindow();
      return true;
    }

    discardEscapeHistory() {
      clearTimeout(this.escapeHistoryTimer);
      this.escapeHistoryTimer = 0;
      const state = this.escapeHistory;
      this.escapeHistory = null;
      if (!state) return false;
      for (const { preview } of state.windows) preview.close();
      return true;
    }

    clearHoverTimer() {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = 0;
      }
    }

    scheduleBookmarkSync(illustId = null) {
      const revision = ++this.bookmarkSyncRevision;
      const sync = () => {
        if (revision !== this.bookmarkSyncRevision) return;
        for (const preview of this.allWindows()) {
          if (!illustId || preview.illustId === illustId) preview.syncBookmarkState();
        }
      };
      for (const delay of [80, 220, 500, 1000, 1800, 3200]) window.setTimeout(sync, delay);
    }

    allWindows() {
      return [...new Set([...(this.hoverWindow ? [this.hoverWindow] : []), ...this.pinnedByIllustId.values()])];
    }

    topmostWindow(windows = this.allWindows()) {
      return windows.filter((preview) => preview && !preview.closed).reduce((top, preview) => {
        if (!top) return preview;
        return Number(preview.ui.root.style.zIndex) > Number(top.ui.root.style.zIndex) ? preview : top;
      }, null);
    }

    enqueueNazurin(previews) {
      if (!nazurinEnabled) return false;
      const candidates = previews.filter((preview) => preview && !preview.closed);
      let added = 0;
      for (const preview of candidates) {
        if (this.nazurinPendingIds.has(preview.illustId)) continue;
        this.nazurinPendingIds.add(preview.illustId);
        this.nazurinQueue.push({ illustId: preview.illustId });
        this.setNazurinStateForArtwork(preview.illustId, "queued");
        added += 1;
      }
      if (!added) {
        if (candidates.length) this.showNazurinToast(t("alreadyQueued"), "neutral");
        return false;
      }
      if (!this.nazurinProcessing) {
        this.nazurinStats = { accepted: 0, failed: 0, skipped: 0 };
        this.processNazurinQueue(++this.nazurinQueueRevision);
      }
      return true;
    }

    async processNazurinQueue(revision) {
      this.nazurinProcessing = true;
      let needsGap = false;
      let globalFailureMessage = "";
      while (revision === this.nazurinQueueRevision && this.nazurinQueue.length) {
        if (needsGap && !await this.waitForNazurinGap(revision)) return;
        const item = this.nazurinQueue.shift();
        if (!item || revision !== this.nazurinQueueRevision) return;
        const requestId = `naz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.nazurinCurrentRequestId = requestId;
        this.setNazurinStateForArtwork(item.illustId, "sending");
        const response = await requestNazurinSubmit(item.illustId, requestId);
        if (revision !== this.nazurinQueueRevision) return;
        this.nazurinCurrentRequestId = null;
        this.nazurinPendingIds.delete(item.illustId);
        if (response?.ok && response.status === "accepted") {
          this.nazurinStats.accepted += 1;
          this.setNazurinStateForArtwork(item.illustId, "accepted");
        } else {
          this.nazurinStats.failed += 1;
          const message = this.nazurinFailureMessage(response);
          this.setNazurinStateForArtwork(item.illustId, "error", message);
          if (NAZURIN_GLOBAL_FAILURES.has(response?.status)) {
            const unsent = this.nazurinQueue.splice(0);
            this.nazurinStats.skipped += unsent.length;
            for (const queued of unsent) {
              this.nazurinPendingIds.delete(queued.illustId);
              this.setNazurinStateForArtwork(queued.illustId, "error", t("unsentOpenSettings"));
            }
            globalFailureMessage = `${message}; ${t("openSettings")}`;
            break;
          }
        }
        needsGap = true;
      }
      if (revision !== this.nazurinQueueRevision) return;
      this.nazurinProcessing = false;
      this.nazurinCurrentRequestId = null;
      const stats = this.nazurinStats || { accepted: 0, failed: 0, skipped: 0 };
      this.showNazurinToast(
        t("queueSummary", stats) + (globalFailureMessage ? `; ${globalFailureMessage}` : ""),
        stats.failed || stats.skipped ? "error" : "success"
      );
    }

    waitForNazurinGap(revision) {
      return new Promise((resolve) => {
        this.nazurinDelayResolve = resolve;
        this.nazurinDelayTimer = window.setTimeout(() => {
          this.nazurinDelayTimer = 0;
          this.nazurinDelayResolve = null;
          resolve(revision === this.nazurinQueueRevision);
        }, NAZURIN_QUEUE_GAP_MS);
      });
    }

    cancelNazurinQueue() {
      ++this.nazurinQueueRevision;
      if (this.nazurinDelayTimer) clearTimeout(this.nazurinDelayTimer);
      this.nazurinDelayTimer = 0;
      this.nazurinDelayResolve?.(false);
      this.nazurinDelayResolve = null;
      if (this.nazurinCurrentRequestId) {
        globalThis.chrome?.runtime?.sendMessage?.({
          type: "pfp-cancel-nazurin",
          requestId: this.nazurinCurrentRequestId
        });
      }
      this.nazurinCurrentRequestId = null;
      this.nazurinQueue = [];
      for (const illustId of this.nazurinPendingIds) {
        this.setNazurinStateForArtwork(illustId, "idle");
      }
      this.nazurinPendingIds.clear();
      this.nazurinProcessing = false;
      this.nazurinStats = null;
      this.removeNazurinToast();
    }

    setNazurinStateForArtwork(illustId, state, message = "") {
      this.nazurinStates.set(illustId, { state, message });
      for (const preview of this.allWindows()) {
        if (preview.illustId === illustId) preview.setNazurinState(state, message);
      }
    }

    nazurinFailureMessage(response) {
      const messages = {
        "not-configured": t("nazurinNotConfigured"),
        "not-verified": t("nazurinNotVerified"),
        "permission-missing": t("nazurinPermissionMissing"),
        timeout: t("nazurinTimeout"),
        "network-error": t("nazurinNetworkError"),
        "http-error": response?.message || t("nazurinHttpError"),
        "api-error": response?.message ? `Nazurin: ${response.message}` : t("apiError"),
        "invalid-response": t("nazurinInvalidResponse")
      };
      return messages[response?.status] || t("nazurinSubmitFailed");
    }

    setNazurinEnabled(enabled) {
      nazurinEnabled = enabled === true;
      if (!nazurinEnabled) this.cancelNazurinQueue();
      for (const preview of this.allWindows()) preview.setNazurinState(preview.nazurinState, preview.nazurinMessage);
    }

    showNazurinToast(message, tone = "neutral") {
      this.removeNazurinToast();
      const toast = createElement("div", "pfp-nazurin-toast", message);
      toast.dataset.tone = tone;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.documentElement.append(toast);
      this.nazurinToast = toast;
      requestAnimationFrame(() => toast.classList.add("pfp-is-visible"));
      this.nazurinToastTimer = window.setTimeout(() => this.removeNazurinToast(), 3600);
    }

    removeNazurinToast() {
      if (this.nazurinToastTimer) clearTimeout(this.nazurinToastTimer);
      this.nazurinToastTimer = 0;
      const toast = this.nazurinToast;
      this.nazurinToast = null;
      if (!toast) return;
      toast.classList.remove("pfp-is-visible");
      window.setTimeout(() => toast.remove(), 160);
    }

    handleKeyDown(event) {
      if (isEditableElement(event.target)) return;
      if (event.key === "Escape") {
        if (event.repeat) return;
        if (this.escapeHistory || this.allWindows().length) {
          event.preventDefault();
          if (!this.restoreEscapeHistory()) this.suspendForEscape();
        }
        return;
      }
      if (this.allWindows().length === 0) return;
      const plainShortcut = !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (event.code === stickyShortcutCode && plainShortcut) {
        event.preventDefault();
        if (!this.pinHoverWindow()) this.unpinTopWindow();
        return;
      }
      if (nazurinEnabled && event.code === nazurinShortcutCode && !event.repeat &&
          !event.metaKey && !event.ctrlKey && !event.altKey) {
        const targets = event.shiftKey
          ? [...this.pinnedByIllustId.values()].sort((a, b) =>
              Number(b.ui.root.style.zIndex) - Number(a.ui.root.style.zIndex))
          : [this.topmostWindow()].filter(Boolean);
        if (targets.length) {
          event.preventDefault();
          this.enqueueNazurin(targets);
        }
        return;
      }
      const active = this.activeWindow;
      if (!active?.metadata) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        active.showPage(active.pageIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        active.showPage(active.pageIndex + 1);
      }
    }

    handleViewportResize() {
      for (const preview of this.allWindows()) {
        const page = preview.metadata?.pages[preview.pageIndex];
        if (page && !preview.userResized) preview.applyPageSize(page, { animate: false });
        preview.reposition();
      }
    }
  }

  function isEditableElement(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable);
  }

  const manager = new PreviewManager();

  async function initializeSettings() {
    const storageArea = globalThis.chrome?.storage?.sync;
    if (storageArea) {
      try {
        const stored = await storageArea.get({
          [settings.STORAGE_KEY]: settings.DEFAULT_HOVER_DELAY_MS,
          [settings.RESIDUE_STORAGE_KEY]: settings.DEFAULT_HOVER_RESIDUE_MS,
          [settings.OCCLUDED_SWITCH_STORAGE_KEY]: settings.DEFAULT_OCCLUDED_SWITCH_ENABLED,
          [settings.ORIGINAL_UPGRADE_STORAGE_KEY]: settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED,
          [settings.STICKY_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_STICKY_SHORTCUT_CODE,
          [settings.NAZURIN_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_NAZURIN_SHORTCUT_CODE
        });
        hoverDelayMs = settings.normalizeHoverDelay(stored[settings.STORAGE_KEY]);
        hoverResidueMs = settings.normalizeHoverResidue(stored[settings.RESIDUE_STORAGE_KEY]);
        occludedSwitchEnabled = settings.normalizeOccludedSwitch(stored[settings.OCCLUDED_SWITCH_STORAGE_KEY]);
        originalUpgradeEnabled = settings.normalizeOriginalUpgrade(stored[settings.ORIGINAL_UPGRADE_STORAGE_KEY]);
        stickyShortcutCode = settings.normalizeShortcutCode(
          stored[settings.STICKY_SHORTCUT_STORAGE_KEY], settings.DEFAULT_STICKY_SHORTCUT_CODE
        );
        nazurinShortcutCode = settings.normalizeShortcutCode(
          stored[settings.NAZURIN_SHORTCUT_STORAGE_KEY], settings.DEFAULT_NAZURIN_SHORTCUT_CODE
        );
      } catch {
        hoverDelayMs = settings.DEFAULT_HOVER_DELAY_MS;
        hoverResidueMs = settings.DEFAULT_HOVER_RESIDUE_MS;
        occludedSwitchEnabled = settings.DEFAULT_OCCLUDED_SWITCH_ENABLED;
        originalUpgradeEnabled = settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED;
        stickyShortcutCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
        nazurinShortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
      }
    }
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes[settings.STORAGE_KEY]) {
        hoverDelayMs = settings.normalizeHoverDelay(changes[settings.STORAGE_KEY].newValue);
      }
      if (changes[settings.RESIDUE_STORAGE_KEY]) {
        hoverResidueMs = settings.normalizeHoverResidue(changes[settings.RESIDUE_STORAGE_KEY].newValue);
      }
      if (changes[settings.OCCLUDED_SWITCH_STORAGE_KEY]) {
        occludedSwitchEnabled = settings.normalizeOccludedSwitch(
          changes[settings.OCCLUDED_SWITCH_STORAGE_KEY].newValue
        );
        if (!occludedSwitchEnabled) manager.cancelPendingSwitch();
      }
      if (changes[settings.ORIGINAL_UPGRADE_STORAGE_KEY]) {
        originalUpgradeEnabled = settings.normalizeOriginalUpgrade(changes[settings.ORIGINAL_UPGRADE_STORAGE_KEY].newValue);
        for (const preview of manager.allWindows()) preview.applyOriginalSetting();
      }
      if (changes[settings.STICKY_SHORTCUT_STORAGE_KEY]) {
        stickyShortcutCode = settings.normalizeShortcutCode(
          changes[settings.STICKY_SHORTCUT_STORAGE_KEY].newValue, settings.DEFAULT_STICKY_SHORTCUT_CODE
        );
        for (const preview of manager.allWindows()) {
          const key = settings.shortcutCodeLabel(stickyShortcutCode);
          preview.ui.stickyKey.textContent = key;
          if (!preview.sticky) {
            preview.ui.stickyHint.title = t("stickyTitle", { key });
            preview.ui.stickyHint.setAttribute("aria-label", preview.ui.stickyHint.title);
          }
        }
      }
      if (changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY]) {
        nazurinShortcutCode = settings.normalizeShortcutCode(
          changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY].newValue, settings.DEFAULT_NAZURIN_SHORTCUT_CODE
        );
      }
    });
    manager.setNazurinEnabled(await requestNazurinStatus());
    globalThis.chrome?.storage?.onChanged?.addListener((_changes, areaName) => {
      if (areaName === "local") requestNazurinStatus().then((enabled) => manager.setNazurinEnabled(enabled));
    });
  }

  document.addEventListener("pointerover", (event) => manager.handlePointerOver(event), true);
  document.addEventListener("pointermove", (event) => manager.handlePointerMove(event), {
    capture: true,
    passive: true
  });
  document.addEventListener("pointerout", (event) => manager.handlePointerOut(event), true);
  document.addEventListener("keydown", (event) => manager.handleKeyDown(event), true);
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || event.target.closest(".pfp-root")) return;
    if (event.target.closest("button")) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    try {
      const destination = new URL(anchor.href, window.location.href);
      if (destination.protocol === "http:" || destination.protocol === "https:") {
        manager.closeAll({ cancelNazurin: true });
      }
    } catch { /* Ignore malformed or script-only links. */ }
  }, true);
  window.addEventListener("resize", () => manager.handleViewportResize(), { passive: true });
  window.addEventListener("pagehide", () => manager.closeAll({ cancelNazurin: true }));
  window.addEventListener("beforeunload", () => manager.closeAll({ cancelNazurin: true }));
  window.addEventListener("popstate", () => manager.closeAll({ cancelNazurin: true }));
  window.addEventListener("hashchange", () => manager.closeAll({ cancelNazurin: true }));
  let bookmarkMutationQueued = false;
  const bookmarkObserver = new MutationObserver((mutations) => {
    if (bookmarkMutationQueued || !mutations.some((mutation) => !mutation.target.closest?.(".pfp-root"))) return;
    bookmarkMutationQueued = true;
    requestAnimationFrame(() => {
      bookmarkMutationQueued = false;
      manager.scheduleBookmarkSync();
    });
  });
  bookmarkObserver.observe(document.documentElement, {
    subtree: true,
    childList: true
  });

  initializeSettings();
})();
