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

test("generic sources cover the audited sites and aliases, not legacy adapters or image CDNs", () => {
  for (const host of [
    "yande.re", "konachan.com", "konachan.net", "www.konachan.net", "lolibooru.moe",
    "danbooru.donmai.us", "safebooru.donmai.us", "zerochan.net", "gelbooru.com",
    "artstation.com", "catzz.artstation.com", "wallhaven.cc", "whvn.cc",
    "bilibili.com", "www.bilibili.com", "t.bilibili.com", "weibo.com", "weibo.cn",
    "m.weibo.com", "m.weibo.cn", "share.api.weibo.cn", "www.deviantart.com",
    "artist.deviantart.com", "artist.lofter.com", "kemono.party", "kemono.su", "kemono.cr",
    "telegra.ph", "graph.org", "bsky.app", "pixiv.net", "mobile.twitter.com", "mobile.x.com"
  ]) assert.equal(sites.isGenericSourceUrl(`https://${host}/`), true, host);
  for (const host of [...sites.LEGACY_SOURCE_HOSTS, "i.pximg.net", "files.yande.re",
    "cdn.donmai.us", "static.zerochan.net", "s1.zerochan.net"]) {
    assert.equal(sites.isGenericSourceUrl(`https://${host}/`), false, host);
  }
});

test("target validation includes legacy sites and audited images without broad parent-domain matching", () => {
  for (const host of [
    "www.pixiv.net", "x.com", "twitter.com", "i.pximg.net", "i-f.pximg.net", "i1.pixiv.net",
    "img1.pixiv.net", "files.yande.re", "files.konachan.com", "cdn.donmai.us",
    "s1.zerochan.net", "static.zerochan.net"
  ]) {
    const url = `https://${host}/path?q=1#image`;
    assert.equal(sites.targetUrl(url), url, host);
  }
  for (const host of [
    "evil.example", "safebooru.org", "donmai.us", "evil.donmai.us", "space.bilibili.com",
    "yande.re.evil.example", "evilyande.re", "notkonachan.com", "konachan.net.evil.example",
    "evilartstation.com", "a.b.artstation.com", "a.b.lofter.com", "www.pixivision.net",
    "evil.pixiv.net", "kemono.cr.evil.example"
  ]) {
    assert.equal(sites.targetUrl(`https://${host}/`), null, host);
    assert.equal(sites.isGenericSourceUrl(`https://${host}/`), false, host);
  }
});

test("URLs require standard HTTP(S) without credentials; only HTTPS sources are enabled", () => {
  assert.equal(sites.targetUrl("http://yande.re:80/post/show/1"), "http://yande.re/post/show/1");
  assert.equal(sites.targetUrl("https://yande.re:443/post/show/1"), "https://yande.re/post/show/1");
  assert.equal(sites.isGenericSourceUrl("http://yande.re/"), false);
  for (const value of [
    null, {}, "", "/post/show/1", "javascript:alert(1)", "data:text/plain,abc",
    "file:///yande.re/", "sinaweibo://detail?mblogid=1", "https://user:pass@yande.re/",
    "https://yande.re:444/", "http://yande.re:8080/", "https://yande.re./"
  ]) {
    assert.equal(sites.targetUrl(value), null, String(value));
    assert.equal(sites.isGenericSourceUrl(value), false, String(value));
  }
});

test("Konachan normalization preserves URL information and honors explicit false", () => {
  const path = "/post/show/42?tags=a%20b&x=1#image";
  for (const host of ["konachan.net", "www.konachan.net", "konachan.com", "www.konachan.com"]) {
    assert.equal(sites.normalizeTargetUrl(`https://${host}${path}`), `https://konachan.com${path}`);
  }
  assert.equal(sites.normalizeTargetUrl(`https://konachan.net${path}`, false), null);
  assert.equal(sites.normalizeTargetUrl(`https://konachan.com${path}`, false), `https://konachan.com${path}`);
  const gelbooru = "https://gelbooru.com/index.php?page=post&s=view&id=1#tag";
  assert.equal(sites.normalizeTargetUrl(gelbooru), gelbooru);
});

test("manifest and registry stay in sync with no overlapping legacy handlers", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const generic = manifest.content_scripts.find((entry) => entry.js.includes("src/generic-submit.js"));
  assert.deepEqual(generic.matches, Array.from(sites.SOURCE_MATCHES));
  assert.deepEqual(generic.js, [
    "src/settings.js", "src/i18n.js", "src/nazurin-sites.js", "src/link-submit.js", "src/generic-submit.js"
  ]);
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
  for (const host of sites.LEGACY_SOURCE_HOSTS) {
    assert.equal(generic.matches.includes(`https://${host}/*`), false);
  }
});
