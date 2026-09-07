import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/.test(version || "") || version.split(".").some(part => Number(part) > 65535) || version === "0.0.0") {
  console.error("Usage: npm run set-version -- X.Y.Z (each component 0–65535; not 0.0.0)");
  process.exit(1);
}
const files = ["manifest.json", "package.json"].map(name => {
  const url = new URL(`../${name}`, import.meta.url);
  const data = JSON.parse(readFileSync(url, "utf8"));
  data.version = version;
  return { url, data };
});
for (const { url, data } of files) writeFileSync(url, JSON.stringify(data, null, 2) + "\n");
console.log(`Version set to ${version}. Reload the extension in chrome://extensions/ to use it.`);
