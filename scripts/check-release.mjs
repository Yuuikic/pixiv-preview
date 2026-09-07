import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const readme = readFileSync(join(root, "README.md"), "utf8");
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
if (!readme.includes(`\`${manifest.version}\` 开发版`)) fail("README version does not match manifest");

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1] || "";
  if (tag !== `v${manifest.version}`) fail(`tag ${tag || "(missing)"} must be v${manifest.version}`);
}

const requiredFiles = [
  "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
  "_locales/en/messages.json", "_locales/zh_CN/messages.json", "_locales/zh_TW/messages.json",
  "assets/icon-16.png", "assets/icon-32.png", "assets/icon-48.png", "assets/icon-128.png",
  "assets/nazurin-48.png", "options/options.html", "popup/popup.html", "popup/popup.css",
  "popup/popup.js", "src/background.js", "src/content.js", "src/i18n.js",
  "src/preview.css", "src/settings.js"
];
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) fail(`missing ${file}`);
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

for (const file of ["src/background.js", "src/content.js", "src/i18n.js", "src/settings.js", "popup/popup.js"]) {
  const result = spawnSync(process.execPath, ["--check", join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) fail(`${file} has invalid JavaScript\n${result.stderr.trim()}`);
}

if (!process.exitCode) console.log(`P² v${manifest.version} release metadata and runtime files are valid.`);
