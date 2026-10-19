"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../options/onboarding.js"), "utf8");
function harness(state = {}) {
  class Element {
    constructor(dataset = {}) { this.dataset = dataset; this.attrs = {}; this.events = {}; this.hidden = false; this.disabled = false; }
    addEventListener(type, fn) { this.events[type] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() {} scrollIntoView() {}
    querySelector() { return new Element(); }
    async click() { if (!this.disabled) await this.events.click?.(); }
  }
  const ids = ["setup-guide", "setup-controls", "setup-next", "setup-back", "setup-status", "settings-navigation", "settings-footer", "setup-progress", "settings-title", "setup-skip", "restart-setup"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const groups = Array.from({ length: 3 }, (_, i) => new Element({ setupSection: String(i) }));
  const steps = Array.from({ length: 3 }, (_, i) => new Element({ setupStep: String(i) }));
  const changes = [];
  const writes = [];
  let fail = false;
  const context = vm.createContext({
    P2SettingsMotion: { create: () => (_elements, change) => change() },
    document: {
      body: { dataset: {} },
      getElementById: (id) => elements[id],
      querySelectorAll: (selector) => selector === "[data-setup-section]" ? groups : selector === "[data-setup-step]" ? steps : [],
      querySelector: () => ({ open: false })
    },
    P2I18n: { t: (key) => key },
    chrome: { storage: {
      local: {
        async get() { return { ...state }; },
        async set(values) {
          if (fail) throw new Error("Storage unavailable");
          writes.push(values); Object.assign(state, values);
          for (const fn of changes) fn(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), "local");
        }
      },
      onChanged: { addListener(fn) { changes.push(fn); } }
    } }
  });
  vm.runInContext(source, context);
  return { state, elements, groups, steps, writes, fail() { fail = true; },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); } };
}

test("first use guides three categories starting with preview behavior and finishing persists without requiring Nazurin", async () => {
  const h = harness(); await h.flush();
  assert.equal(h.elements["setup-guide"].hidden, false);
  assert.equal(h.elements["setup-back"].disabled, true);
  assert.equal(h.groups.filter((group) => !group.hidden).length, 1);
  for (let i = 1; i <= 2; i++) {
    await h.elements["setup-next"].click(); await h.flush();
    assert.equal(h.groups[i].hidden, false);
    assert.equal(h.state.p2SetupStep, i);
    assert.equal(h.steps[i].attrs["aria-current"], "step");
  }
  assert.equal(h.elements["setup-next"].textContent, "setupFinish");
  await h.elements["setup-next"].click(); await h.flush();
  assert.equal(h.state.p2SetupCompleted, true);
  assert.equal(h.elements["setup-guide"].hidden, true);
  assert.equal(h.groups.every((group) => !group.hidden), true);
  assert.equal(h.state.nazurinApiHost, undefined);
});

test("interrupted setup resumes its saved step and normal settings do not re-show completed setup", async () => {
  const h = harness({ p2SetupStep: 2 }); await h.flush();
  assert.equal(h.groups[2].hidden, false);
  await h.elements["setup-back"].click(); await h.flush();
  assert.equal(h.state.p2SetupStep, 1);
  const reopened = harness({ ...h.state }); await reopened.flush();
  assert.equal(reopened.groups[1].hidden, false);
  const done = harness({ p2SetupCompleted: true }); await done.flush();
  assert.equal(done.elements["setup-guide"].hidden, true);
  assert.equal(done.elements["settings-navigation"].hidden, false);
});

test("skip and restart preserve existing preview preferences, grants and credentials", async () => {
  const state = { hoverDelayMs: 150, p2EnabledSiteOrigins: ["https://konachan.com"], nazurinApiToken: "test-token" };
  const h = harness(state); await h.flush();
  await h.elements["setup-skip"].click(); await h.flush();
  await h.elements["restart-setup"].click(); await h.flush();
  assert.equal(h.elements["setup-guide"].hidden, false);
  assert.equal(h.state.p2SetupStep, 0);
  assert.equal(h.state.hoverDelayMs, 150);
  assert.deepEqual(h.state.p2EnabledSiteOrigins, ["https://konachan.com"]);
  assert.equal(h.state.nazurinApiToken, "test-token");
});

test("an upgrade restart opens the first guide step even after completion and preserves existing settings", async () => {
  const state = { p2SetupCompleted: true, p2SetupStep: 2, p2SetupRestartRequested: true,
    hoverDelayMs: 150, p2EnabledSiteOrigins: ["https://www.pixiv.net"],
    nazurinApiHost: "https://nazurin.example/", nazurinApiToken: "test-token", nazurinConnectionVerified: true };
  const h = harness(state); await h.flush();
  assert.equal(h.elements["setup-guide"].hidden, false);
  assert.equal(h.groups[0].hidden, false);
  assert.equal(h.state.p2SetupRestartRequested, false);
  await h.elements["setup-skip"].click(); await h.flush();
  assert.equal(h.state.p2SetupCompleted, true);
  assert.equal(h.state.hoverDelayMs, 150);
  assert.deepEqual(h.state.p2EnabledSiteOrigins, ["https://www.pixiv.net"]);
  assert.equal(h.state.nazurinApiHost, "https://nazurin.example/");
  assert.equal(h.state.nazurinApiToken, "test-token");
  assert.equal(h.state.nazurinConnectionVerified, true);
  const reopened = harness({ ...h.state }); await reopened.flush();
  assert.equal(reopened.elements["setup-guide"].hidden, true);
});

test("failed completion is visible and keeps setup open for retry", async () => {
  const h = harness(); await h.flush(); h.fail();
  await h.elements["setup-skip"].click(); await h.flush();
  assert.equal(h.elements["setup-guide"].hidden, false);
  assert.equal(h.elements["setup-status"].textContent, "setupSaveFailed");
  assert.notEqual(h.state.p2SetupCompleted, true);
});


test("settings keep access controls inside Nazurin and start setup with preview behavior", () => {
  for (const file of ["options/options.html", "popup/popup.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(html, /id="settings-preview"[^>]*data-setup-section="0"/);
    assert.match(html, /id="settings-nazurin"[^>]*data-setup-section="2"/);
    const start = html.indexOf('<section id="settings-nazurin"');
    const end = html.indexOf('</section>', start);
    assert.ok(html.indexOf('id="site-access-grid"') > start && html.indexOf('id="site-access-grid"') < end);
    assert.match(html, /README.md#站点功能支持/);
    assert.doesNotMatch(html, /id="site-url"/);
    assert.ok(html.indexOf('class="nazurin-settings settings-subgroup"') < html.indexOf('id="settings-sites"'));
    assert.match(html, /<h3 data-i18n="nazurinConnection"><\/h3>/);
    assert.doesNotMatch(html, /data-i18n="quickCollect"/);
    const access = html.match(/<details id="settings-sites"[^>]*>/)[0];
    assert.equal(/\bopen\b/.test(access), file.startsWith("options/"));
  }
});
