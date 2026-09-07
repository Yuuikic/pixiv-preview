"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const settingsSource = fs.readFileSync(path.join(projectRoot, "src/settings.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(projectRoot, "src/background.js"), "utf8");

function createHarness({
  host = "https://nazurin.example/base/",
  token = "12345:secret-token",
  verified = true,
  permitted = true,
  response = { ok: true, status: 200, json: async () => ({ error: 0 }) },
  fetchImpl = null,
  timeoutImmediately = false
} = {}) {
  let listener;
  const fetchCalls = [];
  const fetchErrors = [];
  const context = vm.createContext({
    AbortController,
    DOMException,
    URL,
    clearTimeout,
    setTimeout: timeoutImmediately
      ? (callback, milliseconds) => setTimeout(callback, milliseconds >= 10000 ? 0 : milliseconds)
      : setTimeout,
    fetch: async (...args) => {
      fetchCalls.push(args);
      try {
        return fetchImpl ? await fetchImpl(...args) : response;
      } catch (error) {
        fetchErrors.push(`${error?.stack || String(error)}\nCAUSE: ${error?.cause?.stack || error?.cause || "unknown"}`);
        throw error;
      }
    },
    chrome: {
      runtime: {
        id: "pixiv-preview-test",
        onMessage: { addListener(callback) { listener = callback; } }
      },
      storage: {
        local: {
          async get() {
            return { nazurinApiHost: host, nazurinApiToken: token, nazurinConnectionVerified: verified };
          }
        }
      },
      permissions: {
        async contains(details) {
          const expectedPattern = host ? `${new URL(host).origin}/*` : null;
          assert.equal(JSON.stringify(details), JSON.stringify({ origins: [expectedPattern] }));
          return permitted;
        }
      }
    }
  });
  context.globalThis = context;
  context.importScripts = (file) => {
    assert.equal(file, "settings.js");
    vm.runInContext(settingsSource, context, { filename: "settings.js" });
  };
  vm.runInContext(backgroundSource, context, { filename: "background.js" });

  function dispatch(message, senderUrl = "https://www.pixiv.net/bookmark_new_illust.php") {
    return new Promise((resolve, reject) => {
      const handled = listener(message, {
        id: "pixiv-preview-test",
        url: senderUrl
      }, (response) => resolve(JSON.parse(JSON.stringify(response))));
      if (handled !== true) reject(new Error("Message was not handled"));
    });
  }

  return { dispatch, fetchCalls, fetchErrors };
}

test("POSTs only the internally constructed canonical Pixiv artwork URL", async () => {
  const harness = createHarness();
  const result = await harness.dispatch({
    type: "pfp-nazurin-submit",
    illustId: "149183983",
    requestId: "request-1",
    url: "https://attacker.invalid/ignored"
  });

  assert.deepEqual(result, { ok: true, status: "accepted" });
  assert.equal(harness.fetchCalls.length, 1);
  const [endpoint, options] = harness.fetchCalls[0];
  assert.equal(endpoint, "https://nazurin.example/base/12345:secret-token/api");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), {
    url: "https://www.pixiv.net/artworks/149183983"
  });
});

test("rejects missing optional permission without making a network request", async () => {
  const harness = createHarness({ permitted: false });
  const result = await harness.dispatch({
    type: "pfp-nazurin-submit",
    illustId: "42",
    requestId: "request-2"
  });
  assert.deepEqual(result, { ok: false, status: "permission-missing" });
  assert.equal(harness.fetchCalls.length, 0);
});

test("tests the real POST route with a side-effect-free missing-url request", async () => {
  const harness = createHarness({ response: { ok: false, status: 400 } });
  const result = await harness.dispatch(
    { type: "pfp-nazurin-test", requestId: "test-1" },
    "chrome-extension://pixiv-preview-test/popup/popup.html"
  );
  assert.deepEqual(result, { ok: true, status: "reachable" });
  assert.equal(harness.fetchCalls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(harness.fetchCalls[0][1].body), {});
});

test("refuses submissions until the saved configuration has passed a connection test", async () => {
  const harness = createHarness({ verified: false });
  assert.deepEqual(await harness.dispatch({
    type: "pfp-nazurin-submit", illustId: "42", requestId: "unverified-1"
  }), { ok: false, status: "not-verified" });
  assert.equal(harness.fetchCalls.length, 0);
});

test("reports whether Nazurin is ready without exposing credentials", async () => {
  const ready = createHarness();
  assert.deepEqual(await ready.dispatch({ type: "pfp-nazurin-status" }), {
    configured: true,
    verified: true
  });
  const unverified = createHarness({ verified: false });
  assert.deepEqual(await unverified.dispatch({ type: "pfp-nazurin-status" }), {
    configured: true,
    verified: false
  });
});

test("works end-to-end against a local mock Nazurin HTTP server", async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: 0 }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const host = `http://127.0.0.1:${address.port}/`;
  const localHarness = createHarness({
    host,
    token: "local:token",
    fetchImpl: (url, options) => global.fetch(String(url), {
      method: String(options.method),
      headers: Object.fromEntries(Object.entries(options.headers || {})),
      body: options.body === undefined ? undefined : String(options.body)
    })
  });
  const result = await localHarness.dispatch({
    type: "pfp-nazurin-submit",
    illustId: "987654",
    requestId: "local-1"
  });
  assert.deepEqual(result, { ok: true, status: "accepted" },
    `URL: ${String(localHarness.fetchCalls[0]?.[0])}\n${localHarness.fetchErrors.join("\n")}`);
  assert.deepEqual(requests, [{
    method: "POST",
    url: "/local:token/api",
    body: JSON.stringify({ url: "https://www.pixiv.net/artworks/987654" })
  }]);
});

test("normalizes HTTP, API, and malformed response failures", async (t) => {
  await t.test("http error", async () => {
    const harness = createHarness({ response: { ok: false, status: 503 } });
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "1", requestId: "http-1"
    }), { ok: false, status: "http-error", message: "HTTP 503" });
  });

  await t.test("api error", async () => {
    const harness = createHarness({
      response: { ok: true, status: 200, json: async () => ({ error: 12, message: "bad request" }) }
    });
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "1", requestId: "api-1"
    }), { ok: false, status: "api-error", message: "bad request" });
  });

  await t.test("invalid json", async () => {
    const harness = createHarness({
      response: { ok: true, status: 200, json: async () => { throw new Error("invalid"); } }
    });
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "1", requestId: "json-1"
    }), { ok: false, status: "invalid-response" });
  });

  await t.test("network error", async () => {
    const harness = createHarness({ fetchImpl: async () => { throw new TypeError("offline"); } });
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "1", requestId: "network-1"
    }), { ok: false, status: "network-error" });
  });

  await t.test("timeout", async () => {
    const harness = createHarness({
      timeoutImmediately: true,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")),
          { once: true });
      })
    });
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "1", requestId: "timeout-1"
    }), { ok: false, status: "timeout" });
  });
});
