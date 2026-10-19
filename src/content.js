(() => {
  "use strict";
  if (globalThis.P2SiteSession && !globalThis.P2SiteSession.claim("content.js")) return;

  const MIN_ARTWORK_SIZE_PX = 72;
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
    return { pages, degraded: false };
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
        globalThis.P2PreviewCore.cancelRequest({ type: "pfp-cancel-pages", requestId });
        finish(reject, new DOMException("Metadata request cancelled", "AbortError"));
      };
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
      try {
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
      } catch (error) {
        finish(reject, error);
      }
    });
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


  function workFromAnchor(anchor) {
    const id = extractIllustId(anchor);
    return id ? { key: `pixiv:${id}`, id, url: `https://www.pixiv.net/artworks/${id}` } : null;
  }

  globalThis.P2PreviewCore.start({
    id: "pixiv",
    anchorSelector: 'a[href*="/artworks/"]',
    workFromAnchor,
    safeImageUrl,
    async load(work, signal) {
      return normalizeArtworkResponse(work.id, await requestArtworkPages(work.id, signal));
    },
    resolveSubmission(manager) {
      const url = globalThis.P2NazurinSites?.currentWorkUrl(window.location.href);
      if (url) {
        const id = new URL(url).pathname.split("/").pop();
        const work = { key: `pixiv:${id}`, id, url };
        return { work, workKey: work.key };
      }
      return manager.topmostWindow();
    },
    submissionMessage: (work, requestId) => ({ type: "pfp-nazurin-submit", illustId: work.id, requestId }),
    cancelSubmissionMessage: (requestId) => ({ type: "pfp-cancel-nazurin", requestId }),
    bookmark: {
      findButton: (work, anchor, image) => findBookmarkButton(work.id, anchor, image),
      readState: readBookmarkState
    }
  });
})();
