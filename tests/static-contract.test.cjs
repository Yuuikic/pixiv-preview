"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("manifest keeps Nazurin access optional and avoids expansive API permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "0.11.0");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.options_page, "options/options.html");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.pixiv.net/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
  for (const forbidden of ["tabs", "cookies", "downloads", "webRequest", "notifications"]) {
    assert.equal(manifest.permissions.includes(forbidden), false);
  }
});

test("content script contains the keyboard and queue safety contracts", () => {
  const source = read("src/content.js");
  assert.match(source, /event\.code === nazurinShortcutCode/);
  assert.match(source, /event\.code === stickyShortcutCode/);
  assert.match(source, /!event\.repeat/);
  assert.match(source, /!event\.metaKey && !event\.ctrlKey && !event\.altKey/);
  assert.match(source, /NAZURIN_QUEUE_GAP_MS = 1000/);
  assert.match(source, /pfp-cancel-nazurin/);
  assert.match(source, /t\("queueSummary", stats\)/);
  assert.match(source, /nazurin\.hidden = !nazurinEnabled/);
  assert.match(source, /ESCAPE_RESTORE_WINDOW_MS = 10000/);
  assert.match(source, /if \(event\.repeat\) return;/);
  assert.match(source, /restoreEscapeHistory\(\)/);
  assert.match(source, /discardEscapeHistory\(\)/);
});

test("automatic pinned-window arrangement is wired through settings and edge-lane layout", () => {
  const source = read("src/content.js");
  assert.match(source, /settings\.AUTO_ARRANGE_STORAGE_KEY/);
  assert.match(source, /visibleArtworkBounds\(\)/);
  assert.match(source, /arrangePinnedWindows\(\)/);
  assert.match(source, /AUTO_DOCK_CONTENT_GAP_PX/);
  assert.match(source, /releaseAutoDocking\(\{ manual: true \}\)/);
  assert.match(read("popup/popup.html"), /id="auto-arrange"/);
  assert.match(read("options/options.html"), /id="auto-arrange"/);
  assert.match(read("src/preview.css"), /\.pfp-root\.pfp-is-auto-docked/);
});

test("the bundled Nazurin icon is the expected 48px PNG", () => {
  const data = fs.readFileSync(path.join(root, "assets/nazurin-48.png"));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(data.readUInt32BE(16), 48);
  assert.equal(data.readUInt32BE(20), 48);
});

test("P² ships localized metadata, options, and deterministic icon sizes", () => {
  for (const locale of ["en", "zh_CN", "zh_TW"]) {
    const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
    assert.equal(messages.extensionName.message, "P²");
  }
  assert.match(read("popup/popup.html"), /id="open-options"/);
  assert.match(read("options/options.html"), /data-settings-surface="options"/);
  for (const size of [16, 32, 48, 128]) {
    const data = fs.readFileSync(path.join(root, `assets/icon-${size}.png`));
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
});
