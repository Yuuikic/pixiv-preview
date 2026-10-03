"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const functions = source.slice(source.indexOf("  function cancelBackgroundRequest("),
  source.indexOf("  function requestNazurinStatus("));

test("invalidated runtime rejects metadata cleanly and resolves submission failure", async () => {
  const context = vm.createContext({ chrome: { runtime: { sendMessage() {
    throw new Error("Extension context invalidated.");
  } } }, DOMException });
  vm.runInContext(functions, context);
  let listenerRemoved = false;
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { listenerRemoved = true; } };
  await assert.rejects(context.requestArtworkPages("123", signal), /context invalidated/);
  assert.equal(listenerRemoved, true);
  assert.equal((await context.requestNazurinSubmit("123", "request")).status, "network-error");
  assert.doesNotThrow(() => context.cancelBackgroundRequest({ type: "pfp-cancel-pages" }));
});

test("cancellation consumes rejected runtime promises", async () => {
  const context = vm.createContext({ chrome: { runtime: { sendMessage() {
    return Promise.reject(new Error("Extension context invalidated."));
  } } } });
  vm.runInContext(functions, context);
  context.cancelBackgroundRequest({ type: "pfp-cancel-nazurin" });
  await new Promise((resolve) => setImmediate(resolve));
});
