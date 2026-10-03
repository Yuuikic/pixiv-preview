"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const methods = source.slice(source.indexOf("    async copyTopmostArtworkLink()"), source.indexOf("    handleViewportResize()"));

function harness(writeText) {
  const context = vm.createContext({ navigator: { clipboard: { writeText } },
    t: (key) => key, isEditableElement: (target) => target?.editable,
    copyShortcutCode: "KeyC", stickyShortcutCode: "KeyS", nazurinShortcutCode: "KeyD", nazurinEnabled: false });
  const manager = vm.runInContext(`new (class { ${methods} })()`, context);
  manager.allWindows = () => [{}];
  manager.topmostWindow = () => ({ illustId: "123456" });
  manager.showNazurinToast = (message) => { manager.message = message; };
  return manager;
}

test("copies the topmost artwork canonical detail URL and reports success or failure", async () => {
  let copied;
  const manager = harness(async (text) => { copied = text; });
  await manager.copyTopmostArtworkLink();
  assert.equal(copied, "https://www.pixiv.net/artworks/123456");
  assert.equal(manager.message, "linkCopied");
  const failed = harness(async () => { throw new Error("Denied"); });
  await failed.copyTopmostArtworkLink();
  assert.equal(failed.message, "linkCopyFailed");
});

test("copy shortcut ignores typing, modifiers, repeats and absent previews", () => {
  const manager = harness(async () => {});
  let calls = 0;
  manager.copyTopmostArtworkLink = () => { calls++; };
  const event = { code: "KeyC", preventDefault() {} };
  manager.handleKeyDown(event);
  assert.equal(calls, 1);
  for (const flag of ["repeat", "metaKey", "ctrlKey", "altKey", "shiftKey"]) {
    manager.handleKeyDown({ ...event, [flag]: true });
  }
  manager.handleKeyDown({ ...event, target: { editable: true } });
  manager.allWindows = () => [];
  manager.handleKeyDown(event);
  assert.equal(calls, 1);
});
