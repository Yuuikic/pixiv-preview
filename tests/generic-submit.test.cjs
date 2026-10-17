"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({
  url = "https://yande.re/post", shortcut = "KeyD",
  status = { configured: true, verified: true },
  response = { ok: true, status: "accepted" }
} = {}) {
  const events = {}, windowEvents = {}, changes = [], calls = [], statusCalls = [], notices = [];
  const timers = new Map();
  let timerId = 0, hovered = null, focused = null;
  let statusResponse = status, submitResponse = response;
  function listen(table, name, callback) { (table[name] ||= []).push(callback); }
  function emit(table, name, event = {}) { for (const callback of table[name] || []) callback(event); }
  const context = vm.createContext({
    URL, Date, Math, location: { href: url },
    setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      addEventListener(name, callback) { listen(events, name, callback); },
      elementFromPoint() { return hovered; },
      get activeElement() { return focused; },
      createElement() { return { dataset: {}, setAttribute() {}, remove() { this.removed = true; } }; },
      documentElement: { append(element) { notices.push(element); } }
    },
    window: { addEventListener(name, callback) { listen(windowEvents, name, callback); } },
    chrome: {
      runtime: { async sendMessage(message) {
        if (message.type === "pfp-nazurin-status") {
          statusCalls.push(message);
          return typeof statusResponse === "function" ? statusResponse(message) : statusResponse;
        }
        calls.push(JSON.parse(JSON.stringify(message)));
        return typeof submitResponse === "function" ? submitResponse(message) : submitResponse;
      } },
      storage: {
        sync: { async get() { return { nazurinShortcutCode: shortcut }; } },
        onChanged: { addListener(callback) { changes.push(callback); } }
      }
    },
    P2I18n: { t: (key) => key }
  });
  for (const file of ["settings", "nazurin-sites", "link-submit", "generic-submit"]) {
    vm.runInContext(read(`src/${file}.js`), context, { filename: `${file}.js` });
  }
  return {
    calls, statusCalls, notices,
    setStatus(value) { statusResponse = value; },
    setResponse(value) { submitResponse = value; },
    navigate(value) { context.location.href = value; },
    link(href) {
      const link = { href: new URL(href, context.location.href).href };
      return { closest(selector) { assert.equal(selector, "a[href]"); return link; } };
    },
    hover(element, isTrusted = true) {
      hovered = element;
      emit(events, "pointermove", { clientX: 10, clientY: 20, isTrusted });
    },
    setTarget(element) { hovered = element; },
    focus(element) { focused = element; },
    key(overrides = {}) {
      const event = { code: "KeyD", isTrusted: true, preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...overrides };
      emit(events, "keydown", event);
      return event;
    },
    change(values, area = "local") { for (const callback of changes) callback(values, area); },
    emit(name) { emit(windowEvents, name); },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
    async timer(ms) {
      const entry = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `No timer for ${ms}ms`);
      timers.delete(entry[0]);
      entry[1].callback();
      await this.flush();
    },
    timerCount(ms) { return [...timers.values()].filter((timer) => timer.ms === ms).length; }
  };
}

test("listing thumbnails and relative work anchors submit canonical artwork links", async () => {
  const h = harness();
  assert.equal(h.key().prevented, undefined);
  await h.flush();
  h.hover(h.link("/post/show/42?tags=a%20b#image"));
  assert.equal(h.key().stopped, true);
  await h.flush();
  assert.equal(h.calls[0].type, "pfp-nazurin-link-submit");
  assert.equal(h.calls[0].url, "https://yande.re/post/show/42");
  assert.match(h.calls[0].requestId, /^link-/);
  assert.equal(h.notices.at(-1).textContent, "submissionSuccess");
  h.hover(h.link("https://gelbooru.com/index.php?page=post&s=view&id=42"));
  h.key(); await h.timer(1000);
  assert.equal(h.calls[1].url, "https://gelbooru.com/index.php?page=post&s=view&id=42");
});

test("a recognized detail page owns D over the main image, empty space and other work links", async () => {
  for (const href of [null, "https://evil.example/", "javascript:alert(1)", "https://user:pass@yande.re/"]) {
    const h = harness({ url: "https://wallhaven.cc/w/abc123?q=1#wallpaper" });
    await h.flush();
    if (href) h.hover(h.link(href));
    assert.equal(h.key().prevented, true);
    await h.flush();
    assert.equal(h.calls[0].url, "https://wallhaven.cc/w/abc123");
  }
  for (const hovered of [null, { closest: () => null }, "https://yande.re/post/show/999"]) {
    const h = harness({ url: "https://yande.re/post/show/1270390" });
    await h.flush();
    if (hovered) h.hover(typeof hovered === "string" ? h.link(hovered) : hovered);
    assert.equal(h.key().prevented, true);
    await h.flush();
    assert.equal(h.calls[0].url, "https://yande.re/post/show/1270390");
  }
});

test("list pages require a hovered work link and never submit the list itself", async () => {
  for (const href of [null, "https://yande.re/post?tags=tagme", "https://evil.example/", "javascript:alert(1)"]) {
    const h = harness();
    await h.flush();
    if (href) h.hover(h.link(href));
    assert.equal(h.key().prevented, undefined);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  await h.flush();
  h.hover(h.link("/post/show/1270390?tags=blue_archive"));
  assert.equal(h.key().prevented, true);
  await h.flush();
  assert.equal(h.calls[0].url, "https://yande.re/post/show/1270390");
});

test("scrolling and SPA navigation resolve live targets without inspecting cards or images", async () => {
  const h = harness();
  await h.flush();
  h.hover(h.link("/post/show/1"));
  h.setTarget(h.link("/post/show/2"));
  h.key(); await h.flush();
  assert.equal(h.calls[0].url, "https://yande.re/post/show/2");
  h.setTarget({ closest: () => null, src: "https://yande.re/post/show/3" });
  h.navigate("https://yande.re/post/show/4");
  h.key(); await h.timer(1000);
  assert.equal(h.calls[1].url, "https://yande.re/post/show/4");
  h.navigate("https://yande.re/post");
  assert.equal(h.key().prevented, undefined);
  h.setTarget(h.link("/post/show/5"));
  h.key(); await h.timer(1000);
  assert.equal(h.calls[2].url, "https://yande.re/post/show/5");
  h.navigate("https://evil.example/");
  assert.equal(h.key().prevented, undefined);
});

test("unsupported and legacy source pages register no generic handler or status query", async () => {
  for (const url of [
    "https://evil.example/", "http://yande.re/", "https://www.pixiv.net/",
    "https://x.com/home", "https://www.pixivision.net/", "https://cdn.donmai.us/image.png",
    "https://pixiv.net/artworks/42", "https://mobile.x.com/home", "https://mobile.twitter.com/home"
  ]) {
    const h = harness({ url });
    await h.flush();
    assert.equal(h.key().prevented, undefined, url);
    assert.equal(h.statusCalls.length, 0, url);
  }
});

test("typing, composition, modifiers and repeats never steal site shortcuts", async () => {
  const h = harness();
  await h.flush();
  h.hover(h.link("/post/show/42"));
  for (const flag of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"]) {
    assert.equal(h.key({ [flag]: true }).prevented, undefined);
  }
  assert.equal(h.key({ target: { closest: () => ({}) } }).prevented, undefined);
  assert.equal(h.key({ isTrusted: false }).prevented, undefined);
  h.focus({ closest: () => ({}) });
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.calls.length, 0);
});

test("synthetic pointer events cannot choose a target for a real user keypress", async () => {
  const h = harness();
  await h.flush();
  h.hover(h.link("/post/show/42"), false);
  assert.equal(h.key().prevented, undefined);
  await h.flush();
  assert.equal(h.calls.length, 0);
});

test("custom shortcuts load and update without reading credentials", async () => {
  const h = harness({ shortcut: "KeyF" });
  await h.flush();
  h.hover(h.link("/post/show/42"));
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.key({ code: "KeyF" }).prevented, true);
  await h.flush();
  h.change({ nazurinShortcutCode: { newValue: "Digit7" } }, "sync");
  assert.equal(h.key({ code: "KeyF" }).prevented, undefined);
  assert.equal(h.key({ code: "Digit7" }).prevented, true);
});

test("disabled configurations do not intercept keys and configuration changes refresh readiness", async () => {
  for (const status of [{ configured: false, verified: false }, { configured: true, verified: false }]) {
    const h = harness({ status });
    await h.flush();
    h.hover(h.link("/post/show/42"));
    assert.equal(h.key().prevented, undefined);
    assert.equal(h.statusCalls.length, 1);
    h.setStatus({ configured: true, verified: true });
    h.change({ nazurinConnectionVerified: { newValue: true } });
    assert.equal(h.key().prevented, undefined);
    await h.flush();
    assert.equal(h.key().prevented, true);
    await h.flush();
    h.setStatus({ configured: false, verified: false });
    h.change({ nazurinApiHost: { newValue: "" } });
    await h.flush();
    assert.equal(h.key().prevented, undefined);
  }
});

test("readiness retries startup failures but bounds malformed responses and ignores stale replies", async () => {
  const h = harness({ status: null });
  await h.flush();
  h.hover(h.link("/post/show/42"));
  for (const ms of [500, 1000, 1500]) await h.timer(ms);
  assert.equal(h.statusCalls.length, 4);
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.timerCount(1500), 0);

  let resolveStatus;
  h.setStatus(() => new Promise((resolve) => { resolveStatus = resolve; }));
  h.emit("focus"); await h.flush();
  h.setStatus({ configured: false, verified: false });
  h.change({ nazurinConnectionVerified: { newValue: false } });
  await h.flush();
  resolveStatus({ configured: true, verified: true });
  await h.flush();
  assert.equal(h.key().prevented, undefined);

  h.setStatus(() => { throw new Error("Background starting"); });
  h.emit("focus"); await h.flush();
  h.setStatus({ configured: true, verified: true });
  await h.timer(500);
  assert.equal(h.key().prevented, true);
});

test("Konachan conversion is fixed and equivalent work links deduplicate while queued", async () => {
  let resolveFirst;
  const h = harness({ url: "https://konachan.net/post",
    response: () => new Promise((resolve) => { resolveFirst = resolve; }) });
  await h.flush();
  h.hover(h.link("/post/show/42?tags=a#image"));
  h.key();
  h.hover(h.link("https://konachan.com/post/show/42?tags=a#image"));
  h.key();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "https://konachan.com/post/show/42");
  assert.equal(h.notices.at(-1).textContent, "linkAlreadyQueued");
  resolveFirst({ ok: false, status: "network-error" });
  await h.flush();
  assert.equal(h.notices.at(-1).textContent, "nazurinNetworkError");
  h.setResponse({ ok: true, status: "accepted" });
  h.key(); await h.timer(1000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, "https://konachan.com/post/show/42");
});

test("global failures clear queued links; transient failures allow serialized manual retry", async () => {
  for (const failure of ["not-configured", "not-verified", "permission-missing"]) {
    let resolveFirst;
    const h = harness({ response: () => new Promise((resolve) => { resolveFirst = resolve; }) });
    await h.flush();
    h.hover(h.link("/post/show/1"));
    h.key();
    h.hover(h.link("/post/show/2")); h.key();
    resolveFirst({ ok: false, status: failure }); await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.timerCount(1000), 0);
    h.setResponse({ ok: true, status: "accepted" });
    h.key(); await h.flush();
    assert.equal(h.calls.length, 2);
  }
  for (const failure of ["network-error", "timeout", "http-error", "api-error", "invalid-response"]) {
    const h = harness({ response: { ok: false, status: failure } });
    await h.flush();
    h.hover(h.link("/post/show/1"));
    h.key(); await h.flush();
    h.key();
    assert.equal(h.calls.length, 1);
    await h.timer(1000);
    assert.equal(h.calls.length, 2);
  }
});

test("pagehide clears pending work and late results cannot alter restored queues or toasts", async () => {
  let resolveOld;
  const h = harness({ response: () => new Promise((resolve) => { resolveOld = resolve; }) });
  await h.flush();
  h.hover(h.link("/post/show/1"));
  h.key();
  h.hover(h.link("/post/show/2")); h.key();
  h.emit("pagehide");
  assert.equal(h.key().prevented, undefined);
  assert.ok(h.notices.at(-1).removed);
  h.setResponse({ ok: true, status: "accepted" });
  h.emit("pageshow"); await h.flush();
  h.hover(h.link("/post/show/3"));
  assert.equal(h.key().prevented, true);
  await h.flush();
  const count = h.notices.length;
  resolveOld({ ok: false, status: "network-error" }); await h.flush();
  assert.equal(h.notices.length, count);
  assert.equal(h.calls.length, 2);
});

test("runtime invalidation disables submissions even after pageshow", async () => {
  const h = harness({ response: () => { throw new Error("Extension context invalidated"); } });
  await h.flush();
  h.hover(h.link("/post/show/1"));
  h.key(); await h.flush();
  assert.equal(h.notices.at(-1).textContent, "backgroundUnavailable");
  assert.equal(h.key().prevented, undefined);
  h.emit("pagehide"); h.emit("pageshow"); await h.flush();
  h.hover(h.link("/post/show/2"));
  assert.equal(h.key().prevented, undefined);
  assert.equal(h.calls.length, 1);
});

test("a rejected request from before pagehide cannot deactivate the restored page", async () => {
  let rejectOld;
  const h = harness({ response: () => new Promise((_resolve, reject) => { rejectOld = reject; }) });
  await h.flush();
  h.hover(h.link("/post/show/1"));
  h.key();
  h.emit("pagehide");
  h.emit("pageshow"); await h.flush();
  h.setResponse({ ok: true, status: "accepted" });
  h.hover(h.link("/post/show/2"));
  rejectOld(new Error("Old channel closed")); await h.flush();
  assert.equal(h.key().prevented, true);
  await h.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.notices.at(-1).textContent, "submissionSuccess");
});
