"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");

function harness({ url = "https://yande.re/post", pixiv = false, payload, fetchImpl, timeoutImmediately = false } = {}) {
  let adapter, pointed = null;
  const calls = [];
  class Element {}
  class Anchor extends Element { constructor(href) { super(); this.href = new URL(href, url).href; } }
  const location = new URL(url);
  const context = vm.createContext({ URL, AbortController, DOMException,
    DOMParser: class { parseFromString() { return payload; } },
    setTimeout: timeoutImmediately ? (callback) => setTimeout(callback, 0) : setTimeout, clearTimeout,
    location, window: { location }, Element, HTMLAnchorElement: Anchor,
    document: { elementFromPoint: () => pointed },
    fetch: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return fetchImpl ? fetchImpl(endpoint, options) : { ok: true, json: async () => payload, text: async () => "" };
    },
    chrome: { runtime: { sendMessage(message, callback) {
      calls.push(message); callback({ ok: true, payload });
    } } },
    P2PreviewCore: { start(value) { adapter = value; } }
  });
  vm.runInContext(read("preview-core.js"), context);
  context.P2PreviewCore = { ...context.P2PreviewCore, start(value) { adapter = value; } };
  vm.runInContext(read("nazurin-sites.js"), context);
  vm.runInContext(read(pixiv ? "content.js" : "board-preview.js"), context);
  return { get adapter() { return adapter; }, calls,
    anchor: (href) => new Anchor(href),
    element: () => new Element(),
    navigate(href) { location.href = href; },
    point(element) { pointed = element; } };
}
const post = (id = 42, base = "https://files.yande.re") => ({ id,
  sample_url: `${base}/sample/image.jpg`, file_url: `${base}/image/original.png`, file_ext: "png",
  sample_width: 1500, sample_height: 1000, width: 4500, height: 3000 });

test("Pixiv adapter preserves canonical IDs, multipage metadata and its bookmark capability", async () => {
  const h = harness({ pixiv: true, url: "https://www.pixiv.net/", payload: { error: false, body: [
    { urls: { regular: "https://i.pximg.net/one.jpg", original: "https://i.pximg.net/one.png" }, width: 1000, height: 1500 },
    { urls: { regular: "https://i.pximg.net/two.jpg" }, width: 2000, height: 1000 }
  ] } });
  const work = h.adapter.workFromAnchor(h.anchor("/artworks/42?tag=test"));
  assert.equal(work.key, "pixiv:42");
  assert.equal(work.url, "https://www.pixiv.net/artworks/42");
  assert.equal(typeof h.adapter.bookmark.findButton, "function");
  const metadata = await h.adapter.load(work, new AbortController().signal);
  assert.equal(metadata.pages.length, 2);
  assert.equal(metadata.pages[0].original, "https://i.pximg.net/one.png");
  assert.equal(h.calls[0].type, "pfp-get-pages");
  assert.equal(h.calls[0].illustId, "42");
  assert.equal(h.adapter.submissionMessage(work, "r").illustId, "42");
});

test("Moebooru reuses one adapter across all supported origins without inventing bookmark controls", async () => {
  for (const host of ["yande.re", "www.yande.re", "konachan.com", "www.konachan.com", "konachan.net", "www.konachan.net"]) {
    const h = harness({ url: `https://${host}/post`, payload: [post(42, host.includes("yande") ? "https://files.yande.re" : `https://${host}`)] });
    const work = h.adapter.workFromAnchor(h.anchor("/post/show/42?tags=x"));
    const metadata = await h.adapter.load(work, new AbortController().signal);
    assert.equal(h.adapter.bookmark, undefined);
    assert.equal(metadata.pages[0].width, 1500);
    assert.equal(metadata.pages[0].original.endsWith("original.png"), true);
    assert.equal(new URL(h.calls[0].endpoint).hostname, host);
    assert.equal(new URL(h.calls[0].endpoint).searchParams.get("tags"), "id:42");
    assert.equal(h.calls[0].options.credentials, "same-origin");
    assert.equal(h.adapter.submissionMessage(work, "r").url,
      host.includes("yande") ? "https://yande.re/post/show/42" : "https://konachan.com/post/show/42");
  }
});

test("same numeric ID on different platforms uses different preview/cache/queue keys", () => {
  const pixiv = harness({ pixiv: true, url: "https://www.pixiv.net/" });
  const yande = harness();
  const kona = harness({ url: "https://konachan.net/post" });
  const keys = [pixiv, yande, kona].map((h) => h.adapter.workFromAnchor(h.anchor(h === pixiv ? "/artworks/42" : "/post/show/42")).key);
  assert.equal(new Set(keys).size, 3);
  assert.equal(kona.adapter.workFromAnchor(kona.anchor("https://konachan.com/post/show/42")).key, keys[2]);
});

test("metadata rejects missing IDs, deleted posts and untrusted image hosts", async () => {
  for (const payload of [[], [post(99)], [{ ...post(), status: "deleted" }],
    [{ id: 42, sample_url: "https://evil.example/image.jpg" }]]) {
    const h = harness({ payload });
    await assert.rejects(h.adapter.load(h.adapter.workFromAnchor(h.anchor("/post/show/42")), new AbortController().signal));
  }
  const h = harness();
  for (const value of ["http://files.yande.re/image.jpg", "https://files.yande.re.evil.example/a.jpg",
    "https://user:pass@files.yande.re/a.jpg", "https://files.yande.re:444/a.jpg", "javascript:alert(1)"]) {
    assert.equal(h.adapter.safeImageUrl(value), null, value);
  }
});

test("metadata aborts in-flight fetches when the shared preview is closed", async () => {
  const h = harness({ fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) });
  const controller = new AbortController();
  const pending = h.adapter.load(h.adapter.workFromAnchor(h.anchor("/post/show/42")), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.calls[0].options.signal.aborted, true);
});

test("detail pages own D without a pointer and disable redundant main-image previews", () => {
  const h = harness({ url: "https://yande.re/post/show/1270390" });
  assert.equal(h.adapter.canPreview(), false);
  const result = h.adapter.resolveSubmission({ pointerKnown: false });
  assert.equal(result.work.url, "https://yande.re/post/show/1270390");
  h.navigate("https://yande.re/post");
  assert.equal(h.adapter.canPreview(), true);
  assert.equal(h.adapter.resolveSubmission({ pointerKnown: false }), null);
});

test("a pointed preview submits its own work, and irrelevant list links never submit the listing", () => {
  const h = harness();
  const pointed = {};
  h.point(pointed);
  const preview = { work: { key: "moebooru:yande.re:42", url: "https://yande.re/post/show/42" },
    ui: { root: { contains: (node) => node === pointed } } };
  assert.equal(h.adapter.resolveSubmission({ pointerKnown: true, pointerX: 1, pointerY: 1, allWindows: () => [preview] }), preview);
  h.point(null);
  assert.equal(h.adapter.resolveSubmission({ pointerKnown: true, pointerX: 1, pointerY: 1, allWindows: () => [] }), null);
});

test("sites without preview support do not start the shared engine", () => {
  for (const url of ["https://lolibooru.moe/post", "https://x.com/home", "https://evil.example/"]) {
    assert.equal(harness({ url }).adapter, undefined);
  }
});

test("metadata timeouts are reported as load failures rather than leaving a cancelled loading window", async () => {
  const h = harness({ timeoutImmediately: true, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) });
  const work = h.adapter.workFromAnchor(h.anchor("/post/show/42"));
  await assert.rejects(h.adapter.load(work, new AbortController().signal), /timed out/);
});

test("D resolves the highlighted thumbnail even when no delayed preview window exists yet", () => {
  const h = harness();
  const anchor = h.anchor("/post/show/1270390?tags=blue_archive");
  const image = h.element();
  image.closest = (selector) => selector === ".pfp-root" ? null : anchor;
  image.getBoundingClientRect = () => ({ left: 0, top: 0, right: 150, bottom: 150, width: 150, height: 150 });
  anchor.querySelectorAll = () => [image];
  h.point(image);
  const manager = { pointerKnown: true, pointerX: 50, pointerY: 50, allWindows: () => [] };
  assert.equal(h.adapter.resolveSubmission(manager).work.url, "https://yande.re/post/show/1270390");
});

test("all five image sites resolve detail D before any hover, including SPA navigation", () => {
  for (const [url, list, expected, pixiv] of [
    ["https://www.pixiv.net/artworks/42?x=1", "https://www.pixiv.net/", "https://www.pixiv.net/artworks/42", true],
    ["https://danbooru.donmai.us/posts/42", "https://danbooru.donmai.us/posts", "https://danbooru.donmai.us/posts/42"],
    ["https://yande.re/post/show/42", "https://yande.re/post", "https://yande.re/post/show/42"],
    ["https://konachan.net/post/show/42", "https://konachan.net/post", "https://konachan.com/post/show/42"],
    ["https://www.zerochan.net/42", "https://www.zerochan.net/", "https://www.zerochan.net/42"]
  ]) {
    const h = harness({ url, pixiv });
    const manager = { pointerKnown: false, topmostWindow: () => null };
    assert.equal(h.adapter.resolveSubmission(manager).work.url, expected);
    h.navigate(list);
    assert.equal(h.adapter.resolveSubmission(manager), null);
    h.navigate(url);
    assert.equal(h.adapter.resolveSubmission(manager).work.url, expected);
  }
});

test("Danbooru validates identity, safe media and deleted/restricted responses", async () => {
  const valid = { id: 42, file_ext: "png", large_file_url: "https://cdn.donmai.us/sample/a.jpg",
    file_url: "https://cdn.donmai.us/original/a.png", image_width: 2000, image_height: 3000 };
  for (const payload of [valid, { ...valid, id: 43 }, { ...valid, is_deleted: true },
    { ...valid, is_banned: true }, { id: 42 },
    { ...valid, large_file_url: "https://evil.example/a.jpg", file_url: null }]) {
    const h = harness({ url: "https://danbooru.donmai.us/posts", payload });
    const work = h.adapter.workFromAnchor(h.anchor("/posts/42"));
    const result = h.adapter.load(work, new AbortController().signal);
    if (payload === valid) {
      const data = await result;
      assert.equal(data.pages[0].regular, valid.large_file_url);
      assert.equal(data.pages[0].original, valid.file_url);
      assert.equal(h.calls[0].endpoint, "https://danbooru.donmai.us/posts/42.json");
    } else await assert.rejects(result);
  }
});

test("Zerochan reads only canonical detail image fields and rejects mismatches, redirects and unsafe images", async () => {
  const documentFor = (canonical, regular, original) => ({ querySelector(selector) {
    const attributes = {
      'link[rel="canonical"]': { href: canonical },
      '#large a.preview img': { src: regular, width: '600', height: '818' },
      '#large a.preview': { href: original }
    }[selector];
    return attributes ? { getAttribute: (key) => attributes[key] ?? null } : null;
  } });
  const canonical = "https://www.zerochan.net/42";
  const regular = "https://static.zerochan.net/Art.1024.42.webp";
  const original = "https://static.zerochan.net/Art.full.42.jpg";
  for (const [identity, image, full, valid] of [
    [canonical, regular, original, true], [canonical, regular, "https://evil.example/a.jpg", true],
    ["https://www.zerochan.net/43", regular, original, false],
    [null, regular, original, false], [canonical, "https://evil.example/a.jpg", original, false],
    [canonical, "", original, false], [canonical, null, original, false]
  ]) {
    const h = harness({ url: "https://www.zerochan.net/", payload: documentFor(identity, image, full) });
    const work = h.adapter.workFromAnchor(h.anchor("/42"));
    const pending = h.adapter.load(work, new AbortController().signal);
    if (!valid) { await assert.rejects(pending); continue; }
    const data = await pending;
    assert.equal(data.pages[0].regular, regular);
    assert.equal(data.pages[0].original, full === original ? original : null);
    assert.equal(data.pages[0].height, 818);
    assert.equal(h.calls[0].endpoint, canonical);
    assert.equal(h.calls[0].options.headers.Accept, "text/html");
  }
  for (const response of [{ ok: false, status: 503 }, { ok: true, url: "https://evil.example/42" }]) {
    const h = harness({ url: "https://www.zerochan.net/", fetchImpl: async () => response });
    await assert.rejects(h.adapter.load(h.adapter.workFromAnchor(h.anchor("/42")), new AbortController().signal));
  }
});
