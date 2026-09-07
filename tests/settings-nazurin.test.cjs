"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ URL });
context.globalThis = context;
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../src/settings.js"), "utf8"),
  context,
  { filename: "settings.js" }
);
const settings = context.PixivPreviewSettings;

test("normalizes the Nazurin host while preserving a configured base path", () => {
  assert.equal(settings.normalizeNazurinApiHost("https://example.test/nazurin"),
    "https://example.test/nazurin/");
  assert.equal(settings.getNazurinPermissionPattern("https://example.test/nazurin/"),
    "https://example.test/*");
});

test("builds token paths safely even when a token contains a colon", () => {
  assert.equal(settings.buildNazurinApiEndpoint("https://example.test/base/", "bot:test-token"),
    "https://example.test/base/bot:test-token/api");
});

test("rejects credentials that could escape or alter the endpoint", () => {
  for (const token of ["", "white space", "a/b", "a\\b", "a?b", "a#b", "a&b", "a=b", "a%2Fb"]) {
    assert.equal(settings.normalizeNazurinApiToken(token), null, token);
  }
  for (const host of ["javascript:alert(1)", "https://user:pass@example.test/", "https://example.test/?x=1"]) {
    assert.equal(settings.normalizeNazurinApiHost(host), null, host);
  }
});

test("warns only for non-local HTTP hosts", () => {
  assert.equal(settings.isInsecureRemoteNazurinHost("http://127.0.0.1:8080/"), false);
  assert.equal(settings.isInsecureRemoteNazurinHost("http://localhost:8080/"), false);
  assert.equal(settings.isInsecureRemoteNazurinHost("http://192.0.2.1/"), true);
  assert.equal(settings.isInsecureRemoteNazurinHost("https://example.test/"), false);
});

test("normalizes configurable single-key shortcuts", () => {
  assert.equal(settings.normalizeShortcutCode("KeyQ", "KeyS"), "KeyQ");
  assert.equal(settings.normalizeShortcutCode("Digit7", "KeyD"), "Digit7");
  assert.equal(settings.normalizeShortcutCode("Escape", "KeyS"), "KeyS");
  assert.equal(settings.shortcutCodeLabel("KeyQ"), "Q");
  assert.equal(settings.shortcutCodeLabel("Digit7"), "7");
});
