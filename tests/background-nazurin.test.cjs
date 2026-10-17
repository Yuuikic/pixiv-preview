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
  timeoutImmediately = false,
  konachanNetToCom = true
} = {}) {
  let listener;
  let installedListener;
  let optionsPageOpenCount = 0;
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
        onInstalled: { addListener(callback) { installedListener = callback; } },
        openOptionsPage() { optionsPageOpenCount += 1; },
        onMessage: { addListener(callback) { listener = callback; } }
      },
      storage: {
        sync: {
          async get() { return { nazurinKonachanNetToCom: konachanNetToCom }; }
        },
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
  context.importScripts = (...files) => {
    for (const file of files) {
      assert.ok(["settings.js", "nazurin-sites.js"].includes(file));
      vm.runInContext(file === "settings.js" ? settingsSource :
        fs.readFileSync(path.join(projectRoot, "src", file), "utf8"), context, { filename: file });
    }
  };
  vm.runInContext(backgroundSource, context, { filename: "background.js" });

  function dispatch(message, senderUrl = "https://www.pixiv.net/bookmark_new_illust.php", senderOverrides = {}) {
    return new Promise((resolve, reject) => {
      const handled = listener(message, {
        id: "pixiv-preview-test",
        url: senderUrl,
        frameId: 0,
        ...senderOverrides
      }, (response) => resolve(JSON.parse(JSON.stringify(response))));
      if (handled !== true) reject(new Error("Message was not handled"));
    });
  }

  return {
    dispatch, fetchCalls, fetchErrors,
    install(reason) { installedListener({ reason }); },
    get optionsPageOpenCount() { return optionsPageOpenCount; }
  };
}

test("opens the settings tab on first install only", () => {
  const harness = createHarness();
  harness.install("update");
  harness.install("chrome_update");
  harness.install("shared_module_update");
  assert.equal(harness.optionsPageOpenCount, 0);
  harness.install("install");
  assert.equal(harness.optionsPageOpenCount, 1);

  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.options_page, "options/options.html");
});

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

test("normalizes X and Twitter links before submitting to Nazurin", async () => {
  for (const host of ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]) {
    const harness = createHarness();
    const result = await harness.dispatch({
      type: "pfp-nazurin-twitter-submit", requestId: "twitter-1",
      tweetUrl: `https://${host}/artist_name/status/123456789/photo/2?s=20#media`
    }, `https://${host}/home`);
    assert.deepEqual(result, { ok: true, status: "accepted" });
    assert.deepEqual(JSON.parse(harness.fetchCalls[0][1].body), {
      url: "https://twitter.com/artist_name/status/123456789"
    });
  }
});

test("Twitter submissions retain connection and permission checks", async () => {
  for (const [options, status] of [
    [{ verified: false }, "not-verified"], [{ permitted: false }, "permission-missing"],
    [{ host: null }, "not-configured"]
  ]) {
    const harness = createHarness(options);
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-twitter-submit", requestId: "twitter-2",
      tweetUrl: "https://x.com/artist/status/123"
    }, "https://x.com/home"), { ok: false, status });
    assert.equal(harness.fetchCalls.length, 0);
  }
});

test("pixivision submits only canonical Pixiv artwork URLs", async () => {
  for (const hostname of ["www.pixivision.net", "pixivision.net"]) {
    const harness = createHarness();
    const result = await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "142138569", requestId: "pv-1",
      url: "https://attacker.invalid/ignored"
    }, `https://${hostname}/zh/a/11692`);
    assert.deepEqual(result, { ok: true, status: "accepted" });
    assert.equal(harness.fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(harness.fetchCalls[0][1].body), {
      url: "https://www.pixiv.net/artworks/142138569"
    });
  }
});

test("pixivision retains Nazurin configuration, permission, and ID validation", async () => {
  for (const [options, status] of [
    [{ verified: false }, "not-verified"], [{ permitted: false }, "permission-missing"],
    [{ host: null }, "not-configured"]
  ]) {
    const harness = createHarness(options);
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "142138569", requestId: "pv-2"
    }, "https://www.pixivision.net/zh/a/11692"), { ok: false, status });
    assert.equal(harness.fetchCalls.length, 0);
  }
  const harness = createHarness();
  for (const illustId of ["https://evil.example/", "123?bad=1", "", null]) {
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-submit", illustId, requestId: "pv-invalid"
    }, "https://www.pixivision.net/zh/a/11692"), { ok: false, status: "invalid-response" });
  }
  assert.equal(harness.fetchCalls.length, 0);
});

test("pixivision cannot fetch preview metadata or submit tweets; rejects other origins", async () => {
  const harness = createHarness();
  for (const type of ["pfp-get-pages", "pfp-nazurin-twitter-submit", "pfp-nazurin-test"]) {
    await assert.rejects(harness.dispatch({
      type, illustId: "123", requestId: "pv-route", tweetUrl: "https://x.com/a/status/1"
    }, "https://www.pixivision.net/zh/a/11692"), /not handled/);
  }
  for (const sender of [
    "https://www.pixivision.net.evil.example/", "http://www.pixivision.net/", "https://evil.example/"
  ]) {
    await assert.rejects(harness.dispatch({
      type: "pfp-nazurin-submit", illustId: "123", requestId: "pv-sender"
    }, sender), /not handled/);
  }
  assert.equal(harness.fetchCalls.length, 0);
});

test("rejects arbitrary URLs and malformed tweet paths", async () => {
  for (const tweetUrl of [
    "https://evil.example/artist/status/123", "https://x.com.evil.example/artist/status/123",
    "http://x.com/artist/status/123", "https://user:pass@x.com/artist/status/123",
    "https://x.com:444/artist/status/123", "https://x.com/artist/status/nope",
    "https://x.com/artist/status/123/retweets", "https://x.com/home", "", null
  ]) {
    const harness = createHarness();
    assert.deepEqual(await harness.dispatch({
      type: "pfp-nazurin-twitter-submit", requestId: "twitter-bad", tweetUrl
    }, "https://x.com/home"), { ok: false, status: "invalid-response" });
    assert.equal(harness.fetchCalls.length, 0);
  }
});

test("limits Twitter senders to Nazurin routes and keeps Pixiv routes isolated", async () => {
  const harness = createHarness();
  for (const [message, sender] of [
    [{ type: "pfp-get-pages", illustId: "123", requestId: "bad-1" }, "https://x.com/home"],
    [{ type: "pfp-nazurin-submit", illustId: "123", requestId: "bad-2" }, "https://x.com/home"],
    [{ type: "pfp-nazurin-twitter-submit", tweetUrl: "https://x.com/a/status/123", requestId: "bad-3" }, "https://www.pixiv.net/"],
    [{ type: "pfp-nazurin-status" }, "https://x.com.evil.example/"],
    [{ type: "pfp-nazurin-status" }, "http://twitter.com/"],
    [{ type: "pfp-nazurin-status" }, "https://evil.example/"]
  ]) await assert.rejects(harness.dispatch(message, sender), /not handled/);
  assert.deepEqual(await harness.dispatch({ type: "pfp-nazurin-status" }, "https://x.com/home"), {
    configured: true, verified: true
  });
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
  for (const [source, url, expected] of [
    ["https://yande.re/", "https://yande.re/post/show/42", "https://yande.re/post/show/42"],
    ["https://konachan.net/", "https://konachan.net/post/show/42", "https://konachan.com/post/show/42"],
    ["https://wallhaven.cc/", "https://wallhaven.cc/w/abc123", "https://wallhaven.cc/w/abc123"]
  ]) {
    assert.deepEqual(await localHarness.dispatch({
      type: "pfp-nazurin-link-submit", url, requestId: "local-generic"
    }, source), { ok: true, status: "accepted" });
    assert.deepEqual(requests.at(-1), {
      method: "POST", url: "/local:token/api", body: JSON.stringify({ url: expected })
    });
  }
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

test("background independently validates and canonicalizes generic work targets", async () => {
  const cases = [
    ["https://yande.re/post", "https://yande.re/post/show/42?tags=a%20b#image", "https://yande.re/post/show/42"],
    ["https://danbooru.donmai.us/", "https://safebooru.donmai.us/posts/42"],
    ["https://konachan.net/post", "https://konachan.com/post/show/42"],
    ["https://lolibooru.moe/", "https://lolibooru.moe/post/show/42"],
    ["https://www.zerochan.net/", "https://static.zerochan.net/A.full.42.jpg", "https://www.zerochan.net/42"],
    ["https://gelbooru.com/", "https://gelbooru.com/index.php?id=42&s=view&page=post#image", "https://gelbooru.com/index.php?page=post&s=view&id=42"],
    ["https://catzz.artstation.com/", "https://www.artstation.com/artwork/abc"],
    ["https://wallhaven.cc/", "http://whvn.cc/abc123", "https://wallhaven.cc/w/abc123"],
    ["https://t.bilibili.com/", "https://www.bilibili.com/opus/42", "https://t.bilibili.com/42"],
    ["https://m.weibo.cn/", "https://weibo.cn/appurl?scheme=x&lfid=42", "https://m.weibo.cn/detail/42"],
    ["https://artist.deviantart.com/", "https://www.deviantart.com/artist/art/title-42"],
    ["https://artist.lofter.com/", "https://artist.lofter.com/post/abc_def"],
    ["https://kemono.cr/", "https://kemono.su/fanbox/user/1/post/2/revision/3"],
    ["https://telegra.ph/", "https://graph.org/Page-01-01"],
    ["https://bsky.app/", "https://bsky.app/profile/artist.bsky.social/post/abc"],
    ["https://yande.re/post", "https://pixiv.net/artworks/42?x=1#image", "https://www.pixiv.net/artworks/42"],
    ["https://yande.re/post", "https://mobile.twitter.com/artist/status/42?x=1#image", "https://twitter.com/artist/status/42"]
  ];
  for (const [source, url, expected = url] of cases) {
    const h = createHarness();
    assert.deepEqual(await h.dispatch({
      type: "pfp-nazurin-link-submit", url, requestId: "generic-valid"
    }, source), { ok: true, status: "accepted" }, source);
    assert.equal(h.fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(h.fetchCalls[0][1].body), { url: expected });
    assert.deepEqual(await h.dispatch({ type: "pfp-nazurin-status" }, source), {
      configured: true, verified: true
    });
  }
});

test("generic sources cannot access legacy routes or impersonate extension pages and top frames", async () => {
  const h = createHarness();
  const submission = { type: "pfp-nazurin-link-submit", url: "https://yande.re/post/show/42", requestId: "generic-security" };
  for (const source of [
    "https://evil.example/", "http://yande.re/", "https://yande.re.evil.example/",
    "https://www.pixiv.net/", "https://x.com/", "https://www.pixivision.net/",
    "https://cdn.donmai.us/", "https://user:pass@yande.re/", "https://yande.re:444/",
    "https://pixiv.net/artworks/42", "https://mobile.x.com/home", "https://mobile.twitter.com/home"
  ]) await assert.rejects(h.dispatch(submission, source), /not handled/, source);
  for (const sender of [{ id: "other-extension" }, { frameId: 1 }, { frameId: undefined }]) {
    await assert.rejects(h.dispatch(submission, "https://yande.re/", sender), /not handled/);
    await assert.rejects(h.dispatch({ type: "pfp-nazurin-status" }, "https://yande.re/", sender), /not handled/);
  }
  for (const type of [
    "pfp-get-pages", "pfp-cancel-pages", "pfp-nazurin-submit", "pfp-nazurin-twitter-submit",
    "pfp-nazurin-test", "pfp-cancel-nazurin"
  ]) {
    await assert.rejects(h.dispatch({
      type, illustId: "42", tweetUrl: "https://x.com/a/status/42", requestId: "generic-route"
    }, "https://yande.re/"), /not handled/, type);
  }
  assert.equal(h.fetchCalls.length, 0);
});

test("generic route rejects unsafe targets and malformed request IDs before fetching", async () => {
  const h = createHarness();
  for (const url of [
    "https://evil.example/", "https://safebooru.org/", "https://yande.re.evil.example/",
    "https://space.bilibili.com/", "https://www.pixivision.net/zh/a/42", "/post/show/42",
    "javascript:alert(1)", "file:///tmp/test", "https://user:pass@yande.re/",
    "https://yande.re:444/", "https://yande.re/post", "https://wallhaven.cc/latest",
    "https://yande.re/post?url=https://www.pixiv.net/artworks/42", null, {}
  ]) {
    assert.deepEqual(await h.dispatch({
      type: "pfp-nazurin-link-submit", url, requestId: "generic-invalid"
    }, "https://yande.re/"), { ok: false, status: "unsupported-url" });
  }
  for (const requestId of [null, "", {}, "bad/request", "x".repeat(81)]) {
    assert.deepEqual(await h.dispatch({
      type: "pfp-nazurin-link-submit", url: "https://yande.re/post/show/42", requestId
    }, "https://yande.re/"), { ok: false, status: "invalid-response" });
  }
  assert.equal(h.fetchCalls.length, 0);
});

test("generic route retains configuration, verification and API permission checks", async () => {
  for (const [options, status] of [
    [{ host: null }, "not-configured"], [{ token: null }, "not-configured"],
    [{ verified: false }, "not-verified"], [{ permitted: false }, "permission-missing"]
  ]) {
    const h = createHarness(options);
    assert.deepEqual(await h.dispatch({
      type: "pfp-nazurin-link-submit", url: "https://yande.re/post/show/42", requestId: "generic-config"
    }, "https://yande.re/"), { ok: false, status });
    assert.equal(h.fetchCalls.length, 0);
  }
});

test("Konachan conversion always applies, even when an obsolete saved preference is false", async () => {
  const h = createHarness({ konachanNetToCom: false });
  const message = {
    type: "pfp-nazurin-link-submit", url: "https://www.konachan.net/post/show/42?tags=a%20b#image",
    requestId: "konachan-convert"
  };
  const source = "https://konachan.net/post";
  const expected = "https://konachan.com/post/show/42";
  assert.deepEqual(await h.dispatch(message, source), { ok: true, status: "accepted" });
  assert.equal(JSON.parse(h.fetchCalls[0][1].body).url, expected);
  assert.deepEqual(await h.dispatch({ ...message, url: expected }, source), { ok: true, status: "accepted" });
  assert.equal(JSON.parse(h.fetchCalls[1][1].body).url, expected);
});

test("generic route uses the same API/timeout error responses as legacy submissions", async () => {
  const message = { type: "pfp-nazurin-link-submit", url: "https://yande.re/post/show/42", requestId: "generic-error" };
  for (const [options, status] of [
    [{ response: { ok: false, status: 503 } }, "http-error"],
    [{ response: { ok: true, json: async () => ({ error: 3 }) } }, "api-error"],
    [{ response: { ok: true, json: async () => ({}) } }, "invalid-response"],
    [{ response: { ok: true, json: async () => { throw new Error("invalid json"); } } }, "invalid-response"],
    [{ fetchImpl: async () => { throw new TypeError("offline"); } }, "network-error"],
    [{ timeoutImmediately: true, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }) }, "timeout"]
  ]) {
    const h = createHarness(options);
    const result = await h.dispatch(message, "https://yande.re/");
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
  }
});
