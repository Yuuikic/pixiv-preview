"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const methods = source.slice(source.indexOf("    bringToFront(preview)"), source.indexOf("    closeWindow(preview)")) +
  source.slice(source.indexOf("    topmostWindow("), source.indexOf("    enqueueNazurin("));

test("highlights exactly the shortcut target when raised, closed, or newly constructed", () => {
  const manager = vm.runInNewContext(`new (class { ${methods} })()`);
  const makeWindow = (zIndex) => {
    const classes = new Set();
    return { classes, ui: { root: { style: { zIndex: String(zIndex) },
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } } } };
  };
  const a = makeWindow(1);
  const b = makeWindow(2);
  let windows = [a, b];
  manager.allWindows = () => windows;
  manager.zIndex = 2;
  manager.updateTopmostHighlight();
  assert.equal(b.classes.has("pfp-is-topmost"), true);
  assert.equal(a.classes.has("pfp-is-topmost"), false);
  manager.bringToFront(a);
  assert.equal(a.classes.has("pfp-is-topmost"), true);
  assert.equal(b.classes.has("pfp-is-topmost"), false);
  a.closed = true;
  manager.updateTopmostHighlight();
  assert.equal(b.classes.has("pfp-is-topmost"), true);
  assert.equal(a.classes.has("pfp-is-topmost"), false);
  windows = [b];
  const newWindow = makeWindow(0);
  manager.bringToFront(newWindow);
  assert.equal(newWindow.classes.has("pfp-is-topmost"), true);
  assert.equal(b.classes.has("pfp-is-topmost"), false);
});
