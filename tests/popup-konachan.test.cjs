"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({ surface = "popup/popup.html", preference, configured = true, deferSync = false } = {}) {
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
  let releaseSync;
  const sync = preference === undefined ? {} : { nazurinKonachanNetToCom: preference };
  const local = {
    nazurinApiHost: configured ? "https://nazurin.example/" : "",
    nazurinApiToken: configured ? "test:token" : "", nazurinConnectionVerified: configured
  };
  const rows = ["nazurin-shortcut", "nazurin-auto-hide", "konachan-net-to-com"].map((id) => ({
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
            const snapshot = { ...defaults, ...sync };
            return deferSync ? new Promise((resolve) => { releaseSync = () => resolve(snapshot); }) : snapshot;
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
    elements, writes, sync, local,
    releaseSync() { releaseSync(); },
    async flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); },
    async externalPreference(value) {
      if (value === undefined) delete sync.nazurinKonachanNetToCom;
      else sync.nazurinKonachanNetToCom = value;
      for (const callback of changes) await callback({
        nazurinKonachanNetToCom: { newValue: value }
      }, "sync");
    }
  };
}

test("both settings surfaces persist the default-on conversion switch and restore it without clearing credentials", async () => {
  for (const surface of ["popup/popup.html", "options/options.html"]) {
    assert.match(read(surface), /id="konachan-net-to-com"[^>]*checked disabled/);
    const h = harness({ surface });
    await h.flush();
    const checkbox = h.elements.get("konachan-net-to-com");
    assert.equal(checkbox.checked, true);
    assert.equal(checkbox.disabled, false);
    checkbox.checked = false;
    await checkbox.emit("change"); await h.flush();
    assert.deepEqual(h.writes.at(-1), { nazurinKonachanNetToCom: false });
    const reopened = harness({ surface, preference: h.sync.nazurinKonachanNetToCom });
    await reopened.flush();
    assert.equal(reopened.elements.get("konachan-net-to-com").checked, false);
    const credentials = { ...h.local };
    await h.elements.get("reset-button").emit("click"); await h.flush();
    assert.equal(checkbox.checked, true);
    assert.equal(h.sync.nazurinKonachanNetToCom, true);
    assert.deepEqual(h.local, credentials);
    assert.ok(h.writes.every((values) => !Object.keys(values).some((key) =>
      ["nazurinApiHost", "nazurinApiToken", "nazurinConnectionVerified"].includes(key))));
  }
});

test("settings honor explicit false and synchronize updates/removal across open surfaces", async () => {
  const h = harness({ preference: false });
  await h.flush();
  const checkbox = h.elements.get("konachan-net-to-com");
  assert.equal(checkbox.checked, false);
  await h.externalPreference(true);
  assert.equal(checkbox.checked, true);
  await h.externalPreference(false);
  assert.equal(checkbox.checked, false);
  await h.externalPreference(undefined);
  assert.equal(checkbox.checked, true);
});

test("conversion is locked until valid Nazurin credentials are saved", async () => {
  const h = harness({ configured: false });
  await h.flush();
  const checkbox = h.elements.get("konachan-net-to-com");
  assert.equal(checkbox.disabled, true);
  checkbox.checked = false;
  await checkbox.emit("change"); await h.flush();
  assert.equal(h.writes.length, 0);
});

test("a delayed startup read cannot overwrite a newer conversion setting", async () => {
  const h = harness({ deferSync: true, preference: true });
  await h.flush();
  await h.externalPreference(false);
  h.releaseSync(); await h.flush();
  assert.equal(h.elements.get("konachan-net-to-com").checked, false);
});
