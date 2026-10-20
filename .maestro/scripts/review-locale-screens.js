#!/usr/bin/env node
// Review locale-screen screenshots with a vision model and archive a dated run
// under locale-screens/runs/<id>/, then refresh the review webpage data.
//
//   node .maestro/scripts/review-locale-screens.js
//   node .maestro/scripts/review-locale-screens.js --zip /path/to/artifacts.zip
//   node .maestro/scripts/review-locale-screens.js --lang ja,pl --screen rephrase
//   node .maestro/scripts/review-locale-screens.js --rebuild-index
//
// Each screenshot is reviewed on its own: the model transcribes and classifies
// every visible string, and untranslated chrome is derived from that list.
// Per-shot transcripts are saved in the run folder (transcripts.json).
//
// Requires OPENAI_API_KEY (except --rebuild-index). Optional OPENAI_VISION_MODEL
// (default gpt-4o) and --concurrency N (default 6). Open locale-screens/index.html
// to browse runs.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const catalogPath = path.join(repoRoot, "locale-screens/catalog.json");
const localeScreensDir = path.join(repoRoot, "locale-screens");
const runsDir = path.join(localeScreensDir, "runs");

const ISSUE_KINDS = new Set(["truncated", "mixed_locale", "error", "spelling"]);
const UX_KINDS = new Set(["too_small", "unclear"]);
const ALL_KINDS = new Set([...ISSUE_KINDS, ...UX_KINDS]);
const SEVERITIES = new Set(["high", "medium", "low"]);
const SEVERITY_SCORE = { high: 3, medium: 2, low: 1 };

// One request per screenshot. The model transcribes every visible text and
// classifies it; the script (not the model) decides what is mixed_locale.
const SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["texts", "findings"],
  properties: {
    texts: {
      type: "array",
      description: "Every visible text element on the screen, top to bottom.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "role", "where", "language", "acceptableInExpected"],
        properties: {
          text: { type: "string", description: "Exact visible text." },
          role: {
            type: "string",
            enum: ["chrome", "content", "brand", "system"],
            description:
              "chrome = app UI text (titles, descriptions, buttons, labels, placeholders, banners, empty states). " +
              "content = user data, saved words, list names, dictionary data, and sample/demo text inside illustrations or mockups. " +
              "brand = product names (Reverso, AI Writer, Premium). " +
              "system = Android status bar, keyboard, numbers, emails, URLs.",
          },
          where: { type: "string", description: "Short location, e.g. 'headline', 'bottom button'." },
          language: {
            type: "string",
            description: "ISO 639-1 code of the language this text is written in, or 'none' if language-neutral.",
          },
          acceptableInExpected: {
            type: "boolean",
            description:
              "True if a native speaker of the expected interface language would accept this exact text in their UI " +
              "(including common loanwords such as Quiz, Premium, Flashcard, and language names written in the expected language).",
          },
        },
      },
    },
    findings: {
      type: "array",
      description: "Defects other than untranslated text.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "evidence", "where"],
        properties: {
          kind: {
            type: "string",
            enum: ["truncated", "error", "spelling", "too_small", "unclear"],
          },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          evidence: {
            type: "string",
            description: "Quoted visible text or a short description of the defect.",
          },
          where: { type: "string", description: "Where on the screen the issue appears." },
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
  md.push("Truncated text, mixed locale, errors, and spelling.");
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

function listArg(name) {
  return arg(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function selectCatalog(catalog) {
  const langs = listArg("--lang");
  const screens = listArg("--screen");
  return {
    ...catalog,
    languages: langs.length
      ? catalog.languages.filter((l) => langs.includes(l.code))
      : catalog.languages,
    screens: screens.length
      ? catalog.screens.filter((s) => screens.includes(s.id))
      : catalog.screens,
  };
}

function collectShots(catalog) {
  const reviewDir = path.join(repoRoot, catalog.reviewDir);
  const missing = [];
  const shots = [];

  for (const screen of catalog.screens) {
    for (const language of catalog.languages) {
      const absolute = path.join(reviewDir, language.code, screen.file);
      if (!fs.existsSync(absolute)) {
        missing.push(`${language.code}/${screen.file}`);
        continue;
      }
      shots.push({
        screen,
        code: language.code,
        picker: language.picker,
        absolute,
        relative: relativeShot(language.code, screen.file),
      });
    }
  }

  return { missing, shots };
}

function buildSystemPrompt() {
  return [
    "You review one Android screenshot of the Reverso app after its interface language was switched.",
    "You are told the expected interface language. Your job is to transcribe and classify, not to judge translations as a whole.",
    "",
    "1. texts: list EVERY visible text element, including long headlines and description paragraphs. Do not skip or merge them.",
    "   For each, give its role, its actual language, and whether it is acceptable in the expected interface language.",
    "   - Onboarding headlines, feature descriptions, and buttons are chrome even when long.",
    "   - Example sentences shown inside an illustration, demo card, or mockup are content, not chrome.",
    "   - Language names written in the expected language (e.g. Inglés, Englisch, 英语) are acceptable.",
    "   - Judge each string on its own. Do not assume a string is fine because nearby text is translated.",
    "",
    "2. findings: other defects only.",
    "   - truncated: ellipsis or text cut by its container or the screen edge. High for chrome, low for user content.",
    "   - error: error dialog, toast, banner, blank screen, or a screen that does not match the described screen.",
    "   - spelling: misspelled chrome in the expected language, including missing diacritics (e.g. Romanian 'Cautari' for 'Căutări').",
    "   - too_small: chrome text hard to read on a phone (roughly below 12sp). Quote it.",
    "   - unclear: low contrast, icon-only control without obvious meaning, or ambiguous label. Cite it.",
    "   Do not report untranslated text in findings; it is derived from texts.",
    "",
    "Return JSON matching the schema.",
  ].join("\n");
}

function buildShotContent(shot, catalog) {
  const { screen } = shot;
  const base64 = fs.readFileSync(shot.absolute).toString("base64");
  return [
    {
      type: "text",
      text: [
        `Expected interface language: ${shot.picker} (code ${shot.code})`,
        `Screen: ${screen.id} — ${screen.what}`,
        `Chrome on this screen: ${screen.chrome || "(all visible UI text)"}`,
        `Content to classify as content: ${screen.content || "(none)"}`,
        `Brand / allowlisted strings: ${(catalog.allowlist || []).join(", ")}`,
      ].join("\n"),
    },
    {
      type: "image_url",
      image_url: { url: `data:image/png;base64,${base64}`, detail: "high" },
    },
  ];
}

async function callOpenAI(apiKey, model, systemPrompt, userContent, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
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
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "locale_shot_review", strict: true, schema: SHOT_SCHEMA },
        },
      }),
    });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      lastError = new Error(`OpenAI response was not JSON for ${label}: ${text.slice(0, 400)}`);
      continue;
    }
    if (!upstream.ok) {
      const message = (data && data.error && data.error.message) || text.slice(0, 400);
      lastError = new Error(`OpenAI ${upstream.status} for ${label}: ${message}`);
      if (upstream.status === 429 || upstream.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw lastError;
    }
    const content = data.choices?.[0]?.message?.content || "";
    try {
      return JSON.parse(content);
    } catch {
      lastError = new Error(`Model returned non-JSON content for ${label}: ${String(content).slice(0, 400)}`);
    }
  }
  throw lastError;
}

function isAllowlisted(text, catalog) {
  const t = normalizeEvidence(text);
  return (catalog.allowlist || []).some((a) => normalizeEvidence(a) === t);
}

async function reviewShot(apiKey, model, systemPrompt, shot, catalog) {
  const { screen } = shot;
  const parsed = await callOpenAI(
    apiKey,
    model,
    systemPrompt,
    buildShotContent(shot, catalog),
    `${shot.code}/${screen.file}`
  );

  const base = {
    screen: screen.id,
    screenFile: screen.file,
    what: screen.what,
    languages: [shot.code],
    shots: [shot.relative],
  };

  // Untranslated chrome is decided here, from the per-string classification.
  const untranslated = (parsed.texts || []).filter(
    (t) =>
      t.role === "chrome" &&
      !t.acceptableInExpected &&
      t.language !== "none" &&
      t.language !== shot.code &&
      String(t.text || "").trim() &&
      !isAllowlisted(t.text, catalog)
  );
  const chromeCount = (parsed.texts || []).filter(
    (t) => t.role === "chrome" && !isAllowlisted(t.text, catalog)
  ).length;
  const mostlyUntranslated =
    untranslated.length >= 3 || (chromeCount > 0 && untranslated.length / chromeCount >= 0.5);

  const findings = untranslated.map((t) => ({
    ...base,
    kind: "mixed_locale",
    severity: mostlyUntranslated ? "high" : "medium",
    evidence: String(t.text).trim(),
    where: t.where,
  }));

  const untranslatedKeys = new Set(untranslated.map((t) => normalizeEvidence(t.text)));
  const contentKeys = (parsed.texts || [])
    .filter((t) => t.role !== "chrome")
    .map((t) => normalizeEvidence(t.text).replace(/\.{3}|…/g, ""));

  for (const raw of parsed.findings || []) {
    if (!ALL_KINDS.has(raw.kind) || !SEVERITIES.has(raw.severity)) continue;
    const evidence = String(raw.evidence || "").trim();
    const where = String(raw.where || "").trim();
    if (!evidence || !where) continue;
    const key = normalizeEvidence(evidence);
    // The model sometimes re-reports untranslated chrome as unclear/spelling.
    if (raw.kind !== "truncated" && untranslatedKeys.has(key)) continue;
    let severity = raw.severity;
    // Ellipsized user content is expected; keep it visible but low.
    const stem = key.replace(/\.{3}|…/g, "");
    if (raw.kind === "truncated" && stem && contentKeys.some((c) => c && (c.startsWith(stem) || stem.startsWith(c)))) {
      severity = "low";
    }
    findings.push({ ...base, kind: raw.kind, severity, evidence, where });
  }

  return { findings, texts: parsed.texts || [], untranslated: untranslated.length, chromeCount };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
    case "spelling":
      return `Fix spelling of “${finding.evidence}” on ${finding.what} (${langs}): ${files}`;
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
    note: [
      meta.partial ? `Partial run: ${catalog.languages.map((l) => l.code).join(", ")} × ${catalog.screens.map((s) => s.id).join(", ")}.` : "",
      "Settings shots cover only the top of the page. Findings there do not cover the rest of Settings.",
    ].filter(Boolean).join(" "),
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
  if (meta.transcripts) {
    fs.writeFileSync(
      path.join(runPath, "transcripts.json"),
      JSON.stringify(meta.transcripts, null, 2) + "\n"
    );
  }
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

  const fullCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const catalog = selectCatalog(fullCatalog);
  const partial =
    catalog.languages.length !== fullCatalog.languages.length ||
    catalog.screens.length !== fullCatalog.screens.length;

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

  const { missing, shots } = collectShots(catalog);
  if (missing.length) {
    console.error("Missing screenshots:");
    for (const item of missing) console.error("  " + item);
    console.error(
      "Pull artifacts first: node .maestro/scripts/pull-locale-screens.js --zip artifacts.zip"
    );
    process.exit(1);
  }
  if (!shots.length) {
    console.error("No screenshots match --lang / --screen.");
    process.exit(1);
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";
  const concurrency = Number(arg("--concurrency")) || 6;
  const systemPrompt = buildSystemPrompt();
  const allFindings = [];
  const transcripts = {};

  console.log(`reviewing ${shots.length} screenshot(s) with ${model}, ${concurrency} at a time…`);
  await mapLimit(shots, concurrency, async (shot) => {
    const label = `${shot.code}/${shot.screen.file}`;
    const result = await reviewShot(apiKey, model, systemPrompt, shot, catalog);
    transcripts[label] = result.texts;
    allFindings.push(...result.findings);
    console.log(
      `  ${label}: ${result.untranslated}/${result.chromeCount} chrome untranslated, ${result.findings.length} finding(s)`
    );
  });

  const written = writeReports(catalog, allFindings, { model, partial, transcripts });
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
