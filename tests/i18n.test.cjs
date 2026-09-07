"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../src/i18n.js"), "utf8");

function load(language) {
  const context = vm.createContext({ chrome: { i18n: { getUILanguage: () => language } } });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "i18n.js" });
  return context.P2I18n;
}

test("uses English by default and for non-Chinese browser languages", () => {
  assert.equal(load("en-US").t("settingsTitle"), "P² Settings");
  assert.equal(load("ja-JP").t("loadingPreview"), "Loading preview…");
});

test("uses Chinese for simplified and traditional Chinese browser languages", () => {
  assert.equal(load("zh-CN").t("settingsTitle"), "P² 设置");
  assert.equal(load("zh-TW").t("loadingPreview"), "正在加载预览图…");
});

test("substitutes dynamic labels without evaluating markup", () => {
  assert.equal(load("en").t("stickyTitle", { key: "Q" }), "Press Q to pin preview");
});
