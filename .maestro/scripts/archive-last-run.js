#!/usr/bin/env node
/**
 * Move the current quiz-run artifacts into quiz-runs/archive/<stamp>/
 * so the next account/run cannot overwrite or mix with them.
 *
 * Usage:
 *   node .maestro/scripts/archive-last-run.js
 *   node .maestro/scripts/archive-last-run.js --label account-a
 */

const fs = require("fs");
const path = require("path");

const RUNS_DIR = path.join(__dirname, "..", "quiz-runs");
const ARCHIVE_ROOT = path.join(RUNS_DIR, "archive");

const FILES = [
  "latest.json",
  "latest-score.json",
  "latest-score.txt",
  "corpus-latest.json",
  "presented-terms.jsonl",
];

function parseArgs(argv) {
  let label = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--label" && argv[i + 1]) label = String(argv[++i]).trim();
    if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
  }
  return { label };
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeLabel(label) {
  return String(label || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node .maestro/scripts/archive-last-run.js [--label name]

Moves latest.json, corpus-latest.json, scores, and presented-terms.jsonl
into .maestro/quiz-runs/archive/<stamp>[-label]/`);
    return;
  }

  const existing = FILES.filter((name) => fs.existsSync(path.join(RUNS_DIR, name)));
  if (!existing.length) {
    console.log("Nothing to archive — no current quiz-run files found.");
    return;
  }

  const folder = [safeStamp(), safeLabel(args.label)].filter(Boolean).join("-");
  const dest = path.join(ARCHIVE_ROOT, folder);
  fs.mkdirSync(dest, { recursive: true });

  for (const name of existing) {
    fs.renameSync(path.join(RUNS_DIR, name), path.join(dest, name));
    console.log(`moved ${name} → archive/${folder}/${name}`);
  }

  console.log(`\nArchived to ${dest}`);
  console.log("Working folder is clean for the next account.");
}

main();
