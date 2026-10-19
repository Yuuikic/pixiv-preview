"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness({ origins = [], grants = [], server = "https://nazurin.example/", initialized = true } = {}) {
  const stored = { p2EnabledSiteOrigins: [...origins], p2SiteDefaultsInitialized: initialized, nazurinApiHost: server };
  const permissions = new Set(grants.map((origin) => `${origin}/*`));
  const scripts = new Map();
  const removed = [];
  let failRegistration = false;
  const context = vm.createContext({ URL, chrome: {
    storage: { local: {
      async get() { return { ...stored }; },
      async set(values) { Object.assign(stored, plain(values)); }
    } },
    permissions: {
      async contains({ origins }) { return origins.every((origin) => permissions.has(origin)); },
      async remove({ origins }) { removed.push(...origins); origins.forEach((origin) => permissions.delete(origin)); return true; }
    },
    scripting: {
      async getRegisteredContentScripts() { return Array.from(scripts.values()); },
      async registerContentScripts(entries) {
        if (failRegistration) throw new Error("registration failed");
        for (const entry of entries) scripts.set(entry.id, plain(entry));
      },
      async updateContentScripts(entries) { for (const entry of entries) scripts.set(entry.id, plain(entry)); },
      async unregisterContentScripts({ ids }) { for (const id of ids) scripts.delete(id); }
    }
  } });
  for (const file of ["src/settings.js", "src/nazurin-sites.js", "src/site-access.js"]) vm.runInContext(read(file), context);
  return { access: context.P2SiteAccess, stored, scripts, permissions, removed, restart() { vm.runInContext(read("src/site-access.js"), context); this.access = context.P2SiteAccess; }, fail(value = true) { failRegistration = value; } };
}

test("server permission and unrelated grants never activate website scripts", async () => {
  const h = harness({ grants: ["https://yande.re", "https://nazurin.example"] });
  await h.access.sync();
  assert.equal(h.scripts.size, 0);
  assert.equal(await h.access.isEnabled("https://yande.re/post"), false);
  assert.deepEqual(plain(await h.access.list()), { ok: true, origins: [] });
});

test("activation needs a grant and registers only the chosen origin with one adapter", async () => {
  const h = harness();
  await assert.rejects(h.access.setEnabled("https://yande.re", true), /permission missing/);
  assert.equal(h.scripts.size, 0);
  h.permissions.add("https://yande.re/*");
  await h.access.setEnabled("https://yande.re", true);
  const script = Array.from(h.scripts.values())[0];
  assert.deepEqual(script.matches, ["https://yande.re/*"]);
  assert.ok(script.js.includes("src/board-preview.js"));
  assert.equal(script.js.includes("src/generic-submit.js"), false);
  assert.equal(await h.access.isEnabled("https://yande.re/post"), true);
  assert.equal(await h.access.isEnabled("https://www.yande.re/post"), false);
  await assert.rejects(h.access.setEnabled("https://evil.example", true), /Unsupported/);
  await assert.rejects(h.access.setEnabled("https://yande.re/post", true), /Unsupported/);
});

test("restart, update and concurrent activation reconcile without duplicate registrations", async () => {
  const h = harness({ origins: ["https://yande.re"], grants: ["https://yande.re", "https://konachan.net"] });
  await h.access.sync();
  const old = Array.from(h.scripts.values())[0];
  old.js = ["obsolete.js"];
  await Promise.all([h.access.sync(), h.access.setEnabled("https://konachan.net", true), h.access.sync()]);
  assert.equal(h.scripts.size, 2);
  assert.equal(Array.from(h.scripts.values()).some((entry) => entry.js.includes("obsolete.js")), false);
  assert.deepEqual(h.stored.p2EnabledSiteOrigins.sort(), ["https://konachan.net", "https://yande.re"]);
});

test("revoking access removes registrations and blocks messages even before reconciliation", async () => {
  const h = harness({ origins: ["https://yande.re"], grants: ["https://yande.re"] });
  await h.access.sync();
  h.permissions.clear();
  assert.equal(await h.access.isEnabled("https://yande.re/post"), false);
  await h.access.sync();
  assert.equal(h.scripts.size, 0);
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, []);
});

test("disabling a site releases its grant while preserving a shared Nazurin server grant", async () => {
  for (const shared of [false, true]) {
    const h = harness({ origins: ["https://yande.re"], grants: ["https://yande.re"],
      server: shared ? "https://yande.re/nazurin/" : "https://nazurin.example/" });
    await h.access.sync();
    await h.access.setEnabled("https://yande.re", false);
    assert.equal(h.scripts.size, 0);
    assert.equal(await h.access.isEnabled("https://yande.re/post"), false);
    assert.equal(h.permissions.has("https://yande.re/*"), shared);
  }
});

test("failed registration rolls activation back and reports failure", async () => {
  const h = harness({ grants: ["https://yande.re"] });
  h.fail();
  await assert.rejects(h.access.setEnabled("https://yande.re", true), /registration failed/);
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, []);
  assert.equal(h.scripts.size, 0);
});

test("a live session immediately disposes listeners and UI when disabled", async () => {
  const events = new Map();
  const changes = new Set();
  const messages = new Set();
  let enabled = true;
  const target = {
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }
  };
  const context = vm.createContext({ location: new URL("https://yande.re/post"), window: target, chrome: {
    storage: { onChanged: { addListener(fn) { changes.add(fn); }, removeListener(fn) { changes.delete(fn); } } },
    runtime: {
      async sendMessage() { return { enabled }; },
      onMessage: { addListener(fn) { messages.add(fn); }, removeListener(fn) { messages.delete(fn); } }
    }
  } });
  vm.runInContext(read("src/site-session.js"), context);
  await Promise.resolve(); await Promise.resolve();
  const session = context.P2SiteSession;
  let clicks = 0, cleanupCount = 0;
  session.listen(target, "click", () => clicks++);
  session.onStop(() => cleanupCount++);
  for (const fn of events.get("click")) fn();
  assert.equal(clicks, 1);
  for (const fn of changes) fn({ p2EnabledSiteOrigins: { newValue: [] } }, "local");
  assert.equal(session.active, false);
  assert.equal(cleanupCount, 1);
  assert.equal(events.get("click").size, 0);
  assert.equal(messages.size, 0);
  assert.equal(changes.size, 0);
  session.stop();
  assert.equal(cleanupCount, 1);
  enabled = true;
  vm.runInContext(read("src/site-session.js"), context);
  assert.notEqual(context.P2SiteSession, session);
});


test("Pixiv is enabled once by default and an explicit disable survives restart", async () => {
  const h = harness({ initialized: false, grants: ["https://www.pixiv.net"] });
  await h.access.sync();
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://www.pixiv.net"]);
  assert.equal(h.stored.p2SiteDefaultsInitialized, true);
  await h.access.setEnabled("https://www.pixiv.net", false);
  await h.access.sync();
  assert.equal(h.scripts.size, 0);
  assert.equal(h.permissions.has("https://www.pixiv.net/*"), true);
});

test("a durable opt-in completes after the popup disappears", async () => {
  const h = harness();
  await h.access.prepareRequest("https://konachan.com", "click-1");
  assert.equal(h.scripts.size, 0);
  assert.equal(h.stored.p2PendingSiteRequests.length, 1);
  // No popup completion callback runs. This is permissions.onAdded / restart.
  h.restart();
  h.permissions.add("https://konachan.com/*");
  await h.access.sync();
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://konachan.com"]);
  assert.deepEqual(h.stored.p2PendingSiteRequests, []);
  assert.equal(h.scripts.size, 1);
});

test("bulk website opt-in survives popup closure and either grant ordering", async () => {
  const context = vm.createContext({ URL });
  vm.runInContext(read("src/nazurin-sites.js"), context);
  const origins = plain(context.P2NazurinSites.accessSites.flatMap((site) => site.origins));
  for (const grantFirst of [false, true]) {
    const h = harness({ grants: grantFirst ? origins : [] });
    await Promise.all(origins.map((origin) => h.access.prepareRequest(origin, "bulk-click")));
    h.restart();
    for (const origin of origins) h.permissions.add(`${origin}/*`);
    await h.access.sync();
    assert.deepEqual([...h.stored.p2EnabledSiteOrigins].sort(), [...origins].sort());
    assert.deepEqual(h.stored.p2PendingSiteRequests, []);
    assert.equal(h.scripts.size, origins.length);
    assert.ok([...h.scripts.values()].every((script) => script.matches.length === 1 &&
      origins.includes(script.matches[0].slice(0, -2))));
  }
});

test("grant-before-intent ordering is recovered without opting in unrelated grants", async () => {
  const h = harness({ grants: ["https://konachan.com", "https://bsky.app"] });
  await h.access.sync();
  assert.equal(h.scripts.size, 0);
  await h.access.prepareRequest("https://konachan.com", "click-2");
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://konachan.com"]);
  assert.equal(h.scripts.size, 1);
});

test("denied, expired and disabled requests cannot later activate a website", async () => {
  for (const action of ["cancel", "expire", "disable"]) {
    const h = harness();
    await h.access.prepareRequest("https://konachan.com", "click-3");
    if (action === "cancel") await h.access.cancelRequest("https://konachan.com", "click-3");
    if (action === "expire") h.stored.p2PendingSiteRequests[0].createdAt -= 120001;
    if (action === "disable") await h.access.setEnabled("https://konachan.com", false);
    h.permissions.add("https://konachan.com/*");
    await h.access.sync();
    assert.equal(h.scripts.size, 0, action);
    assert.deepEqual(h.stored.p2PendingSiteRequests, [], action);
  }
});


test("failed grant completion stays retryable without losing the user's accepted grant", async () => {
  const h = harness({ grants: ["https://konachan.com"] });
  h.fail();
  await assert.rejects(h.access.prepareRequest("https://konachan.com", "click-retry"), /registration failed/);
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, []);
  assert.equal(h.stored.p2PendingSiteRequests.length, 1);
  assert.equal(h.permissions.has("https://konachan.com/*"), true);
  h.fail(false);
  await h.access.sync();
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://konachan.com"]);
  assert.equal(h.stored.p2PendingSiteRequests.length, 0);
});

test("a late cancellation cannot erase a newer opt-in for the same origin", async () => {
  const h = harness();
  await h.access.prepareRequest("https://konachan.com", "click-old");
  await h.access.prepareRequest("https://konachan.com", "click-new");
  await h.access.cancelRequest("https://konachan.com", "click-old");
  assert.equal(h.stored.p2PendingSiteRequests[0].id, "click-new");
  h.permissions.add("https://konachan.com/*");
  await h.access.sync();
  assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://konachan.com"]);
});

test("scope migration removes retired sites and registrations but preserves a shared API grant", async () => {
  for (const shared of [false, true]) {
    const retired = "https://gelbooru.com";
    const h = harness({ origins: [retired, "https://yande.re"], grants: [retired, "https://yande.re"],
      server: shared ? `${retired}/api/` : "https://nazurin.example/" });
    h.scripts.set("p2-site-old", { id: "p2-site-old", matches: [`${retired}/*`], js: ["src/generic-submit.js"] });
    await h.access.sync();
    assert.deepEqual(h.stored.p2EnabledSiteOrigins, ["https://yande.re"]);
    assert.equal(h.scripts.has("p2-site-old"), false);
    assert.equal(h.permissions.has(`${retired}/*`), shared);
    assert.equal(await h.access.isEnabled(retired), false);
    await assert.rejects(h.access.setEnabled(retired, true), /Unsupported/);
  }
});

test("scope migration preserves pixivision opt-in and its submission-only adapter", async () => {
  for (const host of ["www.pixivision.net", "pixivision.net"]) {
    const origin = `https://${host}`;
    const h = harness({ origins: [origin], grants: [origin] });
    await h.access.sync();
    assert.deepEqual(h.stored.p2EnabledSiteOrigins, [origin]);
    const script = Array.from(h.scripts.values())[0];
    assert.ok(script.js.includes("src/pixivision.js"));
    assert.equal(script.js.includes("src/preview-core.js"), false);
    assert.equal(h.removed.length, 0);
  }
});
