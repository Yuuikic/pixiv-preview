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

test("uses English by default and for unsupported browser languages", () => {
  assert.equal(load("en-US").t("settingsTitle"), "P2 Settings");
  assert.equal(load("fr-FR").t("loadingPreview"), "Loading preview…");
});

test("uses Chinese for simplified and traditional Chinese browser languages", () => {
  assert.equal(load("zh-CN").t("settingsTitle"), "P2 设置");
  assert.equal(load("zh-TW").t("settingsTitle"), "P2 設定");
  assert.equal(load("zh-TW").t("loadingPreview"), "正在載入預覽圖…");
});

test("uses Japanese for Japanese browser languages and localizes document lang and support URL", () => {
  const ja = load("ja-JP");
  assert.equal(ja.isJapanese, true);
  assert.equal(ja.isChinese, false);
  assert.equal(ja.t("settingsTitle"), "P2 設定");
  assert.equal(ja.t("loadingPreview"), "プレビューを読み込み中…");
  assert.equal(ja.t("siteSupportUrl"), "https://github.com/Yuuikic/pixiv-preview/blob/main/README.ja.md#対応サイトと機能");

  const link = { dataset: { i18n: "siteSupportLink" }, textContent: "", href: "" };
  const root = {
    documentElement: { lang: "en" },
    querySelectorAll: (selector) => selector === "[data-i18n]" ? [link] : []
  };
  ja.localizeDocument(root);
  assert.equal(root.documentElement.lang, "ja");
  assert.equal(link.textContent, "対応表");
  assert.equal(link.href, "https://github.com/Yuuikic/pixiv-preview/blob/main/README.ja.md#対応サイトと機能");
});

test("substitutes dynamic labels without evaluating markup", () => {
  assert.equal(load("en").t("stickyTitle", { key: "Q" }), "Pin preview (Q)");
  assert.equal(load("ja").t("stickyTitle", { key: "Q" }), "プレビューを固定（Q）");
});

test("new clipboard and Nazurin settings have Chinese, Japanese, and English translations", () => {
  for (const language of ["en", "zh-CN", "zh-TW", "ja"]) {
    const i18n = load(language);
    for (const key of ["copyShortcut", "linkCopied", "linkCopyFailed", "nazurinAutoHide",
      "nazurinAutoHideHint", "configureNazurinFirst", "nazurinShortcut", "nazurinUnsupportedUrl", "previewBehavior", "setupTitle", "setupHint", "setupFinish", "setupRestart", "pixivDefaultReady", "setupSteps", "settingsNavigation", "siteSupportLink", "siteGrantHint", "siteEnableAll", "siteGranted", "siteNotGranted", "sitePartiallyGranted", "timingDemoTitle", "timingDemoHint", "timingDemoStickyHint"]) {
      assert.notEqual(i18n.t(key), key);
      assert.ok(language === "en" ? /[A-Za-z]/.test(i18n.t(key)) : /[\u3040-\u30ff\u4e00-\u9fff]/.test(i18n.t(key)));
    }
  }
});

test("all locale dictionaries in i18n.js share the exact same key set", () => {
  const keysByLocale = {};
  for (const locale of ["zh", "zhTW", "en", "ja"]) {
    const match = source.match(new RegExp(`const ${locale} = \\{([\\s\\S]*?)\\n  \\};`));
    assert.ok(match, `expected dictionary ${locale}`);
    const dict = vm.runInNewContext(`({${match[1]}})`);
    keysByLocale[locale] = Object.keys(dict).sort();
  }
  assert.deepEqual(keysByLocale.zhTW, keysByLocale.zh);
  assert.deepEqual(keysByLocale.en, keysByLocale.zh);
  assert.deepEqual(keysByLocale.ja, keysByLocale.zh);
  const ja = load("ja");
  for (const key of keysByLocale.ja) {
    assert.notEqual(ja.t(key), key);
  }
});
