(() => {
  "use strict";

  // Audited against y-young/nazurin 888af1e705f2e829995f9fc97aaab5a00fd7491a.
  // Page access is deliberately narrower than the upstream unanchored regexes.
  const LEGACY_SOURCE_HOSTS = Object.freeze([
    "www.pixiv.net", "x.com", "www.x.com", "twitter.com", "www.twitter.com",
    "pixivision.net", "www.pixivision.net"
  ]);
  const SOURCE_HOSTS = Object.freeze([
    "pixiv.net", "mobile.x.com", "mobile.twitter.com",
    "yande.re", "www.yande.re", "konachan.com", "www.konachan.com",
    "konachan.net", "www.konachan.net", "lolibooru.moe", "www.lolibooru.moe",
    "danbooru.donmai.us", "safebooru.donmai.us",
    "zerochan.net", "www.zerochan.net", "gelbooru.com", "www.gelbooru.com",
    "wallhaven.cc", "www.wallhaven.cc", "whvn.cc",
    "bilibili.com", "www.bilibili.com", "t.bilibili.com",
    "weibo.com", "www.weibo.com", "m.weibo.com",
    "weibo.cn", "www.weibo.cn", "m.weibo.cn", "share.api.weibo.cn",
    "kemono.party", "kemono.su", "kemono.cr", "telegra.ph", "graph.org", "bsky.app"
  ]);
  const USER_DOMAINS = Object.freeze(["artstation.com", "deviantart.com", "lofter.com"]);
  const SOURCE_MATCHES = Object.freeze([
    ...SOURCE_HOSTS.map((host) => `https://${host}/*`),
    ...USER_DOMAINS.map((host) => `https://*.${host}/*`)
  ]);
  const TARGET_HOSTS = new Set([
    ...SOURCE_HOSTS, "www.pixiv.net", "x.com", "www.x.com", "twitter.com", "www.twitter.com",
    "cdn.donmai.us", "files.yande.re", "files.konachan.com", "static.zerochan.net"
  ]);

  function isUserHost(host) {
    return USER_DOMAINS.some((base) => host === base ||
      (host.endsWith(`.${base}`) && /^[a-z0-9_-]+$/.test(host.slice(0, -base.length - 1))));
  }

  function parseUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) &&
        !url.username && !url.password && !url.port ? url : null;
    } catch {
      return null;
    }
  }

  function isGenericSourceUrl(value) {
    const url = parseUrl(value);
    return Boolean(url && url.protocol === "https:" &&
      !LEGACY_SOURCE_HOSTS.includes(url.hostname) &&
      (SOURCE_HOSTS.includes(url.hostname) || isUserHost(url.hostname)));
  }

  function targetUrl(value) {
    const url = parseUrl(value);
    if (!url) return null;
    const host = url.hostname;
    const imageHost = /^[a-z0-9-]+\.pximg\.net$/.test(host) ||
      /^(?:i(?:-f|\d*)|img\d+)\.pixiv\.net$/.test(host) ||
      /^s\d+\.zerochan\.net$/.test(host);
    return TARGET_HOSTS.has(host) || isUserHost(host) || imageHost ? url.href : null;
  }

  function normalizeTargetUrl(value, konachanNetToCom = true) {
    const target = targetUrl(value);
    if (!target) return null;
    const url = new URL(target);
    if (["konachan.net", "www.konachan.net"].includes(url.hostname)) {
      if (!konachanNetToCom) return null;
      url.hostname = "konachan.com";
    } else if (url.hostname === "www.konachan.com") {
      url.hostname = "konachan.com";
    }
    return url.href;
  }

  globalThis.P2NazurinSites = Object.freeze({
    LEGACY_SOURCE_HOSTS, SOURCE_MATCHES, isGenericSourceUrl, targetUrl, normalizeTargetUrl
  });
})();
