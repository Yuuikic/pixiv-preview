"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const statusFunction = source.slice(source.indexOf("  function requestNazurinStatus("),
  source.indexOf("  async function getArtworkMetadata("));

function harness(replies) {
  let calls = 0;
  const delays = [];
  const runtime = {
    sendMessage(message, callback) {
      assert.equal(message.type, "pfp-nazurin-status");
      const reply = replies[Math.min(calls++, replies.length - 1)];
      if (reply === "throw") throw new Error("Background unavailable");
      runtime.lastError = reply === "error" ? { message: "Background unavailable" } : undefined;
      callback(reply === "error" ? undefined : reply);
      runtime.lastError = undefined;
    }
  };
  const context = vm.createContext({
    chrome: { runtime },
    window: { setTimeout(callback, delay) { delays.push(delay); callback(); } }
  });
  vm.runInContext(statusFunction, context);
  return { query: () => context.requestNazurinStatus(), calls: () => calls, delays };
}

test("restores saved verification after background startup failures without retesting", async () => {
  const state = harness(["error", "throw", { configured: true, verified: true }]);
  assert.equal(await state.query(), true);
  assert.equal(state.calls(), 3);
  assert.deepEqual(state.delays, [500, 1000]);
});

test("does not retry valid disabled states", async () => {
  for (const reply of [{ configured: true, verified: false }, { configured: false, verified: false }]) {
    const state = harness([reply]);
    assert.equal(await state.query(), false);
    assert.equal(state.calls(), 1);
  }
});

test("bounds retries when the background keeps failing or returns no status", async () => {
  for (const reply of ["error", undefined]) {
    const state = harness([reply]);
    assert.equal(await state.query(), false);
    assert.equal(state.calls(), 4);
    assert.deepEqual(state.delays, [500, 1000, 1500]);
  }
});
