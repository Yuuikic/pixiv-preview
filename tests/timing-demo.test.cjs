"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
function harness(mode = "0") {
  class Element {
    constructor() { this.events = {}; this.hidden = false; this.value = ""; this.textContent = ""; this.dataset = {}; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    emit(name) { for (const fn of this.events[name] || []) fn(); }
  }
  const ids = ["timing-demo", "timing-demo-target", "timing-demo-hint", "delay-number", "delay-range",
    "residue-number", "residue-range", "sticky-shortcut", "auto-arrange", "reset-button"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements["delay-number"].value = "150"; elements["residue-number"].value = "350";
  elements["sticky-shortcut"].textContent = "Q";
  const body = new Element(); body.dataset.setupMode = mode;
  const document = new Element(); document.body = body;
  document.baseURI = "chrome-extension://fixture/options/options.html";
  document.getElementById = (id) => elements[id];
  const wide = new Element(); wide.matches = true;
  const observers = [];
  let adapter, closed = 0;
  const manager = { closeAll() { closed++; } };
  const context = vm.createContext({ URL, document,
    chrome: { i18n: { getUILanguage: () => "zh-CN" } }, window: { matchMedia: () => wide },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target) { observers.push({ target, fn: this.fn }); } },
    P2SettingsMotion: { create: () => (_elements, change) => change() },
    P2PreviewCore: { start(value) { adapter = value; return manager; } }
  });
  for (const file of ["src/settings.js", "src/i18n.js", "options/timing-demo.js"]) vm.runInContext(read(file), context);
  const notify = (target) => observers.filter((observer) => observer.target === target).forEach(({ fn }) => fn());
  return { elements, adapter, wide, manager, closed: () => closed,
    mode(value) { body.dataset.setupMode = value; notify(body); },
    shortcut(label) { elements["sticky-shortcut"].textContent = label; notify(elements["sticky-shortcut"]); } };
}

test("logo demo uses the shared preview core with local images, hidden tools and blocked copy/submission", async () => {
  const h = harness();
  assert.equal(h.adapter.toolbar, false);
  assert.equal(h.adapter.copyLink, false);
  assert.equal(h.adapter.nazurin, false);
  const metadata = await h.adapter.load();
  assert.equal(metadata.pages[0].regular, "chrome-extension://fixture/assets/icon.png");
  assert.equal(h.adapter.safeImageUrl(metadata.pages[0].regular), metadata.pages[0].regular);
  assert.equal(h.adapter.safeImageUrl("https://evil.example/image.png"), null);
  assert.equal(h.adapter.readSettings().hoverDelayMs, "150");
  h.elements["delay-number"].value = "250";
  assert.equal(h.adapter.readSettings().hoverDelayMs, "250");
});

test("demo stays available across the first two guide steps and hides only for Nazurin", () => {
  const h = harness();
  assert.equal(h.adapter.canPreview(), true);
  assert.equal(h.adapter.canPin(), false);
  h.mode("1"); assert.equal(h.elements["timing-demo"].hidden, false);
  assert.equal(h.adapter.canPin(), true);
  assert.match(h.elements["timing-demo-hint"].textContent, /按 Q 或点击浮窗/);
  h.mode("2"); assert.equal(h.elements["timing-demo"].hidden, true);
  assert.equal(h.adapter.canPreview(), false);
  assert.equal(h.manager.pageActive, false);
  h.mode("settings"); assert.equal(h.adapter.canPreview(), true);
  assert.equal(h.adapter.canPin(), true);
});

test("pinning hint and actual shortcut follow letters and digits, ignoring the capture prompt", () => {
  const h = harness("1");
  h.shortcut("7"); assert.match(h.elements["timing-demo-hint"].textContent, /按 7 /);
  assert.equal(h.adapter.readSettings().stickyShortcutCode, "Digit7");
  h.shortcut("按下按键"); assert.equal(h.adapter.readSettings().stickyShortcutCode, "Digit7");
  h.shortcut("F"); assert.equal(h.adapter.readSettings().stickyShortcutCode, "KeyF");
  assert.match(h.elements["timing-demo-hint"].textContent, /按 F /);
});

test("narrow screens and changed controls clean up shared windows", () => {
  const h = harness("settings"); const initial = h.closed();
  h.elements["residue-number"].emit("input");
  h.elements["reset-button"].emit("click");
  h.wide.matches = false; h.wide.emit("change");
  assert.equal(h.closed(), initial + 3);
  assert.equal(h.adapter.canPreview(), false);
  assert.equal(h.manager.pageActive, false);
});
