(() => {
  "use strict";

  // P2's product scope is independent of Nazurin's server-side site catalogue.
  const HOSTS = Object.freeze({
    pixiv: ["www.pixiv.net"],
    pixivision: ["pixivision.net", "www.pixivision.net"],
    danbooru: ["danbooru.donmai.us"],
    yandere: ["yande.re", "www.yande.re"],
    konachan: ["konachan.com", "www.konachan.com", "konachan.net", "www.konachan.net"],
    zerochan: ["zerochan.net", "www.zerochan.net"],
    twitter: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com", "mobile.twitter.com"]
  });
  function parseUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
    } catch { return null; }
  }
  function siteForUrl(value) {
    const url = parseUrl(value);
    return url && Object.keys(HOSTS).find((site) => HOSTS[site].includes(url.hostname)) || null;
  }
  function isBoardSourceUrl(value) {
    return ["danbooru", "yandere", "konachan", "zerochan"].includes(siteForUrl(value));
  }
  function scriptsForUrl(value) {
    const url = parseUrl(value);
    const site = siteForUrl(value);
    if (!site) return null;
    const base = ["src/site-session.js", "src/settings.js", "src/i18n.js", "src/nazurin-sites.js"];
    const linkOnly = site === "twitter" || site === "pixivision";
    const js = linkOnly ? [...base, "src/link-submit.js", `src/${site}.js`] :
      [...base, "src/preview-core.js", site === "pixiv" ? "src/content.js" : "src/board-preview.js"];
    return { origin: url.origin, matches: [`${url.origin}/*`], js,
      css: [linkOnly ? "src/link-submit.css" : "src/preview.css"],
      runAt: "document_idle", allFrames: false, persistAcrossSessions: true };
  }
  function targetUrl(value) {
    const url = parseUrl(value);
    if (!url) return null;
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname;
    let match;
    if (host === "pixiv.net" && (match = path.match(/^\/(?:en\/)?(?:artworks|i)\/(\d+)\/?$/))) {
      return `https://www.pixiv.net/artworks/${match[1]}`;
    }
    if (host === "danbooru.donmai.us" && (match = path.match(/^\/posts\/(\d+)\/?$/))) {
      return `https://${host}/posts/${match[1]}`;
    }
    if (["yande.re", "konachan.com", "konachan.net"].includes(host) &&
        (match = path.match(/^\/post\/show\/(\d+)(?:\/[^/]*)?\/?$/))) {
      return `https://${host === "konachan.net" ? "konachan.com" : host}/post/show/${match[1]}`;
    }
    if (host === "zerochan.net" && (match = path.match(/^\/(\d+)\/?$/))) {
      return `https://www.zerochan.net/${match[1]}`;
    }
    if (HOSTS.twitter.includes(url.hostname) &&
        (match = path.match(/^\/([a-zA-Z0-9_]{1,15}|i\/web)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/))) {
      return `https://twitter.com/${match[1]}/status/${match[2]}`;
    }
    return null;
  }
  const accessSites = Object.freeze([
    ["danbooru", "Danbooru"], ["yandere", "yande.re"], ["konachan", "Konachan"],
    ["zerochan", "Zerochan"], ["twitter", "Twitter/X"], ["pixivision", "pixivision"]
  ].map(([id, name]) => Object.freeze({ id, name,
    origins: Object.freeze(HOSTS[id].map((host) => `https://${host}`)) })));
  globalThis.P2NazurinSites = Object.freeze({ accessSites, siteForUrl, isBoardSourceUrl, scriptsForUrl,
    targetUrl, currentWorkUrl: targetUrl, normalizeTargetUrl: targetUrl });
})();
