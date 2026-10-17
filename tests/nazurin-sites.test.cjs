"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(read("src/nazurin-sites.js"), context);
const sites = context.P2NazurinSites;

test("generic sources cover supported platforms without adding Pixiv/mobile X entry points or CDNs", () => {
  for (const host of [
    "yande.re", "konachan.com", "konachan.net", "www.konachan.net", "lolibooru.moe",
    "danbooru.donmai.us", "safebooru.donmai.us", "zerochan.net", "gelbooru.com",
    "artstation.com", "catzz.artstation.com", "wallhaven.cc", "whvn.cc",
    "bilibili.com", "www.bilibili.com", "t.bilibili.com", "weibo.com", "weibo.cn",
    "m.weibo.com", "m.weibo.cn", "share.api.weibo.cn", "www.deviantart.com",
    "artist.deviantart.com", "artist.lofter.com", "kemono.party", "kemono.su", "kemono.cr",
    "telegra.ph", "graph.org", "bsky.app"
  ]) assert.equal(sites.isGenericSourceUrl(`https://${host}/`), true, host);
  for (const host of [...sites.LEGACY_SOURCE_HOSTS, "pixiv.net", "mobile.twitter.com", "mobile.x.com",
    "i.pximg.net", "files.yande.re", "cdn.donmai.us", "static.zerochan.net", "s1.zerochan.net"]) {
    assert.equal(sites.isGenericSourceUrl(`https://${host}/`), false, host);
  }
});

test("work targets follow Nazurin's supported forms and normalize to stable artwork links", () => {
  const cases = [
    ["http://www.yande.re/post/show/1270390/title?tags=a#image", "https://yande.re/post/show/1270390"],
    ["https://www.konachan.net/post/show/42?tags=a#image", "https://konachan.com/post/show/42"],
    ["https://www.konachan.com/post/show/42", "https://konachan.com/post/show/42"],
    ["https://lolibooru.moe/post/show/42", "https://lolibooru.moe/post/show/42"],
    ["https://danbooru.donmai.us/posts/42?pool_id=1", "https://danbooru.donmai.us/posts/42"],
    ["https://safebooru.donmai.us/posts/42", "https://safebooru.donmai.us/posts/42"],
    ["https://www.zerochan.net/42#full", "https://www.zerochan.net/42"],
    ["https://www.gelbooru.com/index.php?id=42&s=view&page=post&tags=test#image", "https://gelbooru.com/index.php?page=post&s=view&id=42"],
    ["https://catzz.artstation.com/projects/A9ELeq", "https://www.artstation.com/artwork/A9ELeq"],
    ["https://artstation.com/artwork/2x3LaB", "https://www.artstation.com/artwork/2x3LaB"],
    ["http://whvn.cc/94x38z", "https://wallhaven.cc/w/94x38z"],
    ["https://www.wallhaven.cc/w/94x38z", "https://wallhaven.cc/w/94x38z"],
    ["https://www.bilibili.com/opus/42?spm_id_from=1", "https://t.bilibili.com/42"],
    ["https://t.bilibili.com/h5/dynamic/detail/42", "https://t.bilibili.com/42"],
    ["https://weibo.com/1804342520/KEli42z4q", "https://m.weibo.cn/detail/KEli42z4q"],
    ["https://m.weibo.com/status/4696149640611470", "https://m.weibo.cn/detail/4696149640611470"],
    ["https://weibo.cn/appurl?scheme=x&lfid=42", "https://m.weibo.cn/detail/42"],
    ["https://share.api.weibo.cn/share/310744244,4776731619099115.html?weibo_id=4776731619099115", "https://m.weibo.cn/detail/4776731619099115"],
    ["https://artist.deviantart.com/art/Title-42", "https://www.deviantart.com/artist/art/Title-42"],
    ["https://www.deviantart.com/artist/art/Title-42", "https://www.deviantart.com/artist/art/Title-42"],
    ["https://artist.lofter.com/post/abc_def?x=1", "https://artist.lofter.com/post/abc_def"],
    ["https://kemono.cr/fanbox/user/1/post/2/revision/3?x=1", "https://kemono.cr/fanbox/user/1/post/2/revision/3"],
    ["https://kemono.su/boosty/user/a-b/post/c-d", "https://kemono.su/boosty/user/a-b/post/c-d"],
    ["https://kemono.party/patreon/user/1/post/2", "https://kemono.party/patreon/user/1/post/2"],
    ["https://graph.org/Page-01-01#image", "https://graph.org/Page-01-01"],
    ["https://telegra.ph/%E6%B5%8B%E8%AF%95-01-01", "https://telegra.ph/%E6%B5%8B%E8%AF%95-01-01"],
    ["https://bsky.app/profile/artist.bsky.social/post/3kkt7oj5rmw2j", "https://bsky.app/profile/artist.bsky.social/post/3kkt7oj5rmw2j"],
    ["https://pixiv.net/i/42", "https://www.pixiv.net/artworks/42"],
    ["https://www.pixiv.net/en/artworks/42?x=1", "https://www.pixiv.net/artworks/42"],
    ["https://www.pixiv.net/member_illust.php?mode=medium&illust_id=42", "https://www.pixiv.net/artworks/42"],
    ["https://mobile.x.com/artist/status/42/photo/1?x=1", "https://twitter.com/artist/status/42"],
    ["https://mobile.twitter.com/artist/status/42", "https://twitter.com/artist/status/42"],
    ["https://x.com/i/web/status/42", "https://twitter.com/i/web/status/42"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(sites.targetUrl(input), expected, input);
    assert.equal(sites.currentWorkUrl(input), expected, input);
    assert.equal(sites.targetUrl(expected), expected, `normalization must be idempotent: ${input}`);
  }
});

test("audited image links select the work without enabling detail-page fallback on image paths", () => {
  const hash = "0e7cb99d3a07b9b916634bd8aa2d48a7";
  const cases = [
    [`https://files.yande.re/sample/${hash}/yande.re%201270390%20sample%20tagme.jpg`, "https://yande.re/post/show/1270390"],
    [`https://files.konachan.net/image/${hash}/Konachan.net%20-%2042%20tag.jpg`, "https://konachan.com/post/show/42"],
    [`https://files.konachan.com/jpeg/${hash}/Konachan.com%20-%2042.jpg`, "https://konachan.com/post/show/42"],
    [`https://lolibooru.moe/image/${hash}/lolibooru%2042%20tag.jpg`, "https://lolibooru.moe/post/show/42"],
    ["https://static.zerochan.net/A.full.42.jpg", "https://www.zerochan.net/42"],
    ["https://s1.zerochan.net/A.600.42.jpg", "https://www.zerochan.net/42"],
    ["https://i.pximg.net/c/540x540_10_webp/img-master/img/2020/02/02/20/00/02/42_p0_square1200.jpg", "https://www.pixiv.net/artworks/42"],
    ["https://i-f.pximg.net/img-original/img/2020/02/02/20/00/02/42_ugoira1920x1080.zip", "https://www.pixiv.net/artworks/42"],
    ["http://img1.pixiv.net/img/artist/42_s.jpg", "https://www.pixiv.net/artworks/42"],
    [`https://cdn.donmai.us/original/0e/7c/${hash}.png?download=1`, `https://cdn.donmai.us/original/0e/7c/${hash}.png`],
    [`https://safebooru.donmai.us/data/sample/sample-${hash}.jpg`, `https://safebooru.donmai.us/data/sample/sample-${hash}.jpg`]
  ];
  for (const [input, expected] of cases) {
    assert.equal(sites.targetUrl(input), expected, input);
    assert.equal(sites.currentWorkUrl(input), null, input);
    assert.equal(sites.targetUrl(expected), expected, input);
  }
});

test("homepages, lists, profiles and unsupported work shapes never become submission targets", () => {
  for (const url of [
    "https://yande.re/", "https://yande.re/post", "https://yande.re/post?tags=blue_archive",
    "https://konachan.net/post", "https://lolibooru.moe/post/show/no-id", "https://danbooru.donmai.us/posts",
    "https://zerochan.net/Blue+Archive", "https://gelbooru.com/index.php?page=post&s=list&tags=test",
    "https://gelbooru.com/index.php?page=post&s=view&id=42&id=43", "https://artstation.com/",
    "https://catzz.artstation.com/projects", "https://wallhaven.cc/search", "https://wallhaven.cc/latest",
    "https://whvn.cc/search", "https://bilibili.com/video/BV123", "https://t.bilibili.com/",
    "https://weibo.com/1804342520", "https://m.weibo.cn/detail/not-a-post", "https://www.deviantart.com/artist/gallery",
    "https://artist.lofter.com/", "https://kemono.cr/fanbox/user/1", "https://telegra.ph/",
    "https://telegra.ph/login", "https://bsky.app/profile/artist.bsky.social", "https://pixiv.net/",
    "https://mobile.twitter.com/home", "https://files.yande.re/avatar/42.jpg", "https://i.pximg.net/arbitrary/42.jpg"
  ]) {
    assert.equal(sites.targetUrl(url), null, url);
    assert.equal(sites.currentWorkUrl(url), null, url);
  }
});

test("host boundaries, unsafe URLs and embedded artwork URLs cannot bypass work validation", () => {
  for (const value of [
    null, {}, "", "/post/show/1", "javascript:alert(1)", "data:text/plain,abc", "file:///yande.re/",
    "https://user:pass@yande.re/post/show/1", "https://yande.re:444/post/show/1", "https://yande.re./post/show/1",
    "https://evil.example/?url=https://yande.re/post/show/1", "https://yande.re.evil.example/post/show/1",
    "https://evilyande.re/post/show/1", "https://notkonachan.com/post/show/1", "https://safebooru.org/posts/1",
    "https://evil.donmai.us/posts/1", "https://space.bilibili.com/opus/1", "https://a.b.artstation.com/artwork/abc",
    "https://a.b.lofter.com/post/abc_def", "https://www.pixivision.net/zh/a/42", "https://evil.pixiv.net/artworks/1",
    "https://yande.re/post?url=https://www.pixiv.net/artworks/42", "https://yande.re/post#https://yande.re/post/show/42",
    "https://yande.re/post/show/not-an-id/42", "https://gelbooru.com/index.php?page=post&s=view&id=x"
  ]) assert.equal(sites.targetUrl(value), null, String(value));
  assert.equal(sites.targetUrl("https://yande.re:443/post/show/42?url=https://www.pixiv.net/artworks/1"), "https://yande.re/post/show/42");
  assert.equal(sites.isGenericSourceUrl("http://yande.re/post"), false);
});

test("Konachan conversion is unconditional and all aliases deduplicate by canonical work URL", () => {
  for (const host of ["konachan.net", "www.konachan.net", "konachan.com", "www.konachan.com"]) {
    assert.equal(sites.normalizeTargetUrl(`https://${host}/post/show/42?tags=a#image`), "https://konachan.com/post/show/42");
  }
});

test("manifest and registry stay in sync without overlapping dedicated adapters or extra entry points", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const generic = manifest.content_scripts.find((entry) => entry.js.includes("src/generic-submit.js"));
  assert.deepEqual(generic.matches, Array.from(sites.SOURCE_MATCHES));
  assert.deepEqual(generic.js, ["src/settings.js", "src/i18n.js", "src/nazurin-sites.js", "src/link-submit.js", "src/generic-submit.js"]);
  assert.deepEqual(generic.css, ["src/link-submit.css"]);
  assert.notEqual(generic.all_frames, true);
  assert.notEqual(generic.match_about_blank, true);
  assert.notEqual(generic.match_origin_as_fallback, true);
  for (const match of generic.matches) {
    assert.ok(manifest.host_permissions.includes(match));
    assert.ok(match.startsWith("https://"));
    assert.ok(!["https://*/*", "<all_urls>"].includes(match));
    for (const entry of manifest.content_scripts.filter((entry) => entry !== generic)) {
      assert.equal(entry.matches.includes(match), false);
    }
  }
  for (const host of [...sites.LEGACY_SOURCE_HOSTS, "pixiv.net", "mobile.x.com", "mobile.twitter.com"]) {
    assert.equal(generic.matches.includes(`https://${host}/*`), false);
  }
});
