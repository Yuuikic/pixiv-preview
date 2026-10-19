"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../options/settings-motion.js"), "utf8");
function harness(reduced = false) {
  const animations = [];
  const element = { animate(frames, options) {
    let finish;
    const animation = { frames, options, finished: new Promise((resolve) => { finish = resolve; }), cancel() { this.cancelled = true; finish(); }, finish: () => finish() };
    animations.push(animation); return animation;
  } };
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: reduced }) } });
  vm.runInContext(source, context);
  return { swap: context.P2SettingsMotion.create(), element, animations,
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

test("category and hint transitions replace content only after fading out, then fade in", async () => {
  const h = harness(); let text = "old";
  const task = h.swap(() => [h.element], () => { text = "new"; });
  assert.equal(text, "old");
  assert.equal(h.animations[0].frames[1].opacity, 0);
  h.animations[0].finish(); await h.flush();
  assert.equal(text, "new");
  assert.equal(h.animations[1].frames[0].opacity, 0);
  assert.equal(h.animations[1].frames[1].opacity, 1);
  h.animations[1].finish(); await task;
});

test("rapid navigation and cancellation discard stale steps; reduced motion changes immediately", async () => {
  const h = harness(); let text = "old";
  const first = h.swap(() => [h.element], () => { text = "stale"; });
  const second = h.swap(() => [h.element], () => { text = "latest"; });
  h.animations[1].finish(); await h.flush();
  assert.equal(text, "latest");
  h.animations[2].finish(); await Promise.all([first, second]);
  const cancelled = h.swap(() => [h.element], () => { text = "cancelled"; });
  h.swap.cancel(); await cancelled; assert.equal(text, "latest");
  const reduced = harness(true);
  await reduced.swap(() => [reduced.element], () => { text = "immediate"; });
  assert.equal(text, "immediate"); assert.equal(reduced.animations.length, 0);
});
