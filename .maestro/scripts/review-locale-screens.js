#!/usr/bin/env node
// Review locale-screen screenshots with a vision model and archive a dated run
// under locale-screens/runs/<id>/, then refresh the review webpage data.
//
//   node .maestro/scripts/review-locale-screens.js
//   node .maestro/scripts/review-locale-screens.js --zip /path/to/artifacts.zip
//   node .maestro/scripts/review-locale-screens.js --rebuild-index
//
// Requires OPENAI_API_KEY (except --rebuild-index). Optional OPENAI_VISION_MODEL
// (default gpt-4o). Open locale-screens/index.html to browse runs.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const catalogPath = path.join(repoRoot, "locale-screens/catalog.json");
const localeScreensDir = path.join(repoRoot, "locale-screens");
const runsDir = path.join(localeScreensDir, "runs");

const ISSUE_KINDS = new Set(["truncated", "mixed_locale", "error"]);
const UX_KINDS = new Set(["too_small", "unclear"]);
const ALL_KINDS = new Set([...ISSUE_KINDS, ...UX_KINDS]);
const SEVERITIES = new Set(["high", "medium", "low"]);
const SEVERITY_SCORE = { high: 3, medium: 2, low: 1 };

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "languages", "evidence", "where"],
        properties: {
          kind: {
            type: "string",
            enum: ["truncated", "mixed_locale", "error", "too_small", "unclear"],
          },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          languages: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          evidence: {
            type: "string",
            description: "Quoted visible text or a short description of the defect.",
          },
          where: {
            type: "string",
            description: "Where on the screen the issue appears.",
          },
        },
      },
    },
  },
};

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function loadEnvFile() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeEvidence(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function relativeShot(languageCode, screenFile) {
  return path.join("locale-screens", languageCode, screenFile);
}

function runShot(languageCode, screenFile) {
  return languageCode + "/" + screenFile;
}

function runIdFromIso(iso) {
  return String(iso || new Date().toISOString())
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:.]/g, "-");
}

function withRunShots(finding) {
  return {
    ...finding,
    shots: (finding.languages || []).map((code) =>
      runShot(code, finding.screenFile)
    ),
  };
}

function copyShotsIntoRun(catalog, runPath) {
  for (const language of catalog.languages) {
    for (const screen of catalog.screens) {
      const source = path.join(
        localeScreensDir,
        language.code,
        screen.file
      );
      const dest = path.join(runPath, language.code, screen.file);
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
    }
  }
}

function rebuildRunsData() {
  fs.mkdirSync(runsDir, { recursive: true });
  const runs = [];
  if (fs.existsSync(runsDir)) {
    for (const name of fs.readdirSync(runsDir)) {
      const reviewPath = path.join(runsDir, name, "review.json");
      if (!fs.existsSync(reviewPath)) continue;
      let review;
      try {
        review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
      } catch {
        continue;
      }
      runs.push({
        id: name,
        generatedAt: review.generatedAt || null,
        model: review.model || null,
        languages: review.languages || [],
        screens: review.screens || [],
        note: review.note || "",
        issueCount: (review.issues || []).length,
        uxCount: (review.ux || []).length,
        findingCount: (review.findings || []).length,
        top5: review.top5 || [],
        issues: review.issues || [],
        ux: review.ux || [],
        findings: review.findings || [],
      });
    }
  }
  runs.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  const outPath = path.join(localeScreensDir, "runs-data.js");
  const payload =
    "window.LOCALE_REVIEW_RUNS = " + JSON.stringify(runs, null, 2) + ";\n";
  fs.writeFileSync(outPath, payload);
  return { count: runs.length, outPath: path.relative(repoRoot, outPath) };
}

function renderMarkdown(payload) {
  const md = [];
  md.push("# Locale screen review");
  md.push("");
  md.push(`Generated: ${payload.generatedAt}`);
  md.push(`Model: ${payload.model}`);
  md.push("");
  md.push(payload.note);
  md.push("");

  md.push("## Top 5 recommendations");
  md.push("");
  if (!payload.top5.length) {
    md.push("No findings.");
    md.push("");
  } else {
    payload.top5.forEach((finding, i) => {
      md.push(`${i + 1}. ${actionLine(finding)}`);
    });
    md.push("");
  }

  md.push("## Issues");
  md.push("");
  md.push("Truncated text, mixed locale, and errors.");
  md.push("");
  if (!payload.issues.length) {
    md.push("None.");
    md.push("");
  } else {
    payload.issues.forEach((finding, i) => {
      md.push(formatFindingMd(finding, i + 1));
    });
  }

  md.push("## UX optimizations");
  md.push("");
  md.push("Text too small, and unclear UI.");
  md.push("");
  if (!payload.ux.length) {
    md.push("None.");
    md.push("");
  } else {
    payload.ux.forEach((finding, i) => {
      md.push(formatFindingMd(finding, i + 1));
    });
  }
  return md.join("\n");
}

function collectShots(catalog) {
  const reviewDir = path.join(repoRoot, catalog.reviewDir);
  const missing = [];
  const byScreen = new Map();

  for (const screen of catalog.screens) {
    const shots = [];
    for (const language of catalog.languages) {
      const absolute = path.join(reviewDir, language.code, screen.file);
      if (!fs.existsSync(absolute)) {
        missing.push(`${language.code}/${screen.file}`);
        continue;
      }
      shots.push({
        code: language.code,
        picker: language.picker,
        absolute,
        relative: relativeShot(language.code, screen.file),
        base64: fs.readFileSync(absolute).toString("base64"),
      });
    }
    byScreen.set(screen.id, shots);
  }

  return { missing, byScreen };
}

function buildSystemPrompt(catalog) {
  const allow = (catalog.allowlist || []).join(", ");
  return [
    "You review Android screenshots of the Reverso app after the interface language was switched.",
    "You receive several screenshots of the SAME screen, each labeled with its expected interface language.",
    "Compare them side by side. Flag only real defects.",
    "",
    "Issue kinds:",
    "- truncated: ellipsis, or a label cut by its row, button, or screen edge. Chrome that clips is high severity. Long user-content sentences that ellipsize are low severity.",
    "- mixed_locale: interface chrome still in another language. Compare against the English shot. Identical non-allowlisted chrome across languages is untranslated.",
    "- error: dialog, toast, error banner, blank screen, or wrong screen.",
    "",
    "UX kinds:",
    "- too_small: text that is hard to read on a phone (roughly below 12sp). Quote the string.",
    "- unclear: low contrast, icon-only control, ambiguous label, or competing actions. Cite what is unclear.",
    "",
    "Do not flag:",
    "- User content called out in the screen's content note (saved words, examples, list names).",
    `- Allowlisted strings: ${allow}.`,
    "- Numbers, emails, URLs.",
    "- Translation-pair language names shown in the UI language (e.g. English UI: French↔English; Spanish UI: Francés↔Inglés; German UI: Französisch↔Englisch; French UI: Français↔Anglais). Those are correct localization, not mixed_locale.",
    "",
    "Return JSON matching the schema. languages must be language codes from the labels (e.g. fr, en, es, de).",
    "If there are no findings, return an empty findings array.",
  ].join("\n");
}

function buildUserContent(screen, shots, catalog) {
  const parts = [
    {
      type: "text",
      text: [
        `Screen: ${screen.id} — ${screen.what}`,
        `Chrome to check: ${screen.chrome || "(all visible UI chrome)"}`,
        `Content to ignore: ${screen.content || "(none)"}`,
        `Allowlist: ${(catalog.allowlist || []).join(", ")}`,
        "Images follow, one per language. Report findings for this screen only.",
      ].join("\n"),
    },
  ];

  for (const shot of shots) {
    parts.push({
      type: "text",
      text: `Language code=${shot.code}, expected interface language=${shot.picker}, file=${shot.relative}`,
    });
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${shot.base64}`,
        detail: "high",
      },
    });
  }

  return parts;
}

async function reviewScreen(apiKey, model, systemPrompt, screen, shots, catalog) {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserContent(screen, shots, catalog) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "locale_screen_findings",
          strict: true,
          schema: FINDINGS_SCHEMA,
        },
      },
    }),
  });

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI response was not JSON for ${screen.id}: ${text.slice(0, 400)}`);
  }
  if (!upstream.ok) {
    const message =
      (data && data.error && data.error.message) || text.slice(0, 400);
    throw new Error(`OpenAI ${upstream.status} for ${screen.id}: ${message}`);
  }

  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Model returned non-JSON content for ${screen.id}: ${String(content).slice(0, 400)}`);
  }

  const knownCodes = new Set(shots.map((s) => s.code));
  const findings = [];
  for (const raw of parsed.findings || []) {
    if (!ALL_KINDS.has(raw.kind)) continue;
    if (!SEVERITIES.has(raw.severity)) continue;
    const languages = (raw.languages || []).filter((code) => knownCodes.has(code));
    if (!languages.length) continue;
    const evidence = String(raw.evidence || "").trim();
    const where = String(raw.where || "").trim();
    if (!evidence || !where) continue;
    findings.push({
      screen: screen.id,
      screenFile: screen.file,
      what: screen.what,
      kind: raw.kind,
      severity: raw.severity,
      languages,
      evidence,
      where,
      shots: languages.map((code) => relativeShot(code, screen.file)),
    });
  }
  return findings;
}

function collapseAndRank(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = [
      finding.kind,
      finding.screen,
      normalizeEvidence(finding.evidence),
    ].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...finding,
        languages: [...finding.languages],
        shots: [...finding.shots],
      });
      continue;
    }
    for (const code of finding.languages) {
      if (!existing.languages.includes(code)) existing.languages.push(code);
    }
    for (const shot of finding.shots) {
      if (!existing.shots.includes(shot)) existing.shots.push(shot);
    }
    if (SEVERITY_SCORE[finding.severity] > SEVERITY_SCORE[existing.severity]) {
      existing.severity = finding.severity;
      existing.where = finding.where;
      existing.evidence = finding.evidence;
    }
  }

  const ranked = [...groups.values()].map((item) => {
    const score =
      SEVERITY_SCORE[item.severity] + Math.max(0, item.languages.length - 1);
    return { ...item, score };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.screen.localeCompare(b.screen);
  });
  return ranked;
}

function actionLine(finding) {
  const langs = finding.languages.join(", ");
  const files = finding.shots.join(", ");
  switch (finding.kind) {
    case "truncated":
      return `Fix truncation of “${finding.evidence}” on ${finding.what} (${langs}): ${files}`;
    case "mixed_locale":
      return `Localize “${finding.evidence}” on ${finding.what} for ${langs}: ${files}`;
    case "error":
      return `Investigate error “${finding.evidence}” on ${finding.what} (${langs}): ${files}`;
    case "too_small":
      return `Increase size of “${finding.evidence}” on ${finding.what} (${langs}): ${files}`;
    case "unclear":
      return `Clarify “${finding.evidence}” on ${finding.what} (${langs}): ${files}`;
    default:
      return `${finding.kind}: ${finding.evidence} (${langs})`;
  }
}

function formatFindingMd(finding, index) {
  const shots = finding.shots.map((s) => `\`${s}\``).join(", ");
  return [
    `### ${index}. ${finding.kind} — ${finding.what} (${finding.severity})`,
    "",
    `- Languages: ${finding.languages.join(", ")}`,
    `- Where: ${finding.where}`,
    `- Evidence: “${finding.evidence}”`,
    `- Screenshots: ${shots}`,
    "",
  ].join("\n");
}

function writeReports(catalog, findings, meta) {
  const reviewDir = path.join(repoRoot, catalog.reviewDir);
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });

  const ranked = collapseAndRank(findings).map(withRunShots);
  const top5 = ranked.slice(0, 5);
  const issues = ranked.filter((f) => ISSUE_KINDS.has(f.kind));
  const ux = ranked.filter((f) => UX_KINDS.has(f.kind));
  const generatedAt = new Date().toISOString();
  const id = runIdFromIso(generatedAt);

  const payload = {
    id,
    generatedAt,
    model: meta.model,
    languages: catalog.languages,
    screens: catalog.screens.map((s) => ({
      id: s.id,
      file: s.file,
      what: s.what,
    })),
    note:
      "Settings shots cover only the top of the page. Findings there do not cover the rest of Settings.",
    top5,
    issues,
    ux,
    findings: ranked,
  };

  const runPath = path.join(runsDir, id);
  fs.mkdirSync(runPath, { recursive: true });
  copyShotsIntoRun(catalog, runPath);

  const runJsonPath = path.join(runPath, "review.json");
  const runMdPath = path.join(runPath, "review.md");
  const latestJsonPath = path.join(reviewDir, "review.json");
  const latestMdPath = path.join(reviewDir, "review.md");
  const md = renderMarkdown(payload);

  fs.writeFileSync(runJsonPath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(runMdPath, md);
  fs.writeFileSync(latestJsonPath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(latestMdPath, md);

  const index = rebuildRunsData();
  return {
    id,
    runDir: path.relative(repoRoot, runPath),
    jsonPath: path.relative(repoRoot, latestJsonPath),
    mdPath: path.relative(repoRoot, latestMdPath),
    indexPath: index.outPath,
    runCount: index.count,
    top5Count: top5.length,
    issueCount: issues.length,
    uxCount: ux.length,
  };
}

function archiveExistingLatest(catalog) {
  const latestJsonPath = path.join(localeScreensDir, "review.json");
  if (!fs.existsSync(latestJsonPath)) return null;
  const review = JSON.parse(fs.readFileSync(latestJsonPath, "utf8"));
  const generatedAt = review.generatedAt || new Date().toISOString();
  const id = review.id || runIdFromIso(generatedAt);
  const runPath = path.join(runsDir, id);
  if (fs.existsSync(path.join(runPath, "review.json"))) return id;

  const findings = (review.findings || []).map((f) => {
    if (f.shots && f.shots[0] && !String(f.shots[0]).includes(".maestro/")) {
      return f;
    }
    return withRunShots(f);
  });
  const payload = {
    ...review,
    id,
    generatedAt,
    top5: (review.top5 || []).map((f) => withRunShots(f)),
    issues: (review.issues || []).map((f) => withRunShots(f)),
    ux: (review.ux || []).map((f) => withRunShots(f)),
    findings,
  };

  fs.mkdirSync(runPath, { recursive: true });
  copyShotsIntoRun(catalog, runPath);
  fs.writeFileSync(
    path.join(runPath, "review.json"),
    JSON.stringify(payload, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(runPath, "review.md"), renderMarkdown(payload));
  fs.writeFileSync(latestJsonPath, JSON.stringify(payload, null, 2) + "\n");
  return id;
}

async function main() {
  loadEnvFile();

  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

  if (process.argv.includes("--rebuild-index")) {
    const archived = archiveExistingLatest(catalog);
    const index = rebuildRunsData();
    if (archived) console.log("archived latest review as run " + archived);
    console.log(`rebuilt ${index.outPath} (${index.count} run(s))`);
    return;
  }

  const zipPath = arg("--zip");
  if (zipPath) {
    if (!fs.existsSync(zipPath)) {
      console.error(
        "Zip not found: " +
          zipPath +
          "\nPass the real Maestro Cloud artifacts zip, or omit --zip if shots are already under locale-screens/<code>/."
      );
      process.exit(1);
    }
    const pullScript = path.join(__dirname, "pull-locale-screens.js");
    execFileSync(process.execPath, [pullScript, "--zip", zipPath], {
      stdio: "inherit",
      cwd: repoRoot,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set.");
    process.exit(1);
  }

  const { missing, byScreen } = collectShots(catalog);
  if (missing.length) {
    console.error("Missing screenshots:");
    for (const item of missing) console.error("  " + item);
    console.error(
      "Pull artifacts first: node .maestro/scripts/pull-locale-screens.js --zip artifacts.zip"
    );
    process.exit(1);
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";
  const systemPrompt = buildSystemPrompt(catalog);
  const allFindings = [];

  for (const screen of catalog.screens) {
    const shots = byScreen.get(screen.id) || [];
    console.log(`reviewing ${screen.id} (${shots.length} languages)…`);
    const findings = await reviewScreen(
      apiKey,
      model,
      systemPrompt,
      screen,
      shots,
      catalog
    );
    console.log(`  ${findings.length} finding(s)`);
    allFindings.push(...findings);
  }

  const written = writeReports(catalog, allFindings, { model });
  console.log(
    `wrote run ${written.id} → ${written.runDir} (issues=${written.issueCount}, ux=${written.uxCount}, top5=${written.top5Count})`
  );
  console.log(`index ${written.indexPath} (${written.runCount} run(s))`);
  console.log("open locale-screens/index.html to browse");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
