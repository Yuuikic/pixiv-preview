"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({ shortcut = "KeyD", response = { ok: true, status: "accepted" } } = {}) {
  const events = {}, windowEvents = {}, calls = [], timers = [];
  let storageChanged, hovered = null, focused = null;
  const notices = [];
  const context = vm.createContext({
    URL, Date, Math, location: { href: "https://x.com/home" },
    setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
    clearTimeout() {},
    document: {
      addEventListener(name, callback) { events[name] = callback; },
      elementFromPoint() { return hovered; },
      get activeElement() { return focused; },
      createElement() { return { dataset: {}, setAttribute() {}, remove() {} }; },
      documentElement: { append(element) { notices.push(element); } }
    },
    window: { addEventListener(name, callback) { windowEvents[name] = callback; } },
    chrome: {
      runtime: { async sendMessage(message) {
        calls.push(JSON.parse(JSON.stringify(message)));
        return typeof response === "function" ? response(message) : response;
      } },
      storage: {
        sync: { async get() { return { nazurinShortcutCode: shortcut }; } },
        onChanged: { addListener(callback) { storageChanged = callback; } }
      }
    },
    P2I18n: { t: (key) => key }
  });
  vm.runInContext(read("src/settings.js"), context);
  vm.runInContext(read("src/twitter.js"), context);

  function article(entries) {
    const card = { querySelectorAll() { return links; } };
    const links = entries.map(({ href, time = false, quote = false, text = false, nested = false }) => ({
      href, querySelector() { return time ? {} : null; },
      closest(selector) {
        if (selector.startsWith("article")) return nested ? {} : card;
        return quote || text ? {} : null;
      },
      parentElement: { closest() { return quote ? {} : null; } }
    }));
    return { closest() { return card; } };
  }
  return {
    calls, notices, article,
    navigate(url) { context.location.href = url; },
    hover(target) { hovered = target; events.pointermove({ clientX: 50, clientY: 60 }); },
    setTarget(target) { hovered = target; },
    focus(target) { focused = target; },
    key(overrides = {}) {
      const event = { code: "KeyD", preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...overrides };
      events.keydown(event);
      return event;
    },
    changeShortcut(code) { storageChanged({ nazurinShortcutCode: { newValue: code } }, "sync"); },
    leave() { events.pointerout({ relatedTarget: null }); },
    blur() { windowEvents.blur(); },
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async gap() { timers.findLast((timer) => timer.ms === 1000)?.callback(); await this.flush(); }
  };
}

test("hovering any area of a tweet submits the outer timestamp URL without fetching images", async () => {
  const h = harness();
  h.hover(h.article([
    { href: "https://x.com/linked/status/111", time: true, text: true },
    { href: "https://x.com/quote/status/222", time: true, quote: true },
    { href: "https://x.com/nested/status/333", time: true, nested: true },
    { href: "https://x.com/artist/status/444/photo/2" },
    { href: "https://x.com/artist/status/444?s=20", time: true }
  ]));
  const event = h.key();
  await h.flush();
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].tweetUrl, "https://twitter.com/artist/status/444");
  assert.equal(h.calls[0].type, "pfp-nazurin-twitter-submit");
  assert.equal(h.notices.at(-1).textContent, "submissionSuccess");
});

test("shortcut resolves the tweet currently under the pointer, without stale hover state", async () => {
  const h = harness();
  h.hover(h.article([{ href: "https://x.com/a/status/1", time: true }]));
  h.setTarget(h.article([{ href: "https://x.com/b/status/2", time: true }]));
  h.key();
  await h.flush();
  assert.equal(h.calls[0].tweetUrl, "https://twitter.com/b/status/2");
  h.setTarget(null);
  assert.equal(h.key().prevented, undefined);
});

test("photo viewer submits the URL's tweet from images, empty space, or hovered replies", async () => {
  for (const host of ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]) {
    for (const area of ["no-pointer", "image", "empty-space", "reply"]) {
      const h = harness();
      h.navigate(`https://${host}/artist/status/444/photo/2?s=20#media`);
      if (area === "reply") h.hover(h.article([{ href: "https://x.com/replier/status/555", time: true }]));
      if (area === "image") h.hover({ closest: () => null });
      if (area === "empty-space") h.hover(null);
      assert.equal(h.key().prevented, true, `${host}: ${area}`);
      await h.flush();
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].tweetUrl, "https://twitter.com/artist/status/444");
    }
  }
});

test("photo viewer follows SPA URL changes and restores hover selection when closed", async () => {
  const h = harness();
  h.hover(h.article([{ href: "https://x.com/replier/status/555", time: true }]));
  h.navigate("https://x.com/artist/status/444/photo/1");
  h.key(); await h.flush();
  h.navigate("https://x.com/artist/status/444/photo/3");
  h.key(); await h.gap();
  h.navigate("https://x.com/another/status/666/photo/1");
  h.key(); await h.gap();
  h.navigate("https://x.com/artist/status/444");
  h.key(); await h.gap();
  assert.deepEqual(h.calls.map((call) => call.tweetUrl), [
    "https://twitter.com/artist/status/444", "https://twitter.com/artist/status/444",
    "https://twitter.com/another/status/666", "https://twitter.com/replier/status/555"
  ]);
  h.navigate("https://x.com/home");
  h.setTarget(null);
  assert.equal(h.key().prevented, undefined);
});

test("photo viewer still ignores typing, composition, modifiers, and held keys", () => {
  const h = harness();
  h.navigate("https://x.com/artist/status/444/photo/1");
  for (const flag of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"]) {
    assert.equal(h.key({ [flag]: true }).prevented, undefined);
  }
  assert.equal(h.key({ target: { closest: () => ({}) } }).prevented, undefined);
  h.focus({ closest: () => ({}) });
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.calls.length, 0);
});

test("ignores typing, composition, modifiers, held keys, absent tweets, and leaving the page", () => {
  const h = harness();
  const card = h.article([{ href: "https://x.com/a/status/1", time: true }]);
  h.hover(card);
  for (const flag of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"]) {
    assert.equal(h.key({ [flag]: true }).prevented, undefined);
  }
  assert.equal(h.key({ target: { closest: () => ({}) } }).prevented, undefined);
  h.focus({ closest: () => ({}) });
  assert.equal(h.key().prevented, undefined);
  h.focus(null);
  h.leave();
  assert.equal(h.key().prevented, undefined);
  h.hover(card); h.blur();
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.calls.length, 0);
});

test("loads and updates the shared configurable Nazurin shortcut", async () => {
  const h = harness({ shortcut: "KeyF" });
  await h.flush();
  h.hover(h.article([{ href: "https://twitter.com/a/status/1", time: true }]));
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.key({ code: "KeyF" }).prevented, true);
  await h.flush();
  h.changeShortcut("Digit7");
  assert.equal(h.key({ code: "KeyF" }).prevented, undefined);
  assert.equal(h.key({ code: "Digit7" }).prevented, true);
});

test("deduplicates pending tweets and serializes rapid submissions with a gap", async () => {
  let resolveFirst;
  const h = harness({ response: () => h.calls.length === 1
    ? new Promise((resolve) => { resolveFirst = resolve; })
    : { ok: true, status: "accepted" } });
  h.hover(h.article([{ href: "https://x.com/a/status/1", time: true }]));
  h.key(); h.key();
  assert.equal(h.calls.length, 1);
  assert.equal(h.notices.at(-1).textContent, "tweetAlreadyQueued");
  h.hover(h.article([{ href: "https://x.com/b/status/2", time: true }]));
  h.key();
  assert.equal(h.calls.length, 1);
  resolveFirst({ ok: true, status: "accepted" });
  await h.flush();
  assert.equal(h.calls.length, 1);
  await h.gap();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].tweetUrl, "https://twitter.com/b/status/2");
});

test("reports configuration errors and allows retry after configuring the service", async () => {
  const h = harness({ response: { ok: false, status: "not-verified" } });
  h.hover(h.article([{ href: "https://x.com/a/status/1", time: true }]));
  h.key(); await h.flush();
  assert.equal(h.notices.at(-1).textContent, "nazurinNotVerified");
  h.key(); await h.flush();
  assert.equal(h.calls.length, 2);
});

test("Twitter pages load only link-submission scripts and notification styles", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const entry = manifest.content_scripts.find((entry) => entry.matches.includes("https://x.com/*"));
  assert.deepEqual(entry.js, ["src/settings.js", "src/i18n.js", "src/twitter.js"]);
  assert.deepEqual(entry.css, ["src/twitter.css"]);
});
