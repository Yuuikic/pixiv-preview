(() => {
  "use strict";

  function cancelBackgroundRequest(message) {
    try {
      const pending = globalThis.chrome?.runtime?.sendMessage?.(message);
      pending?.catch?.(() => {});
    } catch { /* An unloaded extension cannot receive cancellation. */ }
  }

  function imageAnchorCandidate(element, clientX, clientY, adapter) {
    if (!(element instanceof Element) || element.closest(".pfp-root")) return null;
    const anchor = element.closest(adapter.anchorSelector);
    const work = anchor && adapter.workFromAnchor(anchor);
    if (!work) return null;
    const image = Array.from(anchor.querySelectorAll("img")).find((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width >= (adapter.minImageSize || 72) && rect.height >= (adapter.minImageSize || 72) &&
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    return image ? { anchor, image, work, workKey: work.key } : null;
  }

  // Site adapter contract:
  // - workFromAnchor -> {key, id, url}; key includes a site namespace.
  // - load(work, signal) -> {pages: [{regular, original, width, height}], degraded}.
  // - safeImageUrl and submissionMessage validate/translate site-specific data.
  // Optional bookmark, highlighting and shortcut policies add capabilities
  // without introducing site checks into window/queue/layout code.
  function start(adapter) {
    const session = globalThis.P2SiteSession;
    if (session && !session.claim("preview")) return null;
    const storageListener = (callback) => session ? session.storageListener(callback) :
      globalThis.chrome?.storage?.onChanged?.addListener(callback);
    if (window.top !== window || globalThis.P2PreviewInstance || document.querySelector(".pfp-root")) return null;
    const safeImageUrl = adapter.safeImageUrl;
    const findBookmarkButton = (work, anchor, image) => adapter.bookmark?.findButton(work, anchor, image) || null;
    const readBookmarkState = (button) => adapter.bookmark?.readState(button) ?? null;

    const settings = globalThis.PixivPreviewSettings;
    const i18n = globalThis.P2I18n;
    const t = i18n.t;
    const extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version || "development";
    const nazurinIconUrl = globalThis.chrome.runtime.getURL("assets/nazurin-48.png");
    const ORIGINAL_DELAY_MS = 700;
    const POINTER_GAP_PX = 16;
    const VIEWPORT_MARGIN_PX = 8;
    const MAX_PREVIEW_WIDTH_PX = 720;
    const MAX_STICKY_WIDTH_PX = 1200;
    const MIN_STICKY_WIDTH_PX = 320;
    const MIN_ARTWORK_SIZE_PX = adapter.minImageSize || 72;
    const CACHE_LIMIT = 100;
    const EXIT_CLEANUP_DELAY_MS = 140;
    const TOOLBAR_ESTIMATED_HEIGHT_PX = adapter.toolbar === false ? 0 : 43;
    const WINDOW_BORDER_PX = 2;
    const AUTO_DOCK_CONTENT_GAP_PX = 16;
    const AUTO_DOCK_WINDOW_GAP_PX = 8;
    const AUTO_DOCK_MIN_STAGE_WIDTH_PX = 220;
    const AUTO_DOCK_MAX_STAGE_WIDTH_PX = 360;
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
    let autoArrangeEnabled = settings.DEFAULT_AUTO_ARRANGE_ENABLED;
    let stickyShortcutCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
    let copyShortcutCode = settings.DEFAULT_COPY_SHORTCUT_CODE;
    let nazurinShortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
    let nazurinEnabled = false;
    let nazurinAutoHide = settings.DEFAULT_NAZURIN_AUTO_HIDE;

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

    function requestNazurinSubmit(work, requestId) {
      return new Promise((resolve) => {
        try {
        globalThis.chrome.runtime.sendMessage(
          adapter.submissionMessage(work, requestId),
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
        } catch {
          resolve({ ok: false, status: "network-error" });
        }
      });
    }

    function requestNazurinStatus(attempt = 0) {
      return new Promise((resolve) => {
        const retry = () => {
          if (attempt >= 3) return resolve(false);
          window.setTimeout(() => resolve(requestNazurinStatus(attempt + 1)), 500 * (attempt + 1));
        };
        try {
          globalThis.chrome.runtime.sendMessage({ type: "pfp-nazurin-status" }, (response) => {
            // A restored tab can run before the background is ready. Only retry
            // transport failures; a valid unverified status still disables tools.
            if (globalThis.chrome.runtime.lastError || typeof response?.verified !== "boolean" ||
                typeof response?.configured !== "boolean") return retry();
            resolve(response.configured && response.verified);
          });
        } catch {
          retry();
        }
      });
    }

    async function getArtworkMetadata(work, signal) {
      const cached = metadataCache.get(work.key);
      if (cached) return cached;
      const metadata = await adapter.load(work, signal);
      metadataCache.set(work.key, metadata);
      return metadata;
    }

    function findArtworkCandidate(element, clientX, clientY) {
      if (adapter.canPreview?.() === false) return null;
      return imageAnchorCandidate(element, clientX, clientY, adapter);
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

    function listen(target, type, callback, options) {
      const handler = trusted((event) => { if (!session || session.active) callback(event); });
      if (session && (target === window || target === document)) session.listen(target, type, handler, options);
      else target.addEventListener(type, handler, options);
    }

    class PreviewWindow {
      constructor(manager, candidate, anchorX, anchorY) {
        Object.assign(this, {
          manager,
          workKey: candidate.workKey,
          work: candidate.work,
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
          autoDocked: false,
          manualPlacement: false,
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
        this.bookmarkObserver = adapter.bookmark && typeof MutationObserver === "function"
          ? new MutationObserver(() => {
              clearTimeout(this.bookmarkObserverTimer);
              this.bookmarkObserverTimer = window.setTimeout(() => this.syncBookmarkState(), 60);
            })
          : null;
        this.ui = this.createUi();
        const savedNazurinState = this.manager.nazurinStates.get(this.workKey);
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
        root.dataset.workKey = this.workKey;

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
        toolbar.hidden = adapter.toolbar === false;
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
        bookmark.hidden = !adapter.bookmark;
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
        nazurinIcon.src = nazurinIconUrl;
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
        close.append(createSvgIcon("pfp-close-icon", "M6 6l12 12M18 6 6 18"));
        toolbar.append(status, pages, tools, stickyHint, close);
        root.append(stage, toolbar);

        for (const direction of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
          const handle = createElement("span", `pfp-resize-handle pfp-resize-${direction}`);
          handle.dataset.direction = direction;
          handle.setAttribute("aria-hidden", "true");
          root.append(handle);
          listen(handle, "pointerdown", (event) => this.startResize(event, direction));
        }

        listen(previous, "click", (event) => { event.stopPropagation(); this.showPage(this.pageIndex - 1); });
        listen(next, "click", (event) => { event.stopPropagation(); this.showPage(this.pageIndex + 1); });
        listen(bookmark, "click", (event) => { event.stopPropagation(); this.toggleBookmark(); });
        listen(open, "click", (event) => {
          event.stopPropagation();
          if (!this.sticky || performance.now() < this.toolClickBlockedUntil) return;
          window.open(this.work.url, "_blank", "noopener");
        });
        listen(nazurin, "click", (event) => {
          event.stopPropagation();
          if (!this.sticky || performance.now() < this.toolClickBlockedUntil ||
              this.nazurinState === "queued" || this.nazurinState === "sending") return;
          this.manager.enqueueNazurin([this]);
        });
        listen(close, "click", (event) => { event.stopPropagation(); this.manager.closeWindow(this); });
        listen(stickyHint, "click", (event) => {
          event.stopPropagation();
          this.manager.toggleWindowSticky(this);
        });
        listen(root, "pointerenter", (event) => this.manager.handlePreviewPointerEnter(this, event));
        listen(root, "pointerleave", (event) => this.manager.handlePreviewPointerLeave(this, event));
        listen(root, "pointerdown", (event) => {
          this.manager.bringToFront(this);
          if (!this.sticky && event.button === 0 && !event.target.closest(".pfp-sticky-hint")) {
            this.manager.pinWindowFromClick(this, { suppressTools: true });
          }
        });
        listen(root, "dblclick", (event) => {
          if (this.sticky && event.button === 0 && !event.target.closest("button")) {
            event.preventDefault();
            this.manager.closeWindow(this);
          }
        });
        listen(root, "wheel", (event) => this.handleWheel(event), { passive: false });
        listen(stage, "pointerdown", (event) => this.startDrag(event));
        listen(toolbar, "pointerdown", (event) => this.startDrag(event));
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
          const metadata = await getArtworkMetadata(this.work, controller.signal);
          if (!this.isCurrentRequest(revision)) return;
          this.metadata = metadata;
          await this.showPage(0);
        } catch (error) {
          if (error?.name === "AbortError" || !this.isCurrentRequest(revision)) return;
          if (this.thumbnailUrl) {
            this.metadata = {
              workKey: this.workKey,
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
          if (this.sticky && this.autoDocked && autoArrangeEnabled) {
            this.manager.scheduleAutoArrange();
            return;
          }
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

      applyAutoDockGeometry(left, top, stageWidth, stageHeight) {
        if (this.closed || !this.sticky) return;
        this.autoDocked = true;
        this.manualPlacement = false;
        this.userResized = true;
        this.userScale = stageWidth / this.baseStageWidth;
        this.ui.root.classList.add("pfp-is-auto-docked");
        this.ui.root.style.right = "auto";
        this.ui.root.style.left = `${Math.round(left)}px`;
        this.ui.root.style.top = `${Math.round(top)}px`;
        this.ui.root.style.width = `${stageWidth + WINDOW_BORDER_PX}px`;
        this.ui.stage.style.width = `${stageWidth}px`;
        this.ui.stage.style.height = `${stageHeight}px`;
      }

      releaseAutoDocking({ manual = false } = {}) {
        this.autoDocked = false;
        if (manual) this.manualPlacement = true;
        this.ui.root.classList.remove("pfp-is-auto-docked");
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
        this.releaseAutoDocking({ manual: true });
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
        this.releaseAutoDocking({ manual: true });
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
        let releaseCleanup = () => {};
        const stop = () => {
          releaseCleanup();
          this.ui.root.classList.remove("pfp-is-dragging");
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", stop, true);
          window.removeEventListener("pointercancel", stop, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", stop, true);
        window.addEventListener("pointercancel", stop, true);
        releaseCleanup = session?.onStop(stop) || (() => {});
        this.endPointerInteraction?.();
        this.endPointerInteraction = stop;
      }

      startResize(event, direction) {
        if (!this.sticky || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.releaseAutoDocking({ manual: true });
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
        let releaseCleanup = () => {};
        const stop = () => {
          releaseCleanup();
          this.ui.root.classList.remove("pfp-is-resizing");
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", stop, true);
          window.removeEventListener("pointercancel", stop, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", stop, true);
        window.addEventListener("pointercancel", stop, true);
        releaseCleanup = session?.onStop(stop) || (() => {});
        this.endPointerInteraction?.();
        this.endPointerInteraction = stop;
      }

      syncBookmarkState() {
        if (this.closed) return;
        const button = findBookmarkButton(this.work, this.sourceAnchor, this.sourceImage);
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
        const button = findBookmarkButton(this.work, this.sourceAnchor, this.sourceImage);
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
        this.manager.scheduleBookmarkSync(this.workKey);
      }

      handleResizeObserved() {
        if (this.closed || !this.ui.root.classList.contains("pfp-is-visible")) return;
        if (this.sticky && this.autoDocked && autoArrangeEnabled) return;
        else if (this.sticky) this.clampToViewport();
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
        this.endPointerInteraction?.();
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
        this.ui.root.classList.remove("pfp-is-visible", "pfp-is-positioning", "pfp-is-topmost");
        this.ui.root.setAttribute("aria-hidden", "true");
        window.setTimeout(() => this.ui.root.remove(), EXIT_CLEANUP_DELAY_MS);
      }
    }

    class PreviewManager {
      constructor() {
        this.hoverCandidate = null;
        this.hoverTimer = 0;
        this.hoverWindow = null;
        this.pinnedByWorkKey = new Map();
        this.activeWindow = null;
        this.pointerX = 0;
        this.pointerY = 0;
        this.pointerKnown = false;
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
        this.autoArrangeFrame = 0;
      }

      applySettings(values) {
        hoverDelayMs = settings.normalizeHoverDelay(values[settings.STORAGE_KEY]);
        hoverResidueMs = settings.normalizeHoverResidue(values[settings.RESIDUE_STORAGE_KEY]);
        stickyShortcutCode = settings.normalizeShortcutCode(values[settings.STICKY_SHORTCUT_STORAGE_KEY], stickyShortcutCode);
        autoArrangeEnabled = settings.normalizeAutoArrange(values[settings.AUTO_ARRANGE_STORAGE_KEY]);
      }

      highlightCandidate(candidate) {
        if (!adapter.highlightCandidates) return;
        const image = candidate?.image || null;
        if (this.highlightedImage === image) return;
        this.highlightedImage?.classList.remove("pfp-source-target");
        this.highlightedImage = image;
        image?.classList.add("pfp-source-target");
      }

      beginHover(candidate) {
        if (adapter.readSettings) this.applySettings(adapter.readSettings());
        this.highlightCandidate(candidate);
        if (!globalThis.chrome?.runtime?.id) return;
        const isSameCandidate = this.hoverCandidate?.anchor === candidate.anchor &&
          this.hoverCandidate.workKey === candidate.workKey;
        if (isSameCandidate && (this.hoverTimer || this.hoverWindow?.workKey === candidate.workKey ||
            this.pinnedByWorkKey.has(candidate.workKey))) {
          this.clearLeaveTimer();
          return;
        }
        this.clearHoverTimer();
        this.clearLeaveTimer();
        if (this.hoverWindow?.workKey === candidate.workKey) {
          this.hoverCandidate = candidate;
          return;
        }
        this.hoverCandidate = candidate;
        this.hoverTimer = window.setTimeout(() => {
          this.hoverTimer = 0;
          const current = this.hoverCandidate;
          if (!current) return;
          const previous = this.hoverWindow;
          const pinned = this.pinnedByWorkKey.get(current.workKey);
          if (pinned) {
            if (previous && previous !== pinned) this.closeWindow(previous);
            this.hoverWindow = null;
            this.hoverCandidate = current;
            this.bringToFront(pinned);
            return;
          }
          this.discardEscapeHistory();
          if (!globalThis.chrome?.runtime?.id) return;
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
        this.pointerKnown = true;
        this.beginHover(candidate);
      }

      handlePointerMove(event) {
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.pointerKnown = true;
        if (adapter.highlightCandidates && !event.target?.closest?.(".pfp-root")) {
          this.highlightCandidate(findArtworkCandidate(event.target, event.clientX, event.clientY));
        }
        const preview = this.hoverWindow;
        if (!occludedSwitchEnabled || !preview || preview.sticky ||
            !(event.target instanceof Element) || !preview.ui.root.contains(event.target)) return;
        this.handleOccludedArtworkAtPoint(preview, event.clientX, event.clientY);
      }

      handleOccludedArtworkAtPoint(preview, clientX, clientY) {
        if (!occludedSwitchEnabled || preview !== this.hoverWindow || preview.sticky) return;
        const candidate = findUnderlyingArtworkCandidate(clientX, clientY);
        if (candidate && candidate.workKey !== preview.workKey) {
          this.beginHover(candidate);
          return;
        }
        this.cancelPendingSwitch(preview);
      }

      cancelPendingSwitch(preview = this.hoverWindow) {
        if (!preview || !this.hoverTimer || this.hoverCandidate?.workKey === preview.workKey) return;
        this.clearHoverTimer();
        this.hoverCandidate = {
          anchor: preview.sourceAnchor,
          image: preview.sourceImage,
          workKey: preview.workKey,
          work: preview.work
        };
      }

      handlePointerOut(event) {
        if (!event.relatedTarget) this.pointerKnown = false;
        if (!(event.target instanceof Node)) return;
        const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        const relatedCandidate = related
          ? findArtworkCandidate(related, event.clientX, event.clientY)
          : null;

        if (!related?.closest(".pfp-root")) this.highlightCandidate(relatedCandidate);
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
        } else if (relatedCandidate && relatedCandidate.workKey !== preview.workKey) {
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
        if (candidate && candidate.workKey !== preview.workKey) this.beginHover(candidate);
        else {
          this.cancelPendingSwitch(preview);
          this.scheduleHoverClose(preview);
        }
      }

      scheduleHoverClose(preview) {
        if (adapter.readSettings) this.applySettings(adapter.readSettings());
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
        if (adapter.canPin?.() === false) return false;
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
        const existing = this.pinnedByWorkKey.get(preview.workKey);
        if (existing && existing !== preview) this.closeWindow(existing);
        this.pinnedByWorkKey.set(preview.workKey, preview);
        this.bringToFront(preview);
        this.scheduleAutoArrange();
      }

      registerUnpinned(preview) {
        if (this.pinnedByWorkKey.get(preview.workKey) === preview) this.pinnedByWorkKey.delete(preview.workKey);
        preview.releaseAutoDocking();
        this.scheduleAutoArrange();
        if (this.hoverWindow && this.hoverWindow !== preview) this.closeWindow(this.hoverWindow);
        this.hoverWindow = preview;
        this.hoverCandidate = {
          anchor: preview.sourceAnchor,
          image: preview.sourceImage,
          workKey: preview.workKey,
          work: preview.work
        };
        this.bringToFront(preview);
        const pointed = document.elementFromPoint(this.pointerX, this.pointerY);
        if (!(pointed instanceof Node) || (!preview.ui.root.contains(pointed) && !preview.sourceAnchor.contains(pointed))) {
          this.scheduleHoverClose(preview);
        }
      }

      unpinTopWindow() {
        const pinned = [...this.pinnedByWorkKey.values()];
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
        this.updateTopmostHighlight([...this.allWindows(), preview]);
      }

      updateTopmostHighlight(windows = this.allWindows()) {
        const top = this.topmostWindow(windows);
        for (const preview of windows) {
          preview.ui.root.classList.toggle("pfp-is-topmost", preview === top);
        }
      }

      closeWindow(preview) {
        if (!preview || preview.closed) return;
        if (this.leaveWindow === preview) this.clearLeaveTimer();
        if (this.hoverWindow === preview) {
          this.hoverWindow = null;
          if (this.hoverCandidate?.workKey === preview.workKey &&
              this.hoverCandidate?.anchor === preview.sourceAnchor) {
            this.hoverCandidate = null;
          }
        }
        if (this.pinnedByWorkKey.get(preview.workKey) === preview) this.pinnedByWorkKey.delete(preview.workKey);
        if (this.activeWindow === preview) {
          this.activeWindow = [...this.pinnedByWorkKey.values()].reduce((highest, candidate) => {
            if (!highest) return candidate;
            return Number(candidate.ui.root.style.zIndex) > Number(highest.ui.root.style.zIndex) ? candidate : highest;
          }, null) || this.hoverWindow || null;
        }
        preview.close();
        this.updateTopmostHighlight();
        this.scheduleAutoArrange();
      }

      closeAll({ cancelNazurin = false } = {}) {
        this.highlightCandidate(null);
        this.pointerKnown = false;
        this.clearHoverTimer();
        this.clearLeaveTimer();
        this.hoverCandidate = null;
        this.discardEscapeHistory();
        const previews = new Set([...(this.hoverWindow ? [this.hoverWindow] : []), ...this.pinnedByWorkKey.values()]);
        this.hoverWindow = null;
        this.pinnedByWorkKey.clear();
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
        this.pinnedByWorkKey.clear();
        this.activeWindow = null;
        for (const { preview } of state.windows) {
          preview.ui.root.classList.remove("pfp-is-visible", "pfp-is-positioning", "pfp-is-topmost");
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
          if (preview.sticky) this.pinnedByWorkKey.set(preview.workKey, preview);
          else if (entry.wasHover) {
            this.hoverWindow = preview;
            this.hoverCandidate = {
              anchor: preview.sourceAnchor,
              image: preview.sourceImage,
              workKey: preview.workKey,
              work: preview.work
            };
          }
          if (entry.wasActive) restoredActive = preview;
          const nazurinState = this.nazurinStates.get(preview.workKey);
          preview.setNazurinState(
            nazurinState?.state || preview.nazurinState,
            nazurinState?.message || preview.nazurinMessage
          );
          preview.syncBookmarkState();
          preview.applyOriginalSetting();
          preview.clampToViewport();
        }
        this.activeWindow = restoredActive || this.topmostWindow();
        this.updateTopmostHighlight();
        this.scheduleAutoArrange();
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

      scheduleBookmarkSync(workKey = null) {
        const revision = ++this.bookmarkSyncRevision;
        const sync = () => {
          if (revision !== this.bookmarkSyncRevision) return;
          for (const preview of this.allWindows()) {
            if (!workKey || preview.workKey === workKey) preview.syncBookmarkState();
          }
        };
        for (const delay of [80, 220, 500, 1000, 1800, 3200]) window.setTimeout(sync, delay);
      }

      allWindows() {
        return [...new Set([...(this.hoverWindow ? [this.hoverWindow] : []), ...this.pinnedByWorkKey.values()])];
      }

      scheduleAutoArrange({ includeManual = false } = {}) {
        if (!autoArrangeEnabled) return;
        if (includeManual) {
          for (const preview of this.pinnedByWorkKey.values()) preview.manualPlacement = false;
        }
        if (this.autoArrangeFrame) cancelAnimationFrame(this.autoArrangeFrame);
        this.autoArrangeFrame = requestAnimationFrame(() => {
          this.autoArrangeFrame = 0;
          this.arrangePinnedWindows();
        });
      }

      stopAutoArrange() {
        if (this.autoArrangeFrame) cancelAnimationFrame(this.autoArrangeFrame);
        this.autoArrangeFrame = 0;
        for (const preview of this.pinnedByWorkKey.values()) preview.releaseAutoDocking();
      }

      visibleArtworkBounds() {
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const rectangles = [];
        for (const anchor of document.querySelectorAll(adapter.anchorSelector)) {
          if (!adapter.workFromAnchor(anchor)) continue;
          for (const image of anchor.querySelectorAll("img")) {
            const rect = image.getBoundingClientRect();
            if (rect.width < MIN_ARTWORK_SIZE_PX || rect.height < MIN_ARTWORK_SIZE_PX ||
                rect.right <= 0 || rect.left >= viewportWidth || rect.bottom <= 0 || rect.top >= viewportHeight) continue;
            rectangles.push(rect);
          }
        }
        if (!rectangles.length) return null;
        return {
          left: Math.max(0, Math.min(...rectangles.map((rect) => rect.left))),
          right: Math.min(viewportWidth, Math.max(...rectangles.map((rect) => rect.right)))
        };
      }

      arrangePinnedWindows() {
        if (!autoArrangeEnabled) return;
        const previews = [...this.pinnedByWorkKey.values()].filter((preview) =>
          !preview.closed && preview.sticky && !preview.manualPlacement
        );
        if (!previews.length) return;

        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const artworkBounds = this.visibleArtworkBounds();
        const minimumLaneWidth = AUTO_DOCK_MIN_STAGE_WIDTH_PX + WINDOW_BORDER_PX;
        const lanes = artworkBounds ? [
          { side: "left", left: VIEWPORT_MARGIN_PX,
            width: artworkBounds.left - AUTO_DOCK_CONTENT_GAP_PX - VIEWPORT_MARGIN_PX, items: [], load: 0 },
          { side: "right", left: artworkBounds.right + AUTO_DOCK_CONTENT_GAP_PX,
            width: viewportWidth - artworkBounds.right - AUTO_DOCK_CONTENT_GAP_PX - VIEWPORT_MARGIN_PX,
            items: [], load: 0 }
        ].filter((lane) => lane.width >= minimumLaneWidth) : [];

        if (!lanes.length) {
          for (const preview of previews) {
            preview.releaseAutoDocking();
            preview.clampToViewport();
          }
          return;
        }

        for (const preview of previews) {
          const stageRect = preview.ui.stage.getBoundingClientRect();
          const page = preview.metadata?.pages[preview.pageIndex];
          const dimensions = preview.pageDimensions(page);
          const declaredRatio = page ? dimensions.width / dimensions.height : 0;
          const ratio = Number.isFinite(declaredRatio) && declaredRatio > 0
            ? declaredRatio
            : stageRect.width > 0 && stageRect.height > 0 ? stageRect.width / stageRect.height : 1;
          const rootRect = preview.ui.root.getBoundingClientRect();
          const centerX = rootRect.left + rootRect.width / 2;
          const lane = lanes.reduce((best, candidate) => {
            const candidateDistance = Math.abs(centerX - (candidate.left + candidate.width / 2));
            const bestDistance = Math.abs(centerX - (best.left + best.width / 2));
            return candidate.load < best.load - 0.01 ||
              (Math.abs(candidate.load - best.load) <= 0.01 && candidateDistance < bestDistance)
              ? candidate : best;
          });
          lane.items.push({ preview, ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1 });
          lane.load += 1 / (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
        }

        const availableHeight = viewportHeight - VIEWPORT_MARGIN_PX * 2;
        for (const lane of lanes) {
          if (!lane.items.length) continue;
          const chromeHeights = lane.items.map(({ preview }) => {
            const rootRect = preview.ui.root.getBoundingClientRect();
            const stageRect = preview.ui.stage.getBoundingClientRect();
            return Math.max(TOOLBAR_ESTIMATED_HEIGHT_PX + WINDOW_BORDER_PX, rootRect.height - stageRect.height);
          });
          const chromeTotal = chromeHeights.reduce((sum, height) => sum + height, 0);
          const gapTotal = AUTO_DOCK_WINDOW_GAP_PX * Math.max(0, lane.items.length - 1);
          const widthForHeight = (availableHeight - chromeTotal - gapTotal) /
            lane.items.reduce((sum, item) => sum + 1 / item.ratio, 0);
          const maximumStageWidth = Math.min(AUTO_DOCK_MAX_STAGE_WIDTH_PX, lane.width - WINDOW_BORDER_PX);
          const individuallyFittedMinimum = Math.min(AUTO_DOCK_MIN_STAGE_WIDTH_PX,
            ...lane.items.map((item, index) =>
              Math.max(1, (availableHeight - chromeHeights[index]) * item.ratio)
            ));
          const stageWidth = Math.max(individuallyFittedMinimum,
            Math.min(maximumStageWidth, widthForHeight));
          const rootHeights = lane.items.map((item, index) =>
            stageWidth / item.ratio + chromeHeights[index]
          );
          const totalHeight = rootHeights.reduce((sum, height) => sum + height, 0) + gapTotal;
          const overlapStep = lane.items.length > 1 && totalHeight > availableHeight
            ? Math.max(32, (availableHeight - rootHeights.at(-1)) / (lane.items.length - 1))
            : null;
          let top = VIEWPORT_MARGIN_PX;
          lane.items.forEach(({ preview, ratio }, index) => {
            const stageHeight = rootHeights[index] - chromeHeights[index];
            const rootWidth = stageWidth + WINDOW_BORDER_PX;
            const left = lane.side === "left" ? lane.left : lane.left + lane.width - rootWidth;
            preview.applyAutoDockGeometry(left, top, stageWidth, stageHeight);
            top += overlapStep ?? rootHeights[index] + AUTO_DOCK_WINDOW_GAP_PX;
          });
        }
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
          if (this.nazurinPendingIds.has(preview.workKey)) continue;
          this.nazurinPendingIds.add(preview.workKey);
          this.nazurinQueue.push({ workKey: preview.workKey, work: preview.work });
          this.setNazurinStateForArtwork(preview.workKey, "queued");
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
        let lastFailureMessage = "";
        while (revision === this.nazurinQueueRevision && this.nazurinQueue.length) {
          if (needsGap && !await this.waitForNazurinGap(revision)) return;
          const item = this.nazurinQueue.shift();
          if (!item || revision !== this.nazurinQueueRevision) return;
          const requestId = `naz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          this.nazurinCurrentRequestId = requestId;
          this.setNazurinStateForArtwork(item.workKey, "sending");
          const response = await requestNazurinSubmit(item.work, requestId);
          if (revision !== this.nazurinQueueRevision) return;
          this.nazurinCurrentRequestId = null;
          this.nazurinPendingIds.delete(item.workKey);
          if (response?.ok && response.status === "accepted") {
            this.nazurinStats.accepted += 1;
            this.setNazurinStateForArtwork(item.workKey, "accepted");
            if (nazurinAutoHide) {
              for (const preview of this.allWindows()) {
                if (preview.workKey === item.workKey) this.closeWindow(preview);
              }
            }
          } else {
            this.nazurinStats.failed += 1;
            const message = this.nazurinFailureMessage(response);
            lastFailureMessage = message;
            this.setNazurinStateForArtwork(item.workKey, "error", message);
            if (NAZURIN_GLOBAL_FAILURES.has(response?.status)) {
              const unsent = this.nazurinQueue.splice(0);
              this.nazurinStats.skipped += unsent.length;
              for (const queued of unsent) {
                this.nazurinPendingIds.delete(queued.workKey);
                this.setNazurinStateForArtwork(queued.workKey, "error", t("unsentOpenSettings"));
              }
              globalFailureMessage = `${message}${t("statusSeparator")}${t("openSettings")}`;
              break;
            }
          }
          needsGap = true;
        }
        if (revision !== this.nazurinQueueRevision) return;
        this.nazurinProcessing = false;
        this.nazurinCurrentRequestId = null;
        const stats = this.nazurinStats || { accepted: 0, failed: 0, skipped: 0 };
        const singleSuccess = stats.accepted === 1 && !stats.failed && !stats.skipped;
        const singleFailure = !stats.accepted && stats.failed === 1 && !stats.skipped && lastFailureMessage;
        this.showNazurinToast(
          singleSuccess ? t("submissionSuccess") :
            singleFailure ? (globalFailureMessage || lastFailureMessage) :
            t("queueSummary", stats) + (globalFailureMessage ? `${t("statusSeparator")}${globalFailureMessage}` : ""),
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
        if (this.nazurinCurrentRequestId && adapter.cancelSubmissionMessage) {
          cancelBackgroundRequest(adapter.cancelSubmissionMessage(this.nazurinCurrentRequestId));
        }
        this.nazurinCurrentRequestId = null;
        this.nazurinQueue = [];
        for (const workKey of this.nazurinPendingIds) {
          this.setNazurinStateForArtwork(workKey, "idle");
        }
        this.nazurinPendingIds.clear();
        this.nazurinProcessing = false;
        this.nazurinStats = null;
        this.removeNazurinToast();
      }

      setNazurinStateForArtwork(workKey, state, message = "") {
        this.nazurinStates.set(workKey, { state, message });
        for (const preview of this.allWindows()) {
          if (preview.workKey === workKey) preview.setNazurinState(state, message);
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
        nazurinEnabled = enabled === true && adapter.nazurin !== false;
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

      async copyTopmostArtworkLink() {
        if (adapter.copyLink === false) return;
        const preview = this.topmostWindow();
        if (!preview) return;
        try {
          await navigator.clipboard.writeText(preview.work.url);
          this.showNazurinToast(t("linkCopied"));
        } catch {
          this.showNazurinToast(t("linkCopyFailed"), "error");
        }
      }

      handleKeyDown(event) {
        if (adapter.readSettings) this.applySettings(adapter.readSettings());
        if (this.pageActive === false || event.defaultPrevented || event.isComposing ||
            (adapter.requireTrustedEvents && (!event.isTrusted || !globalThis.chrome?.runtime?.id)) ||
            isEditableElement(event.target) || isEditableElement(document.activeElement)) return;
        if (adapter.nazurin !== false && adapter.resolveSubmission && nazurinEnabled && event.code === nazurinShortcutCode &&
            !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          const candidate = adapter.resolveSubmission(this);
          if (candidate) {
            event.preventDefault();
            this.enqueueNazurin([candidate]);
          }
          return;
        }
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
        if (adapter.copyLink !== false && event.code === copyShortcutCode && plainShortcut) {
          event.preventDefault();
          void this.copyTopmostArtworkLink();
          return;
        }
        if (adapter.canPin?.() !== false && event.code === stickyShortcutCode && plainShortcut) {
          event.preventDefault();
          if (!this.pinHoverWindow()) this.unpinTopWindow();
          return;
        }
        if (adapter.nazurin !== false && nazurinEnabled && event.code === nazurinShortcutCode && !event.repeat &&
            !event.metaKey && !event.ctrlKey && !event.altKey) {
          const targets = event.shiftKey
            ? [...this.pinnedByWorkKey.values()].sort((a, b) =>
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
        this.scheduleAutoArrange();
      }
    }

    function isEditableElement(element) {
      return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable) ||
        (element instanceof Element && Boolean(element.closest('[role="textbox"]')));
    }

    const manager = new PreviewManager();
    globalThis.P2PreviewInstance = { adapterId: adapter.id, manager };
    session?.onStop(() => {
      manager.pageActive = false;
      manager.setNazurinEnabled(false);
      manager.closeAll({ cancelNazurin: true });
      manager.highlightCandidate(null);
      manager.discardEscapeHistory();
      globalThis.P2PreviewInstance = null;
    });
    let statusRevision = 0;
    async function refreshNazurinState() {
      const revision = ++statusRevision;
      const enabled = adapter.nazurin === false ? false : await requestNazurinStatus();
      if (manager.pageActive !== false && revision === statusRevision) manager.setNazurinEnabled(enabled);
    }

    async function initializeSettings() {
      const storageArea = globalThis.chrome?.storage?.sync;
      if (storageArea) {
        try {
          const stored = await storageArea.get({
            [settings.STORAGE_KEY]: settings.DEFAULT_HOVER_DELAY_MS,
            [settings.RESIDUE_STORAGE_KEY]: settings.DEFAULT_HOVER_RESIDUE_MS,
            [settings.OCCLUDED_SWITCH_STORAGE_KEY]: settings.DEFAULT_OCCLUDED_SWITCH_ENABLED,
            [settings.ORIGINAL_UPGRADE_STORAGE_KEY]: settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED,
            [settings.AUTO_ARRANGE_STORAGE_KEY]: settings.DEFAULT_AUTO_ARRANGE_ENABLED,
            [settings.STICKY_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_STICKY_SHORTCUT_CODE,
            [settings.NAZURIN_AUTO_HIDE_STORAGE_KEY]: settings.DEFAULT_NAZURIN_AUTO_HIDE,
            [settings.COPY_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_COPY_SHORTCUT_CODE,
            [settings.NAZURIN_SHORTCUT_STORAGE_KEY]: settings.DEFAULT_NAZURIN_SHORTCUT_CODE
          });
          nazurinAutoHide = stored[settings.NAZURIN_AUTO_HIDE_STORAGE_KEY] === true;
          hoverDelayMs = settings.normalizeHoverDelay(stored[settings.STORAGE_KEY]);
          hoverResidueMs = settings.normalizeHoverResidue(stored[settings.RESIDUE_STORAGE_KEY]);
          occludedSwitchEnabled = settings.normalizeOccludedSwitch(stored[settings.OCCLUDED_SWITCH_STORAGE_KEY]);
          originalUpgradeEnabled = settings.normalizeOriginalUpgrade(stored[settings.ORIGINAL_UPGRADE_STORAGE_KEY]);
          autoArrangeEnabled = settings.normalizeAutoArrange(stored[settings.AUTO_ARRANGE_STORAGE_KEY]);
          stickyShortcutCode = settings.normalizeShortcutCode(
            stored[settings.STICKY_SHORTCUT_STORAGE_KEY], settings.DEFAULT_STICKY_SHORTCUT_CODE
          );
          copyShortcutCode = settings.normalizeShortcutCode(
            stored[settings.COPY_SHORTCUT_STORAGE_KEY], settings.DEFAULT_COPY_SHORTCUT_CODE
          );
          nazurinShortcutCode = settings.normalizeShortcutCode(
            stored[settings.NAZURIN_SHORTCUT_STORAGE_KEY], settings.DEFAULT_NAZURIN_SHORTCUT_CODE
          );
        } catch {
          hoverDelayMs = settings.DEFAULT_HOVER_DELAY_MS;
          hoverResidueMs = settings.DEFAULT_HOVER_RESIDUE_MS;
          occludedSwitchEnabled = settings.DEFAULT_OCCLUDED_SWITCH_ENABLED;
          originalUpgradeEnabled = settings.DEFAULT_ORIGINAL_UPGRADE_ENABLED;
          autoArrangeEnabled = settings.DEFAULT_AUTO_ARRANGE_ENABLED;
          stickyShortcutCode = settings.DEFAULT_STICKY_SHORTCUT_CODE;
          nazurinShortcutCode = settings.DEFAULT_NAZURIN_SHORTCUT_CODE;
          copyShortcutCode = settings.DEFAULT_COPY_SHORTCUT_CODE;
        }
      }
      if (session && !session.active) return;
      storageListener((changes, areaName) => {
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
        if (changes[settings.AUTO_ARRANGE_STORAGE_KEY]) {
          autoArrangeEnabled = settings.normalizeAutoArrange(changes[settings.AUTO_ARRANGE_STORAGE_KEY].newValue);
          if (autoArrangeEnabled) manager.scheduleAutoArrange({ includeManual: true });
          else manager.stopAutoArrange();
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
        if (changes[settings.NAZURIN_AUTO_HIDE_STORAGE_KEY]) {
          nazurinAutoHide = changes[settings.NAZURIN_AUTO_HIDE_STORAGE_KEY].newValue === true;
        }
        if (changes[settings.COPY_SHORTCUT_STORAGE_KEY]) {
          copyShortcutCode = settings.normalizeShortcutCode(
            changes[settings.COPY_SHORTCUT_STORAGE_KEY].newValue, settings.DEFAULT_COPY_SHORTCUT_CODE
          );
        }
        if (changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY]) {
          nazurinShortcutCode = settings.normalizeShortcutCode(
            changes[settings.NAZURIN_SHORTCUT_STORAGE_KEY].newValue, settings.DEFAULT_NAZURIN_SHORTCUT_CODE
          );
        }
      });
      storageListener((_changes, areaName) => {
        if (areaName === "local") void refreshNazurinState();
      });
      await refreshNazurinState();
    }

    const trusted = (callback) => (event) => {
      if (!adapter.requireTrustedEvents || (event.isTrusted && globalThis.chrome?.runtime?.id)) callback(event);
    };
    listen(document, "pointerover", trusted((event) => manager.handlePointerOver(event)), true);
    listen(document, "pointermove", trusted((event) => manager.handlePointerMove(event)), {
      capture: true,
      passive: true
    });
    listen(document, "pointerout", trusted((event) => manager.handlePointerOut(event)), true);
    listen(document, "keydown", (event) => manager.handleKeyDown(event), true);
    listen(document, "click", (event) => {
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
    listen(window, "blur", () => { manager.pointerKnown = false; manager.highlightCandidate(null); });
    listen(window, "resize", () => manager.handleViewportResize(), { passive: true });
    listen(window, "pagehide", () => {
      manager.pageActive = false;
      statusRevision += 1;
      manager.closeAll({ cancelNazurin: true });
    });
    listen(window, "pageshow", () => { manager.pageActive = true; void refreshNazurinState(); });
    listen(window, "focus", () => { void refreshNazurinState(); });
    listen(window, "beforeunload", () => manager.closeAll({ cancelNazurin: true }));
    listen(window, "popstate", () => manager.closeAll({ cancelNazurin: true }));
    listen(window, "hashchange", () => manager.closeAll({ cancelNazurin: true }));
    if (adapter.bookmark) {
    let bookmarkMutationQueued = false;
    const bookmarkObserver = new MutationObserver((mutations) => {
      if (bookmarkMutationQueued || !mutations.some((mutation) => !mutation.target.closest?.(".pfp-root"))) return;
      bookmarkMutationQueued = true;
      requestAnimationFrame(() => {
        bookmarkMutationQueued = false;
        manager.scheduleBookmarkSync();
      });
    });
    session?.onStop(() => bookmarkObserver.disconnect());
    bookmarkObserver.observe(document.documentElement, {
      subtree: true,
      childList: true
    });

    }

    initializeSettings();
    return manager;
  }

  globalThis.P2PreviewCore = Object.freeze({ start, imageAnchorCandidate, cancelRequest: cancelBackgroundRequest });
})();
