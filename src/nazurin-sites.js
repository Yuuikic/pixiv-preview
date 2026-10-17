(() => {
  "use strict";

  // Audited against y-young/nazurin 888af1e705f2e829995f9fc97aaab5a00fd7491a.
  // Page access is deliberately narrower than the upstream unanchored regexes.
  const LEGACY_SOURCE_HOSTS = Object.freeze([
    "www.pixiv.net", "x.com", "www.x.com", "twitter.com", "www.twitter.com",
    "pixivision.net", "www.pixivision.net"
  ]);
  const SOURCE_HOSTS = Object.freeze([
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
    ...SOURCE_HOSTS, "pixiv.net", "www.pixiv.net", "x.com", "www.x.com", "twitter.com", "www.twitter.com",
    "mobile.x.com", "mobile.twitter.com", "cdn.donmai.us", "files.yande.re",
    "files.konachan.com", "files.konachan.net", "static.zerochan.net"
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

  // Read identifiers only from a parsed, allowlisted host and its own path/query.
  // Nazurin uses unanchored searches on the entire URL; copying those searches
  // would let a URL embedded in a tag/query select a different artwork.
  function resolveTarget(value) {
    const url = parseUrl(value);
    if (!url) return null;
    let host = url.hostname;
    const imageHost = /^[a-z0-9-]+\.pximg\.net$/.test(host) ||
      /^(?:i(?:-f|\d*)|img\d+)\.pixiv\.net$/.test(host) ||
      /^s\d+\.zerochan\.net$/.test(host);
    if (!TARGET_HOSTS.has(host) && !isUserHost(host) && !imageHost) return null;
    host = host.replace(/^www\./, "");
    const path = url.pathname;
    const work = (host, path) => ({ kind: "work", url: `https://${host}${path}` });
    const image = (target) => target && ({ ...target, kind: "image" });
    let match;

    if (["yande.re", "konachan.net", "konachan.com", "lolibooru.moe"].includes(host)) {
      if ((match = path.match(/^\/post\/show\/(\d+)(?:\/[^/]*)?\/?$/))) {
        return work(host === "konachan.net" ? "konachan.com" : host, `/post/show/${match[1]}`);
      }
    }
    if (["yande.re", "files.yande.re"].includes(host) &&
        (match = path.match(/^\/(?:image|jpeg|sample)\/[a-f0-9]{32}\/yande\.re%20(\d+)[^/]*\.[a-z0-9]+$/))) {
      return image(work("yande.re", `/post/show/${match[1]}`));
    }
    if (["konachan.com", "konachan.net", "files.konachan.com", "files.konachan.net"].includes(host) &&
        (match = path.match(/^\/(?:image|jpeg|sample)\/[a-f0-9]{32}\/Konachan\.(?:com|net)%20-%20(\d+)[^/]*\.[a-z0-9]+$/))) {
      return image(work("konachan.com", `/post/show/${match[1]}`));
    }
    if (host === "lolibooru.moe" &&
        (match = path.match(/^\/(?:image|jpeg|sample)\/[a-f0-9]{32}\/lolibooru%20(\d+)[^/]*\.[a-z0-9]+$/))) {
      return image(work(host, `/post/show/${match[1]}`));
    }
    if (["danbooru.donmai.us", "safebooru.donmai.us"].includes(host) &&
        (match = path.match(/^\/posts\/(\d+)\/?$/))) return work(host, `/posts/${match[1]}`);
    if ((host === "cdn.donmai.us" && /^\/\w+\/(?:[a-f0-9]{2}\/){2}[a-f0-9]{32}\.[a-z0-9]+$/.test(path)) ||
        (["danbooru.donmai.us", "safebooru.donmai.us"].includes(host) &&
          /^\/data\/(?:sample\/)?[^/]*[a-f0-9]{32}\.[a-z0-9]+$/.test(path))) {
      // A hash-only image URL has no post ID; retain the server-supported path.
      return { kind: "image", url: `https://${host}${path}` };
    }
    if (host === "zerochan.net" && (match = path.match(/^\/(\d+)\/?$/))) {
      return work("www.zerochan.net", `/${match[1]}`);
    }
    if (["zerochan.net", "static.zerochan.net"].includes(host) || /^s\d+\.zerochan\.net$/.test(host)) {
      if ((match = path.match(/^\/[^/]+\.(\d+)\.\w+$/))) return image(work("www.zerochan.net", `/${match[1]}`));
    }
    if (host === "gelbooru.com" && path === "/index.php" &&
        ["page", "s", "id"].every((key) => url.searchParams.getAll(key).length === 1) &&
        url.searchParams.get("page") === "post" && url.searchParams.get("s") === "view" &&
        /^\d+$/.test(url.searchParams.get("id"))) {
      return work(host, `/index.php?page=post&s=view&id=${url.searchParams.get("id")}`);
    }
    if ((host === "artstation.com" || host.endsWith(".artstation.com")) &&
        (match = path.match(/^\/(?:artwork|projects)\/([a-zA-Z0-9]+)\/?$/))) {
      return work("www.artstation.com", `/artwork/${match[1]}`);
    }
    if ((host === "wallhaven.cc" && (match = path.match(/^\/w\/([a-z0-9]{6})\/?$/))) ||
        (host === "whvn.cc" && (match = path.match(/^\/([a-z0-9]{6})\/?$/)) &&
          !["search", "latest", "random"].includes(match[1]))) return work("wallhaven.cc", `/w/${match[1]}`);
    if ((host === "t.bilibili.com" && (match = path.match(/^\/(?:h5\/dynamic\/detail\/)?(\d+)\/?$/))) ||
        (host === "bilibili.com" && (match = path.match(/^\/opus\/(\d+)\/?$/)))) {
      return work("t.bilibili.com", `/${match[1]}`);
    }
    if (["weibo.com", "weibo.cn", "m.weibo.com", "m.weibo.cn"].includes(host)) {
      match = path.match(/^\/\d+\/([a-zA-Z0-9]+)\/?$/);
      if (!match && host.startsWith("m.")) match = path.match(/^\/(?:detail|status)\/([a-zA-Z0-9]+)\/?$/);
      if (match) return work("m.weibo.cn", `/detail/${match[1]}`);
      if (host === "weibo.cn" && path === "/appurl" && /^\d+$/.test(url.searchParams.get("lfid"))) {
        return work("m.weibo.cn", `/detail/${url.searchParams.get("lfid")}`);
      }
    }
    if (host === "share.api.weibo.cn" && /^\/share\/\d+,\d+\.html$/.test(path) &&
        /^\d+$/.test(url.searchParams.get("weibo_id"))) {
      return work("m.weibo.cn", `/detail/${url.searchParams.get("weibo_id")}`);
    }
    if (host === "deviantart.com" || host.endsWith(".deviantart.com")) {
      if (host === "deviantart.com" && (match = path.match(/^\/([\w-]+)\/art\/([\w-]+-\d+)\/?$/))) {
        return work("www.deviantart.com", `/${match[1]}/art/${match[2]}`);
      }
      if (/^[\w-]+\.deviantart\.com$/.test(host) && (match = path.match(/^\/art\/([\w-]+-\d+)\/?$/))) {
        return work("www.deviantart.com", `/${host.split(".")[0]}/art/${match[1]}`);
      }
    }
    if (/^\w+\.lofter\.com$/.test(host) && (match = path.match(/^\/post\/(\w+)\/?$/))) {
      return work(host, `/post/${match[1]}`);
    }
    if (["kemono.party", "kemono.su", "kemono.cr"].includes(host) &&
        (match = path.match(/^\/(\w+)\/user\/([\w-]+)\/post\/([\w-]+)(?:\/revision\/(\d+))?\/?$/))) {
      return work(host, `/${match[1]}/user/${match[2]}/post/${match[3]}${match[4] ? `/revision/${match[4]}` : ""}`);
    }
    if (["telegra.ph", "graph.org"].includes(host) && /^\/[\w%-]+\/?$/.test(path) &&
        !/^\/(?:auth|login|file|settings|feedback)\/?$/.test(path)) return work(host, path.replace(/\/$/, ""));
    if (host === "bsky.app" && (match = path.match(/^\/profile\/([\w.-]+)\/post\/([\w.~-]+)\/?$/))) {
      return work(host, `/profile/${match[1]}/post/${match[2]}`);
    }
    if (host === "pixiv.net") {
      match = path.match(/^\/(?:en\/)?(?:i|artworks)\/(\d+)\/?$/);
      if (match) return work("www.pixiv.net", `/artworks/${match[1]}`);
      if (path === "/member_illust.php" && /^\d+$/.test(url.searchParams.get("illust_id"))) {
        return work("www.pixiv.net", `/artworks/${url.searchParams.get("illust_id")}`);
      }
    }
    if (/^[a-z0-9-]+\.pximg\.net$/.test(host) || /^(?:i(?:-f|\d*)|img\d+)\.pixiv\.net$/.test(host)) {
      match = path.match(/^\/(?:\w+\/)*img-[a-z-]+\/img\/\d{4}(?:\/\d{2}){5}\/(\d+)[^/]*\.[a-z0-9]+$/) ||
        (/^(?:i|img)\d+\.pixiv\.net$/.test(host) && path.match(/^\/(?:img\d+\/)?img\/.+\/(\d+)[^/]*\.[a-z0-9]+$/));
      if (match) return image(work("www.pixiv.net", `/artworks/${match[1]}`));
    }
    if (["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"].includes(host) &&
        (match = path.match(/^\/([a-zA-Z0-9_]{1,15}|i\/web)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/))) {
      return work("twitter.com", `/${match[1]}/status/${match[2]}`);
    }
    return null;
  }

  function targetUrl(value) {
    return resolveTarget(value)?.url || null;
  }

  function currentWorkUrl(value) {
    const target = resolveTarget(value);
    return target?.kind === "work" ? target.url : null;
  }

  globalThis.P2NazurinSites = Object.freeze({
    LEGACY_SOURCE_HOSTS, SOURCE_MATCHES, isGenericSourceUrl, targetUrl, currentWorkUrl,
    normalizeTargetUrl: targetUrl
  });
})();
