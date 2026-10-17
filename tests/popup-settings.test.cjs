"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({ surface = "popup/popup.html", preference } = {}) {
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
  const changes = [], writes = [];
  const sync = preference === undefined ? {} : { nazurinKonachanNetToCom: preference };
  const local = {
    nazurinApiHost: "https://nazurin.example/",
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
        if (id === "open-options" && !elements.has(id)) return null;
        assert.ok(elements.has(id), id);
        return elements.get(id);
      },
      querySelectorAll(selector) {
        if (selector === "[data-nazurin-dependent]") return rows;
        return [];
      }
    },
    chrome: {
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
        local: { async get(defaults) {
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
    elements, writes, local,
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
