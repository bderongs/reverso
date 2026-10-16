#!/usr/bin/env node
// Copy named screenshots out of a Maestro Cloud artifacts zip into
// locale-screens/<code>/<file>, using locale-screens/catalog.json.
//
//   node .maestro/scripts/pull-locale-screens.js --zip /path/to/artifacts.zip

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const catalogPath = path.join(repoRoot, "locale-screens/catalog.json");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

const zipPath = arg("--zip");
if (!zipPath) {
  console.error("Usage: node .maestro/scripts/pull-locale-screens.js --zip artifacts.zip");
  process.exit(1);
}
if (!fs.existsSync(zipPath)) {
  console.error(
    "Zip not found: " +
      zipPath +
      "\nPass the real Maestro Cloud artifacts zip path (not the /path/to/… placeholder)."
  );
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const reviewDir = path.join(repoRoot, catalog.reviewDir);
const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let copied = 0;
const missing = [];

for (const language of catalog.languages) {
  for (const screen of catalog.screens) {
    const relative = `${language.code}/${screen.file}`;
    const entry = listing.find(
      (name) =>
        name === relative ||
        name.endsWith("/" + relative) ||
        name.endsWith("/" + relative + ".png")
    );
    const destination = path.join(reviewDir, relative);
    if (!entry) {
      missing.push(relative);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(
      destination,
      execFileSync("unzip", ["-p", zipPath, entry])
    );
    copied += 1;
    console.log(path.relative(repoRoot, destination));
  }
}

console.log(`copied ${copied}, missing ${missing.length}`);
if (missing.length) {
  for (const item of missing) console.log("missing " + item);
  process.exit(1);
}
