"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({ surface = "popup/popup.html", preference, enabledOrigins = [], host = "https://nazurin.example/" } = {}) {
  const elements = new Map();
  for (const [, id] of read(surface).matchAll(/\bid="([^"]+)"/g)) {
    const events = {};
    elements.set(id, {
      value: "", checked: false, disabled: false, textContent: "", dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener(name, callback) { (events[name] ||= []).push(callback); },
      async emit(name) { for (const callback of events[name] || []) await callback({}); }
    });
  }
  const changes = [], writes = [], removedPermissions = [];
  const sync = preference === undefined ? {} : { nazurinKonachanNetToCom: preference };
  const local = {
    nazurinApiHost: host, p2EnabledSiteOrigins: enabledOrigins,
    nazurinApiToken: "test:token", nazurinConnectionVerified: true
  };
  const rows = ["nazurin-shortcut", "nazurin-auto-hide"].map((id) => ({
    dataset: {}, querySelector() { return elements.get(id); }
  }));
  const context = vm.createContext({
    URL, setTimeout() { return 1; }, clearTimeout() {},
    window: { setTimeout() { return 1; } },
    document: {
      getElementById(id) {
        if (["open-options", "start-setup"].includes(id) && !elements.has(id)) return null;
        assert.ok(elements.has(id), id);
        return elements.get(id);
      },
      querySelectorAll(selector) {
        if (selector === "[data-nazurin-dependent]") return rows;
        return [];
      }
    },
    chrome: {
      permissions: { async remove(details) { removedPermissions.push(JSON.parse(JSON.stringify(details))); return true; } },
      runtime: { getManifest() { return { version: "1.1.1" }; } },
      storage: {
        sync: {
          async get(defaults) {
            return { ...defaults, ...sync };
          },
          async set(values) {
            writes.push(JSON.parse(JSON.stringify(values)));
            Object.assign(sync, values);
            for (const callback of changes) {
              await callback(Object.fromEntries(Object.entries(values).map(([key, value]) =>
                [key, { newValue: value }])), "sync");
            }
          }
        },
        local: { async remove(keys) { for (const key of keys) delete local[key]; }, async get(defaults) {
          if (Array.isArray(defaults)) return Object.fromEntries(defaults.map((key) => [key, local[key]]));
          return { ...defaults, ...local };
        } },
        onChanged: { addListener(callback) { changes.push(callback); } }
      }
    },
    P2I18n: { t: (key) => key, localizeDocument() {} }
  });
  vm.runInContext(read("src/settings.js"), context);
  vm.runInContext(read("popup/popup.js"), context);
  return {
    elements, writes, local, removedPermissions,
    async flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  };
}

test("both settings surfaces load and reset without a Konachan switch or credential changes", async () => {
  for (const surface of ["popup/popup.html", "options/options.html"]) {
    assert.doesNotMatch(read(surface), /konachan-net-to-com|konachanNetToCom/);
    const h = harness({ surface, preference: false });
    await h.flush();
    assert.equal(h.elements.get("nazurin-shortcut").disabled, false);
    const credentials = { ...h.local };
    await h.elements.get("reset-button").emit("click"); await h.flush();
    assert.deepEqual(h.local, credentials);
    assert.ok(h.writes.length > 0);
    assert.ok(h.writes.every((values) => !Object.keys(values).some((key) =>
      ["nazurinKonachanNetToCom", "nazurinApiHost", "nazurinApiToken", "nazurinConnectionVerified"].includes(key))));
  }
});

test("clearing Nazurin releases only server access and preserves an enabled website's grant", async () => {
  for (const shared of [false, true]) {
    const h = harness({ host: "https://yande.re/nazurin/", enabledOrigins: shared ? ["https://yande.re"] : [] });
    await h.flush();
    await h.elements.get("nazurin-clear").emit("click"); await h.flush();
    assert.equal(h.local.nazurinApiHost, undefined);
    assert.equal(h.local.nazurinApiToken, undefined);
    assert.deepEqual(h.local.p2EnabledSiteOrigins, shared ? ["https://yande.re"] : []);
    assert.deepEqual(h.removedPermissions, shared ? [] : [{ origins: ["https://yande.re/*"] }]);
  }
});
