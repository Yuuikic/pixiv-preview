"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/content.js");
const method = source.slice(source.indexOf("    async processNazurinQueue("), source.indexOf("    waitForNazurinGap("));

test("auto-hide closes only matching artworks after accepted responses and remains off by default", async () => {
  for (const [enabled, response, expected] of [
    [false, { ok: true, status: "accepted" }, []],
    [true, { ok: true, status: "accepted" }, ["123"]],
    [true, { ok: false, status: "network-error" }, []],
    [true, { ok: true, status: "queued" }, []]
  ]) {
    const context = vm.createContext({ nazurinAutoHide: enabled, requestNazurinSubmit: async () => response,
      NAZURIN_GLOBAL_FAILURES: new Set(), t: (key) => key });
    const manager = vm.runInContext(`new (class { ${method} })()`, context);
    Object.assign(manager, { nazurinQueueRevision: 1, nazurinQueue: [{ illustId: "123" }],
      nazurinPendingIds: new Set(["123"]), nazurinStats: { accepted: 0, failed: 0, skipped: 0 },
      setNazurinStateForArtwork() {}, showNazurinToast() {}, nazurinFailureMessage: () => "failed",
      allWindows: () => [{ illustId: "123" }, { illustId: "456" }] });
    const closed = [];
    manager.closeWindow = (preview) => closed.push(preview.illustId);
    await manager.processNazurinQueue(1);
    assert.deepEqual(closed, expected);
  }
  const context = vm.createContext({});
  vm.runInContext(read("src/settings.js"), context);
  assert.equal(context.PixivPreviewSettings.DEFAULT_NAZURIN_AUTO_HIDE, false);
});

test("dependent controls unlock only for a valid saved Host and Token", () => {
  const source = read("popup/popup.js");
  const helper = source.slice(source.indexOf("  function updateNazurinDependencies("), source.indexOf("  for (const tip"));
  const controls = [{}, {}];
  const rows = controls.map((control) => ({ dataset: {}, querySelector: () => control }));
  const context = vm.createContext({ URL, document: { querySelectorAll: () => rows },
    nazurinShortcut: { classList: { remove() {} } }, updateShortcutUi() {} });
  vm.runInContext(read("src/settings.js"), context);
  vm.runInContext("const settings = PixivPreviewSettings;" + helper, context);
  for (const [host, token, locked] of [["", "", true], ["https://example.com", "", true],
    ["https://example.com", "token", false], ["", "", true]]) {
    context.updateNazurinDependencies(host, token);
    assert.equal(controls[0].disabled, locked);
    assert.equal(controls[1].disabled, locked);
  }
  for (const file of ["popup/popup.html", "options/options.html"]) {
    const html = read(file);
    assert.ok(html.indexOf('for="copy-shortcut"') < html.indexOf('for="nazurin-shortcut"'));
    assert.match(html, /data-i18n="configureNazurinFirst"/);
  }
});
