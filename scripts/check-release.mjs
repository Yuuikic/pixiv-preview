import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const versionPattern = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/;

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exitCode = 1;
}

if (!versionPattern.test(manifest.version) || manifest.version.split(".").some((part) => Number(part) > 65535)) {
  fail(`invalid Chrome extension version: ${manifest.version}`);
}
if (packageJson.version !== manifest.version) {
  fail(`package.json ${packageJson.version} does not match manifest ${manifest.version}`);
}

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1] || "";
  if (tag !== `v${manifest.version}`) fail(`tag ${tag || "(missing)"} must be v${manifest.version}`);
}

const requiredFiles = [
  "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
  "_locales/en/messages.json", "_locales/zh_CN/messages.json", "_locales/zh_TW/messages.json",
  "assets/icon-16.png", "assets/icon-32.png", "assets/icon-48.png", "assets/icon-128.png",
  "assets/icon.png", "assets/nazurin-48.png", "options/options.html", "options/timing-demo.js", "options/settings-motion.js", "popup/popup.html", "popup/popup.css",
  "popup/popup.js", "src/background.js", "src/content.js", "src/i18n.js",
  "src/preview.css", "src/settings.js", "src/twitter.js", "src/pixivision.js", "src/link-submit.js", "src/link-submit.css",
  "src/nazurin-sites.js", "src/preview-core.js", "src/board-preview.js", "src/site-access.js", "src/site-session.js", "popup/site-access.js", "options/onboarding.js"
];
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) fail(`missing ${file}`);
}

if (existsSync(join(root, "src/nazurin-sites.js"))) {
  const context = { URL };
  runInNewContext(readFileSync(join(root, "src/nazurin-sites.js"), "utf8"), context);
  const sites = context.P2NazurinSites;
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(["https://www.pixiv.net/*"]) || manifest.content_scripts?.length) {
    fail("only the Pixiv core origin may be required; static scripts are forbidden");
  }
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage", "scripting", "activeTab"])) {
    fail("unexpected API permissions");
  }
  if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify([
    "https://*/*", "http://localhost/*", "http://127.0.0.1/*"
  ])) fail("optional host permission boundary changed");
  for (const url of ["https://www.pixiv.net/", "https://x.com/", "https://danbooru.donmai.us/",
    "https://yande.re/", "https://konachan.net/", "https://www.zerochan.net/", "https://www.pixivision.net/", "https://pixivision.net/"]) {
    const entry = sites.scriptsForUrl(url);
    if (!entry || JSON.stringify(entry.matches) !== JSON.stringify([`${new URL(url).origin}/*`])) {
      fail("dynamic registration must match only the exact enabled origin");
    }
    if (!entry.js.includes("src/site-session.js")) fail("missing permission-revocation lifecycle");
    const adapterIndex = entry.js.findIndex((file) => ["src/content.js", "src/board-preview.js"].includes(file));
    const coreIndex = entry.js.indexOf("src/preview-core.js");
    if (adapterIndex >= 0 && (coreIndex < 0 || coreIndex > adapterIndex)) fail("preview core must load before its adapter");
  }
  for (const url of ["https://safebooru.donmai.us/", "https://lolibooru.moe/",
    "https://gelbooru.com/", "https://artist.lofter.com/", "https://cdn.donmai.us/"]) {
    if (sites.scriptsForUrl(url)) fail("unsupported site must not register scripts");
  }
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path);
    if (entry.isDirectory() && [".git", "dist", "node_modules"].includes(relativePath.split("/")[0])) return [];
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const forbiddenNames = new Set([".DS_Store", "Thumbs.db", "Desktop.ini"]);
for (const file of filesUnder(root)) {
  const path = relative(root, file);
  if (forbiddenNames.has(path.split("/").at(-1))) continue;
  if (statSync(file).size > 5 * 1024 * 1024) fail(`${path} exceeds 5 MiB`);
}

for (const file of ["src/background.js", "src/content.js", "src/twitter.js", "src/pixivision.js", "src/link-submit.js", "src/i18n.js", "src/settings.js", "src/nazurin-sites.js", "src/preview-core.js", "src/board-preview.js", "popup/popup.js", "popup/site-access.js", "src/site-access.js", "src/site-session.js", "options/onboarding.js", "options/timing-demo.js", "options/settings-motion.js"]) {
  const result = spawnSync(process.execPath, ["--check", join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) fail(`${file} has invalid JavaScript\n${result.stderr.trim()}`);
}

if (!process.exitCode) console.log(`P2 v${manifest.version} release metadata and runtime files are valid.`);
