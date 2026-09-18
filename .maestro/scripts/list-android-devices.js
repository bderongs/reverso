#!/usr/bin/env node
/**
 * List connected Android devices for Maestro --device.
 * Uses `adb devices -l` (that is what --device expects: emulator-5554, not the AVD name).
 *
 * Usage:
 *   node .maestro/scripts/list-android-devices.js
 *   node .maestro/scripts/list-android-devices.js --turns 5
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const FLOW = ".maestro/favorites-play-quiz.yaml";

function parseArgs(argv) {
  const out = { turns: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === "--turns" || argv[i] === "-e") && argv[i + 1]) {
      const v = argv[++i];
      const m = String(v).match(/^(?:TURNS=)?(\d+)$/i);
      out.turns = m ? Number(m[1]) : Number(v) || 5;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      out.help = true;
    }
  }
  return out;
}

function candidateAdbPaths() {
  const home = os.homedir();
  const fromEnv = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
  ]
    .filter(Boolean)
    .map((root) => path.join(root, "platform-tools", "adb"));

  return [
    ...fromEnv,
    path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"),
    path.join(home, "Android", "Sdk", "platform-tools", "adb"),
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
  ];
}

function resolveAdb() {
  // Prefer PATH when available (interactive shells often have it).
  const which = spawnSync("which", ["adb"], { encoding: "utf8" });
  if (which.status === 0) {
    const found = String(which.stdout || "").trim().split("\n")[0];
    if (found && fs.existsSync(found)) return found;
  }

  for (const candidate of candidateAdbPaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function runAdbDevices() {
  const adb = resolveAdb();
  if (!adb) {
    throw new Error(
      "adb not found. Install Android platform-tools, or set ANDROID_HOME "
      + "(typical macOS path: ~/Library/Android/sdk)."
    );
  }
  const res = spawnSync(adb, ["devices", "-l"], { encoding: "utf8" });
  if (res.error) {
    throw new Error(`Failed to run adb (${adb}): ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`adb failed: ${(res.stderr || res.stdout || "").trim()}`);
  }
  return { adb, stdout: res.stdout || "" };
}

function parseDevices(adbOut) {
  const lines = adbOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const devices = [];
  for (const line of lines) {
    if (line.startsWith("List of devices")) continue;
    const parts = line.split(/\s+/);
    const id = parts[0];
    const state = parts[1] || "";
    if (!id || !state) continue;
    const meta = {};
    for (const p of parts.slice(2)) {
      const eq = p.indexOf(":");
      if (eq > 0) meta[p.slice(0, eq)] = p.slice(eq + 1);
    }
    devices.push({
      id,
      state,
      model: meta.model || meta.device || "",
      product: meta.product || "",
      ready: state === "device",
    });
  }
  return devices;
}

function commandFor(deviceId, turns) {
  return `maestro test --device ${deviceId} -e TURNS=${turns} ${FLOW}`;
}

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node .maestro/scripts/list-android-devices.js [--turns 5]

Lists connected adb devices and prints a ready-to-run Maestro command.
Note: maestro list-devices shows AVD names; --device wants the adb serial (e.g. emulator-5554).`);
    return;
  }

  const { adb, stdout } = runAdbDevices();
  const devices = parseDevices(stdout);
  const ready = devices.filter((d) => d.ready);

  if (!devices.length) {
    console.log("No Android devices attached.");
    console.log("Start an emulator (or plug in a phone with USB debugging), then re-run.");
    console.log("\nAlso useful: maestro list-devices   # local AVDs / simulators");
    process.exit(1);
  }

  console.log(`Using adb: ${adb}\n`);
  console.log("Connected Android devices (adb):\n");
  devices.forEach((d, i) => {
    const label = d.model || d.product || d.state;
    const mark = d.ready ? "ready" : d.state;
    console.log(`  [${i + 1}] ${d.id}  · ${label}  · ${mark}`);
  });
  console.log("");

  if (!ready.length) {
    console.log("None are ready (state must be \"device\"). Boot the emulator and try again.");
    process.exit(1);
  }

  let chosen = ready[0];
  if (ready.length > 1 && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (true) {
        const answer = String(await ask(rl, `Pick a device [1-${devices.length}]: `)).trim();
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= devices.length && devices[n - 1].ready) {
          chosen = devices[n - 1];
          break;
        }
        if (Number.isInteger(n) && n >= 1 && n <= devices.length && !devices[n - 1].ready) {
          console.log("That device is not ready yet.");
          continue;
        }
        console.log("Invalid choice.");
      }
    } finally {
      rl.close();
    }
  } else if (ready.length === 1) {
    console.log(`Using the only ready device: ${chosen.id}\n`);
  } else {
    console.log(`Several ready devices — defaulting to ${chosen.id} (re-run in a TTY to pick).\n`);
  }

  const cmd = commandFor(chosen.id, args.turns);
  console.log("Run:\n");
  console.log(`  ${cmd}\n`);
  console.log("(Term logger must already be running: node .maestro/scripts/term-logger.js)");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
