"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/site-session.js"), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ invalidated = false, rejection = false } = {}) {
  const events = new Map();
  const changes = new Set();
  const messages = new Set();
  let requests = 0;
  const target = {
    addEventListener(type, fn) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(fn);
    },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }
  };
  const context = vm.createContext({ location: new URL("https://www.pixiv.net/bookmark_new_illust.php"), window: target, chrome: {
    storage: { onChanged: { addListener(fn) { changes.add(fn); }, removeListener(fn) { changes.delete(fn); } } },
    runtime: {
      sendMessage() {
        requests++;
        if (invalidated) {
          const error = new Error("Extension context invalidated.");
          if (rejection) return Promise.reject(error);
          throw error;
        }
        return Promise.resolve({ enabled: true });
      },
      onMessage: { addListener(fn) { messages.add(fn); }, removeListener(fn) { messages.delete(fn); } }
    }
  } });
  return {
    context, events, changes, messages,
    start() { vm.runInContext(source, context); },
    invalidate() { invalidated = true; },
    get requests() { return requests; }
  };
}

for (const rejection of [false, true]) {
  const failure = rejection ? "rejected runtime promise" : "synchronous runtime exception";
  test(`session startup handles a ${failure}`, async () => {
    const h = harness({ invalidated: true, rejection });
    assert.doesNotThrow(() => h.start());
    await flush();
    assert.equal(h.context.P2SiteSession.active, false);
    assert.equal(h.changes.size, 0);
    assert.equal(h.messages.size, 0);
    for (const listeners of h.events.values()) assert.equal(listeners.size, 0);
  });

  for (const trigger of ["focus", "pageshow", "message"]) {
    test(`${trigger} handles a ${failure} and cleans up the session once`, async () => {
      const h = harness({ rejection });
      h.start();
      await flush();
      const session = h.context.P2SiteSession;
      assert.equal(session.active, true);
      let cleanupCount = 0;
      session.onStop(() => cleanupCount++);
      session.listen(h.context.window, "click", () => assert.fail("stopped listener ran"));
      const callback = trigger === "message" ? [...h.messages][0] : [...h.events.get(trigger)][0];
      const invoke = () => callback({ type: "p2-site-access-changed" });
      h.invalidate();
      assert.doesNotThrow(invoke);
      await flush();
      assert.equal(session.active, false);
      assert.equal(cleanupCount, 1);
      assert.equal(h.changes.size, 0);
      assert.equal(h.messages.size, 0);
      for (const listeners of h.events.values()) assert.equal(listeners.size, 0);
      const requests = h.requests;
      assert.doesNotThrow(invoke);
      await flush();
      assert.equal(h.requests, requests);
      assert.equal(cleanupCount, 1);
    });
  }
}
