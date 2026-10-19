"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness({ url = "https://yande.re/post", granted = true, registrationFails = false, surface = "popup", initialOrigins = [] } = {}) {
  class Element {
    constructor() { this.children = []; this.events = {}; this.disabled = false; this.dataset = {}; this.attrs = {}; }
    addEventListener(type, fn) { this.events[type] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    async click() { if (!this.disabled) await this.events.click?.(); }
  }
  const elements = Object.fromEntries(["site-access-status", "enabled-sites", "current-site-access", "enable-current-site", "current-site-name", "site-access-grid", "enable-all-sites", "enable-pixiv"].map((id) => [id, new Element()]));
  let origins = [...initialOrigins];
  let storageListener;
  const requests = [], releases = [], messages = [];
  const context = vm.createContext({ URL,
    document: { body: { dataset: { settingsSurface: surface } },
      getElementById: (id) => elements[id], createElement: () => new Element() },
    P2I18n: { t: (key) => key },
    chrome: {
      tabs: { async query() { return [{ url }]; } },
      permissions: {
        async request(details) { requests.push(JSON.parse(JSON.stringify(details))); return granted; },
        async remove(details) { releases.push(JSON.parse(JSON.stringify(details))); },
        onAdded: { addListener() {} }, onRemoved: { addListener() {} }
      },
      runtime: { async sendMessage(message) {
        messages.push(message);
        if (message.type === "p2-site-prepare" && registrationFails) return { ok: false };
        if (message.type === "p2-site-enable") {
          if (registrationFails) return { ok: false };
          origins = [...new Set([...origins, message.origin])];
        }
        if (message.type === "p2-site-disable") origins = origins.filter((origin) => origin !== message.origin);
        return { ok: true, origins };
      } },
      storage: { local: { async get() { return {}; } }, onChanged: { addListener(fn) { storageListener = fn; } } }
    }
  });
  vm.runInContext(read("src/nazurin-sites.js"), context);
  vm.runInContext(read("popup/site-access.js"), context);
  return { elements, requests, releases, messages,
    revoke(origin) {
      origins = origins.filter((value) => value !== origin);
      storageListener({ p2EnabledSiteOrigins: { newValue: origins } }, "local");
    },
    async flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); } };
}

test("popup identifies the active site without requesting anything until enable is clicked", async () => {
  const h = harness(); await h.flush();
  assert.equal(h.elements["current-site-name"].textContent, "yande.re");
  assert.equal(h.elements["current-site-access"].hidden, false);
  assert.equal(h.elements["enable-current-site"].hidden, false);
  assert.deepEqual(h.requests, []);
  await h.elements["enable-current-site"].click(); await h.flush();
  assert.deepEqual(h.requests, [{ origins: ["https://yande.re/*"] }]);
  assert.equal(h.messages.find((message) => message.type !== "p2-site-list").type, "p2-site-prepare");
  assert.equal(h.elements["site-access-status"].textContent, "siteEnabledRefresh");
  assert.equal(h.elements["enable-current-site"].disabled, true);
  const row = h.elements["enabled-sites"].children[0];
  await row.children[1].click(); await h.flush();
  assert.equal(h.elements["site-access-status"].textContent, "siteDisabled");
  assert.equal(h.elements["enable-current-site"].disabled, false);
});

test("declined permission cancels the durable request; failed setup keeps the grant for retry", async () => {
  const denied = harness({ granted: false }); await denied.flush();
  await denied.elements["enable-current-site"].click();
  assert.equal(denied.elements["site-access-status"].textContent, "sitePermissionDenied");
  assert.equal(denied.messages.some((message) => message.type === "p2-site-enable"), false);
  const failed = harness({ registrationFails: true }); await failed.flush();
  await failed.elements["enable-current-site"].click();
  assert.equal(failed.elements["site-access-status"].textContent, "siteAccessFailed");
  assert.deepEqual(failed.releases, []);
  assert.ok(denied.messages.some((message) => message.type === "p2-site-cancel"));
});

test("unsupported pages cannot request a grant or enable a generic script", async () => {
  const h = harness({ url: "https://evil.example/" }); await h.flush();
  assert.equal(h.elements["enable-current-site"].disabled, true);
  assert.equal(h.elements["enable-current-site"].hidden, true);
  assert.equal(h.elements["current-site-access"].hidden, true);
  assert.equal(h.elements["current-site-name"].textContent, "");
  await h.elements["enable-current-site"].click();
  assert.deepEqual(h.requests, []);
});


test("a site button authorizes all of its exact aliases and reflects partial access and revocation", async () => {
  const h = harness({ surface: "options", initialOrigins: ["https://www.pixiv.net", "https://yande.re"] });
  await h.flush();
  assert.equal(h.elements["site-access-grid"].children.length, 6);
  const partial = h.elements["site-access-grid"].children[1];
  assert.equal(partial.dataset.granted, "false");
  assert.equal(partial.children[1].textContent, "sitePartiallyGranted");
  await partial.click(); await h.flush();
  assert.deepEqual(h.requests, [{ origins: ["https://www.yande.re/*"] }]);
  const granted = h.elements["site-access-grid"].children[1];
  assert.equal(granted.dataset.granted, "true");
  assert.equal(granted.disabled, true);
  h.revoke("https://www.yande.re");
  assert.equal(h.elements["site-access-grid"].children[1].dataset.granted, "false");
  assert.equal(h.elements["site-access-grid"].children[1].disabled, false);
});

test("authorize all requests only supported exact hosts in one prompt and enables them all", async () => {
  const h = harness({ surface: "options", initialOrigins: ["https://www.pixiv.net"] }); await h.flush();
  assert.equal(h.requests.length, 0);
  await h.elements["enable-all-sites"].click(); await h.flush();
  const expected = ["danbooru.donmai.us", "yande.re", "www.yande.re", "konachan.com", "www.konachan.com",
    "konachan.net", "www.konachan.net", "zerochan.net", "www.zerochan.net", "x.com", "www.x.com", "twitter.com",
    "www.twitter.com", "mobile.x.com", "mobile.twitter.com", "pixivision.net", "www.pixivision.net"];
  assert.deepEqual(h.requests, [{ origins: expected.map((host) => `https://${host}/*`) }]);
  const actions = h.messages.filter((message) => message.type !== "p2-site-list");
  assert.ok(actions.slice(0, expected.length).every((message) => message.type === "p2-site-prepare"));
  assert.equal(h.elements["site-access-grid"].children.every((button) => button.dataset.granted === "true"), true);
  assert.equal(h.elements["enable-all-sites"].disabled, true);
});

test("declining authorize all cancels every durable request and leaves buttons ungranted", async () => {
  const h = harness({ surface: "options", granted: false, initialOrigins: ["https://www.pixiv.net"] }); await h.flush();
  await h.elements["enable-all-sites"].click(); await h.flush();
  assert.equal(h.requests.length, 1);
  const prepared = h.messages.filter((message) => message.type === "p2-site-prepare");
  const cancelled = h.messages.filter((message) => message.type === "p2-site-cancel");
  assert.deepEqual(cancelled.map((message) => message.origin), prepared.map((message) => message.origin));
  assert.equal(h.elements["site-access-grid"].children.every((button) => button.dataset.granted === "false"), true);
  assert.equal(h.messages.some((message) => message.type === "p2-site-enable"), false);
});
