const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
for (const surface of ["popup/popup.html", "options/options.html"]) {
  for (const version of [JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))).version, "9.8.7"]) {
    test(`${surface} displays installed manifest version ${version}`, async () => {
      const html = fs.readFileSync(path.join(root, surface), "utf8");
      const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
        textContent: "", value: "", dataset: {}, addEventListener() {},
      }]));
      const context = vm.createContext({
        document: { documentElement: {}, getElementById: id => elements.get(id) || null, querySelectorAll: () => [] },
        chrome: { runtime: { getManifest: () => ({ version }) }, storage: {
          sync: { get: async defaults => defaults }, local: { get: async defaults => defaults },
        } },
        setTimeout, clearTimeout,
      });
      context.window = context;
      for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
        const file = path.resolve(root, path.dirname(surface), src);
        vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(elements.get("extension-version").textContent, `· v${version}`);
    });
  }
}
