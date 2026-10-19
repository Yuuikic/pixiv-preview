"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/preview-core.js"), "utf8");

test("Shift+D retains the pinned-window batch contract and composition/repeats never submit", () => {
  const methods = source.slice(source.indexOf("    handleKeyDown("), source.indexOf("    handleViewportResize("));
  const context = vm.createContext({ document: {}, adapter: {}, nazurinEnabled: true,
    nazurinShortcutCode: "KeyD", stickyShortcutCode: "KeyS", copyShortcutCode: "KeyC", isEditableElement: () => false });
  const manager = vm.runInContext(`new (class { ${methods} })()`, context);
  const a = { workKey: "pixiv:1", ui: { root: { style: { zIndex: "1" } } } };
  const b = { workKey: "pixiv:2", ui: { root: { style: { zIndex: "2" } } } };
  manager.pinnedByWorkKey = new Map([[a.workKey, a], [b.workKey, b]]);
  manager.allWindows = () => [a, b];
  manager.topmostWindow = () => b;
  let submitted = [];
  manager.enqueueNazurin = (items) => { submitted.push(Array.from(items, (item) => item.workKey)); };
  manager.handleKeyDown({ code: "KeyD", shiftKey: true, preventDefault() {} });
  assert.deepEqual(submitted, [["pixiv:2", "pixiv:1"]]);
  manager.handleKeyDown({ code: "KeyD", preventDefault() {} });
  assert.deepEqual(submitted[1], ["pixiv:2"]);
  for (const flag of ["repeat", "isComposing", "ctrlKey", "metaKey", "altKey", "defaultPrevented"]) {
    manager.handleKeyDown({ code: "KeyD", shiftKey: true, [flag]: true, preventDefault() {} });
  }
  assert.equal(submitted.length, 2);
});

test("shared queue deduplicates by namespaced work key instead of numeric site ID", async () => {
  const methods = source.slice(source.indexOf("    enqueueNazurin("), source.indexOf("    waitForNazurinGap("));
  const submitted = [];
  const context = vm.createContext({ nazurinEnabled: true, nazurinAutoHide: false, NAZURIN_GLOBAL_FAILURES: new Set(),
    requestNazurinSubmit: async (work) => { submitted.push(work.url); return { ok: true, status: "accepted" }; },
    t: (key) => key });
  const manager = vm.runInContext(`new (class { ${methods} })()`, context);
  Object.assign(manager, { nazurinPendingIds: new Set(), nazurinQueue: [], nazurinQueueRevision: 0,
    nazurinProcessing: false, setNazurinStateForArtwork() {}, showNazurinToast() {}, waitForNazurinGap: async () => true });
  const works = [
    { key: "pixiv:42", url: "https://www.pixiv.net/artworks/42" },
    { key: "moebooru:yande.re:42", url: "https://yande.re/post/show/42" },
    { key: "moebooru:konachan.com:42", url: "https://konachan.com/post/show/42" }
  ];
  const previews = works.map((work) => ({ work, workKey: work.key }));
  manager.enqueueNazurin([...previews, previews[2]]);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(submitted, works.map((work) => work.url));
  assert.equal(manager.nazurinPendingIds.size, 0);
  assert.equal(manager.nazurinStats.accepted, 3);
});

test("metadata caching is shared by adapter contract while keeping sites with the same ID separate", async () => {
  const calls = [];
  const context = vm.createContext({ metadataCache: new Map(), adapter: { async load(work) {
    calls.push(work.key); return { pages: [{ regular: work.url + '/sample.jpg' }] };
  } } });
  const method = source.slice(source.indexOf("  async function getArtworkMetadata("), source.indexOf("  function findArtworkCandidate("));
  vm.runInContext(method, context);
  for (const key of ["pixiv:42", "pixiv:42", "moebooru:yande.re:42", "moebooru:yande.re:42"]) {
    await context.getArtworkMetadata({ key, url: "https://example.test" }, {});
  }
  assert.deepEqual(calls, ["pixiv:42", "moebooru:yande.re:42"]);
});

test("preview UI actions require trusted input on adapters that declare it", () => {
  const helper = source.slice(source.indexOf("    const trusted ="), source.indexOf('    listen(document, "pointerover"'));
  const context = vm.createContext({ adapter: { requireTrustedEvents: true }, chrome: { runtime: { id: "test" } } });
  vm.runInContext(helper + "globalThis.wrap = trusted;", context);
  let calls = 0;
  const handler = context.wrap(() => { calls++; });
  handler({ isTrusted: false });
  assert.equal(calls, 0);
  handler({ isTrusted: true });
  assert.equal(calls, 1);
  context.chrome.runtime.id = undefined;
  handler({ isTrusted: true });
  assert.equal(calls, 1);
});

test("demo capabilities block copy and submission but keep the configured pin shortcut", () => {
  const methods = source.slice(source.indexOf("    handleKeyDown("), source.indexOf("    handleViewportResize("));
  const context = vm.createContext({ document: {}, adapter: { copyLink: false, nazurin: false }, nazurinEnabled: true,
    nazurinShortcutCode: "KeyD", stickyShortcutCode: "Digit7", copyShortcutCode: "KeyC", isEditableElement: () => false });
  const manager = vm.runInContext(`new (class { ${methods} })()`, context);
  let copies = 0, submissions = 0, pins = 0;
  manager.allWindows = () => [{}];
  manager.copyTopmostArtworkLink = () => copies++;
  manager.enqueueNazurin = () => submissions++;
  manager.pinHoverWindow = () => { pins++; return true; };
  for (const code of ["KeyC", "KeyD", "Digit7"]) manager.handleKeyDown({ code, preventDefault() {} });
  assert.equal(copies, 0); assert.equal(submissions, 0); assert.equal(pins, 1);
});
