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

test("six product sites and pixivision register one adapter, with previews on five", () => {
  const cases = [
    ["www.pixiv.net", "pixiv", "content.js"], ["danbooru.donmai.us", "danbooru", "board-preview.js"],
    ["yande.re", "yandere", "board-preview.js"], ["konachan.net", "konachan", "board-preview.js"],
    ["www.zerochan.net", "zerochan", "board-preview.js"], ["x.com", "twitter", "twitter.js"], ["www.pixivision.net", "pixivision", "pixivision.js"]
  ];
  for (const [host, site, file] of cases) {
    const url = `https://${host}/`;
    assert.equal(sites.siteForUrl(url), site);
    const entry = sites.scriptsForUrl(url);
    assert.deepEqual(Array.from(entry.matches), [`${url}*`]);
    assert.ok(entry.js.includes(`src/${file}`));
    assert.equal(entry.js.includes("src/preview-core.js"), !["twitter", "pixivision"].includes(site));
    assert.equal(entry.allFrames, false);
  }
});

test("canonical detail links discard tracking and keep stable identities", () => {
  for (const [input, expected] of [
    ["https://www.pixiv.net/en/artworks/42?x=1#image", "https://www.pixiv.net/artworks/42"],
    ["https://danbooru.donmai.us/posts/42?pool=1", "https://danbooru.donmai.us/posts/42"],
    ["https://www.yande.re/post/show/42/title?tags=a", "https://yande.re/post/show/42"],
    ["https://www.konachan.net/post/show/42?tags=a", "https://konachan.com/post/show/42"],
    ["https://zerochan.net/42#full", "https://www.zerochan.net/42"],
    ["https://mobile.x.com/artist/status/42/photo/2?s=20", "https://twitter.com/artist/status/42"],
    ["https://x.com/i/web/status/42", "https://twitter.com/i/web/status/42"]
  ]) {
    assert.equal(sites.targetUrl(input), expected);
    assert.equal(sites.currentWorkUrl(input), expected);
    assert.equal(sites.targetUrl(expected), expected);
  }
});

test("removed platforms and CDN pages cannot register or submit", () => {
  for (const url of [
    "https://safebooru.donmai.us/posts/42",
    "https://lolibooru.moe/post/show/42", "https://gelbooru.com/index.php?page=post&s=view&id=42",
    "https://artstation.com/artwork/abc", "https://wallhaven.cc/w/abc123", "https://bsky.app/profile/a/post/b",
    "https://artist.lofter.com/post/abc", "https://t.bilibili.com/42", "https://m.weibo.cn/detail/42",
    "https://www.deviantart.com/a/art/b-42", "https://kemono.cr/fanbox/user/1/post/2", "https://telegra.ph/a",
    "https://cdn.donmai.us/original/42.jpg", "https://static.zerochan.net/A.full.42.jpg",
    "https://files.yande.re/image/42.jpg", "https://i.pximg.net/42.jpg", "sinaweibo://detail?mblogid=42"
  ]) {
    assert.equal(sites.scriptsForUrl(url), null, url);
    assert.equal(sites.targetUrl(url), null, url);
  }
});

test("homepages, lists, profiles and unsupported work shapes never become submission targets", () => {
  for (const url of [
    "https://yande.re/", "https://yande.re/post", "https://yande.re/post?tags=blue_archive",
    "https://konachan.net/post", "https://lolibooru.moe/post/show/no-id", "https://danbooru.donmai.us/posts",
    "https://zerochan.net/Blue+Archive", "https://gelbooru.com/index.php?page=post&s=list&tags=test",
    "https://artstation.com/",
    "https://catzz.artstation.com/projects",
    "https://bilibili.com/video/BV123", "https://t.bilibili.com/",
    "https://weibo.com/1804342520", "https://www.deviantart.com/artist/gallery",
    "https://artist.lofter.com/", "https://kemono.cr/fanbox/user/1", "https://telegra.ph/",
    "https://bsky.app/profile/artist.bsky.social", "https://pixiv.net/",
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
  assert.equal(sites.isBoardSourceUrl("http://yande.re/post"), false);
});

test("Konachan conversion is unconditional and all aliases deduplicate by canonical work URL", () => {
  for (const host of ["konachan.net", "www.konachan.net", "konachan.com", "www.konachan.com"]) {
    assert.equal(sites.normalizeTargetUrl(`https://${host}/post/show/42?tags=a#image`), "https://konachan.com/post/show/42");
  }
});
