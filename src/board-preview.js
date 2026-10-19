(() => {
  "use strict";
  if (globalThis.P2SiteSession && !globalThis.P2SiteSession.claim("board-preview.js")) return;

  const sites = globalThis.P2NazurinSites;
  if (!sites.isBoardSourceUrl(location.href)) return;
  const family = sites.siteForUrl(location.href);
  const site = { yandere: "yande.re", konachan: "konachan.com",
    danbooru: "danbooru.donmai.us", zerochan: "www.zerochan.net" }[family];
  const anchorSelector = family === "danbooru" ? 'article.post-preview a[href*="/posts/"]' :
    family === "zerochan" ? 'a.thumb[href]' : "#post-list-posts a.thumb[href]";
  const imageHosts = new Set(family === "yandere"
    ? ["yande.re", "www.yande.re", "assets.yande.re", "files.yande.re"]
    : family === "konachan" ? ["konachan.com", "www.konachan.com", "konachan.net", "www.konachan.net",
      "files.konachan.com", "files.konachan.net"]
    : family === "danbooru" ? ["danbooru.donmai.us", "cdn.donmai.us"]
    : ["zerochan.net", "www.zerochan.net", "static.zerochan.net", "s1.zerochan.net", "s2.zerochan.net", "s3.zerochan.net"]);

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        imageHosts.has(url.hostname) ? url.href : null;
    } catch {
      return null;
    }
  }

  function workFromUrl(value) {
    const canonical = sites.targetUrl(value);
    if (!canonical) return null;
    const url = new URL(canonical);
    const match = url.pathname.match(family === "danbooru" ? /^\/posts\/(\d+)$/ :
      family === "zerochan" ? /^\/(\d+)$/ : /^\/post\/show\/(\d+)$/);
    return url.hostname === site && match
      ? { key: `${family}:${match[1]}`, id: match[1], url: canonical }
      : null;
  }

  function workFromAnchor(anchor) {
    return anchor instanceof HTMLAnchorElement ? workFromUrl(anchor.href) : null;
  }

  function currentWork() {
    return workFromUrl(sites.currentWorkUrl(location.href));
  }

  function normalizePost(work, payload) {
    let post = family === "danbooru" ? payload :
      Array.isArray(payload) && payload.find((item) => String(item?.id) === work.id);
    if (family === "danbooru") {
      if (!post || String(post.id) !== work.id || post.is_deleted || post.is_banned) throw new Error("Artwork metadata unavailable");
      post = { ...post, sample_url: post.large_file_url, sample_width: post.image_width,
        sample_height: post.image_height, width: post.image_width, height: post.image_height };
    }
    if (!post || post.status === "deleted") throw new Error("Artwork metadata unavailable");
    const display = [
      { url: safeImageUrl(post.sample_url), width: post.sample_width, height: post.sample_height },
      { url: safeImageUrl(post.jpeg_url), width: post.jpeg_width, height: post.jpeg_height },
      { url: /^(?:jpe?g|png|gif|webp|avif)$/i.test(post.file_ext || "") ? safeImageUrl(post.file_url) : null, width: post.width, height: post.height }
    ].find((image) => image.url);
    if (!display) throw new Error("Artwork metadata has no supported image URL");
    const original = /^(?:jpe?g|png|gif|webp|avif)$/i.test(post.file_ext || "")
      ? safeImageUrl(post.file_url) : null;
    const dimension = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
    return {
      pages: [{ regular: display.url, original,
        width: dimension(display.width), height: dimension(display.height) }],
      degraded: false
    };
  }

  async function load(work, signal) {
    if (signal.aborted) throw new DOMException("Metadata request cancelled", "AbortError");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 10000);
    try {
      // Keep requests on the enabled page origin; Konachan .net -> .com is
      // only a submission conversion. Fetch one selected work, never a list.
      const endpoint = new URL(family === "danbooru" ? `/posts/${work.id}.json` :
        family === "zerochan" ? `/${work.id}` : "/post.json", location.href);
      if (family === "yandere" || family === "konachan") {
        endpoint.searchParams.set("tags", `id:${work.id}`);
        endpoint.searchParams.set("limit", "1");
      }
      const response = await fetch(endpoint.href, {
        credentials: "same-origin", headers: { Accept: family === "zerochan" ? "text/html" : "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Artwork metadata request failed: ${response.status}`);
      if (response.url && new URL(response.url).origin !== endpoint.origin) throw new Error("Unexpected artwork redirect");
      if (family !== "zerochan") return normalizePost(work, await response.json());
      // Parse inert HTML. Never execute page scripts or attach fetched markup.
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      const canonical = page.querySelector('link[rel="canonical"]')?.getAttribute("href");
      if (sites.targetUrl(canonical) !== work.url) throw new Error("Artwork identity mismatch");
      const image = page.querySelector("#large a.preview img");
      const regular = safeImageUrl(image?.getAttribute("src"));
      const original = safeImageUrl(page.querySelector("#large a.preview")?.getAttribute("href"));
      if (!regular) throw new Error("Artwork metadata has no supported image URL");
      return { pages: [{ regular, original, width: Number(image.getAttribute("width")) || null,
        height: Number(image.getAttribute("height")) || null }], degraded: false };
    } catch (error) {
      // AbortError from a timeout is not a user-closed preview. Surface it as
      // a load failure so the core can stop the spinner and show a fallback.
      if (controller.signal.aborted && !signal.aborted) throw new Error("Artwork metadata request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  globalThis.P2PreviewCore.start({
    id: family,
    anchorSelector,
    minImageSize: 1,
    workFromAnchor,
    safeImageUrl,
    load,
    highlightCandidates: true,
    requireTrustedEvents: true,
    canPreview: () => !currentWork(),
    cancelSubmissionMessage: (requestId) => ({ type: "pfp-cancel-nazurin", requestId }),
    submissionMessage: (work, requestId) => ({ type: "pfp-nazurin-link-submit", url: work.url, requestId }),
    resolveSubmission(manager) {
      const current = currentWork();
      if (current) return { work: current, workKey: current.key };
      if (!manager.pointerKnown) return null;
      const pointed = document.elementFromPoint(manager.pointerX, manager.pointerY);
      const preview = manager.allWindows().find((item) => item.ui.root.contains(pointed));
      if (preview) return preview;
      const candidate = globalThis.P2PreviewCore.imageAnchorCandidate(
        pointed, manager.pointerX, manager.pointerY, { anchorSelector, workFromAnchor, minImageSize: 1 });
      if (candidate) return candidate;
      const anchor = pointed?.closest?.("a[href]");
      const work = anchor && workFromUrl(anchor.href);
      return work ? { work, workKey: work.key } : null;
    }
  });
})();
