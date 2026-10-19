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
    URL, Date, Math, location: { href: "https://www.pixivision.net/zh/a/11692" },
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
  vm.runInContext(read("src/link-submit.js"), context);
  vm.runInContext(read("src/pixivision.js"), context);

  function artwork(href, { direct = true, inWork = true } = {}) {
    const link = { href };
    const work = { querySelectorAll: () => [link] };
    return { closest(selector) {
      if (selector === "a[href]") return direct ? link : null;
      if (selector === ".am__work") return inWork ? work : null;
      return null;
    } };
  }
  return {
    calls, notices, artwork,
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
    hide() { windowEvents.pagehide(); },
    show() { windowEvents.pageshow(); },
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async gap() { timers.findLast((timer) => timer.ms === 1000)?.callback(); await this.flush(); }
  };
}


test("artwork images, titles, and information resolve only the Pixiv artwork ID", async () => {
  for (const direct of [true, false]) {
    const h = harness();
    h.hover(h.artwork("https://www.pixiv.net/artworks/142138569?utm_source=pixivision#image", { direct }));
    assert.equal(h.key().prevented, true);
    await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].type, "pfp-nazurin-submit");
    assert.equal(h.calls[0].illustId, "142138569");
    assert.equal(h.calls[0].url, undefined);
    assert.equal(h.notices.at(-1).textContent, "submissionSuccess");
  }
});

test("ignores article links, sidebar cards, malformed URLs, and empty areas", () => {
  for (const href of [
    "https://www.pixivision.net/zh/a/11692", "https://www.pixiv.net/users/123",
    "https://www.pixiv.net/artworks/nope", "https://www.pixiv.net/artworks/123/extra",
    "https://www.pixiv.net.evil.example/artworks/123", "http://www.pixiv.net/artworks/123",
    "https://user:pass@www.pixiv.net/artworks/123", "https://www.pixiv.net:444/artworks/123"
  ]) {
    const h = harness();
    h.hover(h.artwork(href, { inWork: false }));
    assert.equal(h.key().prevented, undefined);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  h.hover(null);
  assert.equal(h.key().prevented, undefined);
});

test("resolves the artwork at keypress time after scrolling, without stale hover state", async () => {
  const h = harness();
  h.hover(h.artwork("https://www.pixiv.net/artworks/1"));
  h.setTarget(h.artwork("https://www.pixiv.net/artworks/2"));
  h.key(); await h.flush();
  assert.equal(h.calls[0].illustId, "2");
  h.setTarget(null);
  assert.equal(h.key().prevented, undefined);
});

test("ignores typing, composition, modifiers, held keys, blur, and page exit", () => {
  const h = harness();
  const target = h.artwork("https://www.pixiv.net/artworks/1");
  h.hover(target);
  for (const flag of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"]) {
    assert.equal(h.key({ [flag]: true }).prevented, undefined);
  }
  assert.equal(h.key({ target: { closest: () => ({}) } }).prevented, undefined);
  h.focus({ closest: () => ({}) });
  assert.equal(h.key().prevented, undefined);
  h.focus(null); h.leave();
  assert.equal(h.key().prevented, undefined);
  h.hover(target); h.blur();
  assert.equal(h.key().prevented, undefined);
  h.hover(target); h.hide();
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.calls.length, 0);
  h.show(); h.hover(target);
  assert.equal(h.key().prevented, true);
});

test("uses the shared configured shortcut and applies live shortcut changes", async () => {
  const h = harness({ shortcut: "KeyF" });
  await h.flush();
  h.hover(h.artwork("https://www.pixiv.net/artworks/1"));
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.key({ code: "KeyF" }).prevented, true);
  await h.flush();
  h.changeShortcut("Digit7");
  assert.equal(h.key({ code: "KeyF" }).prevented, undefined);
  assert.equal(h.key({ code: "Digit7" }).prevented, true);
});

test("deduplicates pending artwork IDs and serializes different artworks with a gap", async () => {
  let resolveFirst;
  const h = harness({ response: () => h.calls.length === 1
    ? new Promise((resolve) => { resolveFirst = resolve; })
    : { ok: true, status: "accepted" } });
  h.hover(h.artwork("https://www.pixiv.net/artworks/1?utm_source=a"));
  h.key();
  h.hover(h.artwork("https://www.pixiv.net/artworks/1?utm_source=b", { direct: false }));
  h.key();
  assert.equal(h.calls.length, 1);
  assert.equal(h.notices.at(-1).textContent, "alreadyQueued");
  h.hover(h.artwork("https://www.pixiv.net/artworks/2"));
  h.key();
  assert.equal(h.calls.length, 1);
  resolveFirst({ ok: true, status: "accepted" });
  await h.flush();
  assert.equal(h.calls.length, 1);
  await h.gap();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].illustId, "2");
});

test("reports failures and allows retry", async () => {
  for (const status of ["not-verified", "permission-missing", "network-error", "api-error"]) {
    const h = harness({ response: { ok: false, status } });
    h.hover(h.artwork("https://www.pixiv.net/artworks/1"));
    h.key(); await h.flush();
    assert.equal(h.notices.at(-1).dataset.tone, "error");
    h.key(); await h.gap();
    assert.equal(h.calls.length, 2);
  }
});

test("pixivision loads only link submission scripts and toast styles, with no previews", () => {
  const context = vm.createContext({ URL });
  vm.runInContext(read("src/nazurin-sites.js"), context);
  for (const host of ["www.pixivision.net", "pixivision.net"]) {
    const entry = JSON.parse(JSON.stringify(context.P2NazurinSites.scriptsForUrl(`https://${host}/`)));
    assert.deepEqual(entry.matches, [`https://${host}/*`]);
    assert.deepEqual(entry.js, ["src/site-session.js", "src/settings.js", "src/i18n.js", "src/nazurin-sites.js", "src/link-submit.js", "src/pixivision.js"]);
    assert.deepEqual(entry.css, ["src/link-submit.css"]);
  }
});
