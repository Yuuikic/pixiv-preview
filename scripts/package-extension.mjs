import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const dist = join(root, "dist");
const archive = join(dist, `P2-v${manifest.version}.zip`);
const runtimeEntries = [
  "manifest.json", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
  "_locales", "assets/icon-16.png", "assets/icon-32.png", "assets/icon-48.png",
  "assets/icon-128.png", "assets/nazurin-48.png", "options", "popup", "src"
];

const check = spawnSync(process.execPath, [join(root, "scripts/check-release.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit"
});
if (check.status !== 0) process.exit(check.status ?? 1);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const zipped = spawnSync("zip", [
  "-q", "-r", archive, ...runtimeEntries,
  "-x", ".DS_Store", "*/.DS_Store", "._*", "*/._*", "__MACOSX/*"
], {
  cwd: root,
  encoding: "utf8"
});
if (zipped.error?.code === "ENOENT") {
  console.error("Packaging requires the system `zip` command.");
  process.exit(1);
}
if (zipped.status !== 0) {
  console.error(zipped.stderr || "Could not create extension archive.");
  process.exit(zipped.status ?? 1);
}
console.log(`Created ${archive}`);
