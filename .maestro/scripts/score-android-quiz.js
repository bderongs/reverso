#!/usr/bin/env node
/**
 * Score Android quiz terms (from Maestro) against a Favourites corpus snapshot
 * using the same soft selection rules as Favorites/srs-game-tester.html.
 *
 * Corpus exports live in Android_testing/ (browser download → move there).
 * If --corpus is omitted, lists those JSON files and asks which one to use.
 *
 * Usage:
 *   node .maestro/scripts/score-android-quiz.js
 *   node .maestro/scripts/score-android-quiz.js --corpus Android_testing/corpus-….json
 *   node .maestro/scripts/score-android-quiz.js --strategy SRS --src en --trg fr
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  classifyBucket,
  assessSelection,
  mixTargets,
  bucketCounts,
  filteredFavs,
  bucketLabel,
} = require("./srs-spec");

const REPO_ROOT = path.join(__dirname, "..", "..");
const MAESTRO_DIR = path.join(__dirname, "..");
const RUNS_DIR = path.join(MAESTRO_DIR, "quiz-runs");
const CORPUS_DIR = path.join(REPO_ROOT, "Android_testing");
const DEFAULT_QUIZ = path.join(RUNS_DIR, "latest.json");
const DEFAULT_OUT = path.join(RUNS_DIR, "latest-score.json");

function parseArgs(argv) {
  const out = {
    corpusPath: "",
    quizPath: DEFAULT_QUIZ,
    outPath: DEFAULT_OUT,
    strategy: "MIXED",
    sourceLang: "",
    targetLang: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--corpus" && argv[i + 1]) out.corpusPath = path.resolve(argv[++i]);
    else if (arg === "--quiz" && argv[i + 1]) out.quizPath = path.resolve(argv[++i]);
    else if (arg === "--out" && argv[i + 1]) out.outPath = path.resolve(argv[++i]);
    else if (arg === "--strategy" && argv[i + 1]) out.strategy = String(argv[++i]).toUpperCase();
    else if ((arg === "--src" || arg === "--source") && argv[i + 1]) out.sourceLang = String(argv[++i]).toLowerCase();
    else if ((arg === "--trg" || arg === "--target") && argv[i + 1]) out.targetLang = String(argv[++i]).toLowerCase();
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function isCorpusExport(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data?.favs);
  } catch {
    return false;
  }
}

function listCorpusExports(dir = CORPUS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(dir, name))
    .filter(isCorpusExport)
    .map((filePath) => {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const st = fs.statSync(filePath);
      return {
        filePath,
        name: path.basename(filePath),
        favs: Array.isArray(data.favs) ? data.favs.length : 0,
        userLabel: data.userLabel || data.userId || "",
        syncedAtIso: data.syncedAtIso || (data.syncedAt ? new Date(data.syncedAt).toISOString() : ""),
        mtimeMs: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function askQuestion(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function pickCorpusPath(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Corpus not found: ${explicitPath}`);
    }
    return explicitPath;
  }

  const options = listCorpusExports();
  if (!options.length) {
    throw new Error(
      `No corpus JSON found in ${CORPUS_DIR}\n`
      + "Export from the SRS game tester (Expert mode → Export corpus) and move the file into Android_testing/."
    );
  }

  console.log(`Corpus files in Android_testing/ (${options.length}):\n`);
  options.forEach((opt, i) => {
    const who = opt.userLabel ? ` · ${opt.userLabel}` : "";
    const when = opt.syncedAtIso ? ` · synced ${opt.syncedAtIso}` : "";
    console.log(`  [${i + 1}] ${opt.name}`);
    console.log(`      ${opt.favs} favs${who}${when}`);
  });
  console.log("");

  if (options.length === 1) {
    console.log(`Using the only corpus: ${options[0].name}\n`);
    return options[0].filePath;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Several corpus files found — pass one with --corpus <path>, or run in a terminal to pick interactively."
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = String(await askQuestion(rl, `Pick a corpus [1-${options.length}]: `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        return options[n - 1].filePath;
      }
      console.log("Invalid choice.");
    }
  } finally {
    rl.close();
  }
}

function normText(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function contextScore(example, item) {
  const ex = normText(example);
  if (!ex) return 0;
  const src = normText(item.srcContext);
  const trg = normText(item.trgContext);
  if (src && (src === ex || src.includes(ex) || ex.includes(src))) return 3;
  if (trg && (trg === ex || trg.includes(ex) || ex.includes(trg))) return 2;
  if (src && shareTokens(ex, src) >= 0.5) return 1;
  return 0;
}

function shareTokens(a, b) {
  const ta = new Set(a.split(" ").filter((t) => t.length > 2));
  const tb = new Set(b.split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.min(ta.size, tb.size);
}

function matchPresentedTerm(term, example, favs, preferredPair) {
  const needle = normText(term);
  if (!needle) return { item: null, ambiguous: false, candidates: 0 };
  let candidates = favs.filter((f) => normText(f.srcText) === needle);
  if (!candidates.length) return { item: null, ambiguous: false, candidates: 0 };

  const src = preferredPair?.sourceLang;
  const trg = preferredPair?.targetLang;
  if (src || trg) {
    const narrowed = candidates.filter((f) => {
      if (src && String(f.srcLang || "").toLowerCase() !== src) return false;
      if (trg && String(f.trgLang || "").toLowerCase() !== trg) return false;
      return true;
    });
    if (narrowed.length) candidates = narrowed;
  }

  if (candidates.length === 1) {
    return { item: candidates[0], ambiguous: false, candidates: 1 };
  }
  let best = candidates[0];
  let bestScore = -1;
  let ties = 0;
  for (const c of candidates) {
    const score = contextScore(example, c);
    if (score > bestScore) {
      best = c;
      bestScore = score;
      ties = 1;
    } else if (score === bestScore) {
      ties += 1;
    }
  }
  return {
    item: best,
    ambiguous: ties > 1 && bestScore === 0,
    candidates: candidates.length,
    matchScore: bestScore,
  };
}

function inferLangPair(terms, favs) {
  const pairCounts = new Map();
  for (const t of terms) {
    const { item } = matchPresentedTerm(t.term, t.example, favs);
    if (!item) continue;
    const key = `${String(item.srcLang || "").toLowerCase()}|${String(item.trgLang || "").toLowerCase()}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of pairCounts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  if (!best) return { sourceLang: "", targetLang: "" };
  const [sourceLang, targetLang] = best.split("|");
  return { sourceLang, targetLang, matchCount: bestN };
}

function emptyMix() {
  return {
    new: 0, mistake: 0, fresh: 0, old: 0,
    not_due: 0, mastered: 0, ineligible: 0, excluded: 0, unknown: 0, unmatched: 0,
  };
}

function scoreRun(corpus, quiz, options) {
  const nowMs = Number(corpus.syncedAt) || Date.now();
  const favs = Array.isArray(corpus.favs) ? corpus.favs : [];
  const terms = Array.isArray(quiz.terms) ? quiz.terms : [];

  let sourceLang = options.sourceLang;
  let targetLang = options.targetLang;
  if (!sourceLang || !targetLang) {
    const inferred = inferLangPair(terms, favs);
    sourceLang = sourceLang || inferred.sourceLang || "";
    targetLang = targetLang || inferred.targetLang || "";
  }

  const params = {
    sourceStrategy: "FAVOURITES",
    learningStrategy: options.strategy || "MIXED",
    sourceLang,
    targetLang,
  };

  const pool = filteredFavs(favs, params, nowMs);
  const poolCounts = bucketCounts(pool);
  const byTurn = new Map();
  for (const t of terms) {
    const turn = Number(t.turn) || 1;
    if (!byTurn.has(turn)) byTurn.set(turn, []);
    byTurn.get(turn).push(t);
  }

  const turns = [];
  const plays = [];
  let selectionOk = 0;
  let selectionBad = 0;
  let unmatched = 0;
  const overallMix = emptyMix();

  for (const turn of [...byTurn.keys()].sort((a, b) => a - b)) {
    const turnTerms = byTurn.get(turn);
    const n = turnTerms.length;
    const targets = mixTargets(params.learningStrategy, n);
    const mix = emptyMix();
    const turnPlays = [];

    for (const entry of turnTerms) {
      const match = matchPresentedTerm(entry.term, entry.example, favs, {
        sourceLang,
        targetLang,
      });
      let bucket = "unknown";
      const issues = [];
      let matched = null;

      if (!match.item) {
        bucket = "unmatched";
        issues.push("not in loaded corpus");
        unmatched += 1;
      } else {
        matched = match.item;
        const inPair =
          (!sourceLang || String(matched.srcLang || "").toLowerCase() === sourceLang)
          && (!targetLang || String(matched.trgLang || "").toLowerCase() === targetLang);
        bucket = classifyBucket(matched, nowMs);
        if (!inPair) {
          issues.push(
            `lang ${matched.srcLang}→${matched.trgLang} outside scored pair`
            + (sourceLang ? ` ${sourceLang}→${targetLang}` : "")
          );
        }
        if (match.ambiguous) issues.push("ambiguous srcText match (no unique example)");
        if (inPair) {
          issues.push(...assessSelection(bucket, params.learningStrategy, poolCounts, n));
        }
      }

      if (overallMix[bucket] == null) overallMix.unknown += 1;
      else overallMix[bucket] += 1;
      if (mix[bucket] == null) mix.unknown += 1;
      else mix[bucket] += 1;

      if (issues.length) selectionBad += 1;
      else selectionOk += 1;

      const play = {
        turn,
        index: entry.index,
        term: entry.term,
        example: entry.example || "",
        bucket,
        ok: issues.length === 0,
        issues,
        favId: matched?.id ?? null,
        learnId: matched?.learnId ?? null,
        srcLang: matched?.srcLang || "",
        trgLang: matched?.trgLang || "",
        srsCounter: matched?.srsCounter ?? null,
        timesSeen: matched?.timesSeen ?? null,
        memorized: matched?.memorized ?? null,
        lastSeenDate: matched?.lastSeenDate || "",
      };
      turnPlays.push(play);
      plays.push(play);
    }

    turns.push({
      turn,
      count: n,
      targets,
      mix,
      selectionOk: turnPlays.filter((p) => p.ok).length,
      selectionBad: turnPlays.filter((p) => !p.ok).length,
      plays: turnPlays,
    });
  }

  return {
    scoredAt: new Date().toISOString(),
    caveats: [
      "Scored against the original corpus snapshot (not updated after Android answers).",
      "Set 1 is the clean read; later sets may look noisier because answering mutates Learn DB.",
      "Soft selection check only — does not require the exact same cards as the web quiz API.",
      "SRS updates are not scored (Android does not report CORRECT vs INCORRECT).",
    ],
    assumptions: {
      sourceStrategy: "FAVOURITES",
      learningStrategy: params.learningStrategy,
      sourceLang,
      targetLang,
      corpusSyncedAt: corpus.syncedAtIso || (corpus.syncedAt ? new Date(corpus.syncedAt).toISOString() : ""),
      corpusFavs: favs.length,
      quizRunId: quiz.runId || "",
      quizTermCount: terms.length,
    },
    pool: {
      inScope: pool.length,
      buckets: poolCounts,
      expectedMixPerGame: mixTargets(params.learningStrategy, turns[0]?.count || 7),
    },
    summary: {
      selectionOk,
      selectionBad,
      unmatched,
      mix: overallMix,
    },
    turns,
    plays,
  };
}

function formatSummary(report) {
  const lines = [];
  const a = report.assumptions;
  const s = report.summary;
  lines.push("Android quiz vs web SRS baseline (soft selection)");
  lines.push("─".repeat(56));
  lines.push(
    `Assumptions: ${a.sourceStrategy} · ${a.learningStrategy}`
    + (a.sourceLang ? ` · ${a.sourceLang}→${a.targetLang}` : "")
    + ` · corpus ${a.corpusFavs} favs`
    + (a.corpusFile ? ` (${a.corpusFile})` : "")
  );
  lines.push(`Quiz run: ${a.quizRunId || "?"} · ${a.quizTermCount} terms`);
  lines.push(
    `Pool: ${report.pool.inScope} in scope · `
    + `new ${report.pool.buckets.new} · mistake ${report.pool.buckets.mistake}`
    + ` · fresh ${report.pool.buckets.fresh} · old ${report.pool.buckets.old}`
    + ` · not_due ${report.pool.buckets.not_due} · mastered ${report.pool.buckets.mastered}`
  );
  const t = report.pool.expectedMixPerGame;
  lines.push(`Target mix (~${report.turns[0]?.count || 7}/set): ~${t.new} new · ${t.fresh} fresh · ${t.old} old (mistakes first)`);
  lines.push(
    `Result: ${s.selectionOk} ok · ${s.selectionBad} flagged · ${s.unmatched} unmatched`
  );
  lines.push("");
  lines.push("Caveats:");
  for (const c of report.caveats) lines.push(`  • ${c}`);
  lines.push("");

  for (const turn of report.turns) {
    const m = turn.mix;
    lines.push(
      `Turn ${turn.turn} (${turn.count} cards): `
      + `ok ${turn.selectionOk}/${turn.count}`
      + ` · mix new ${m.new} / mistake ${m.mistake} / fresh ${m.fresh} / old ${m.old}`
      + ` / not_due ${m.not_due} / mastered ${m.mastered}`
      + (m.unmatched ? ` / unmatched ${m.unmatched}` : "")
    );
    for (const p of turn.plays) {
      const verdict = p.ok ? "ok" : p.issues.join("; ");
      lines.push(
        `  turn ${p.turn} · ${p.term} · ${bucketLabel(p.bucket)} · ${verdict}`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node .maestro/scripts/score-android-quiz.js [options]

Corpus exports: put the SRS tester download into Android_testing/
(If --corpus is omitted, lists those files and asks which to use.)

Options:
  --corpus path   Favourites dump JSON (optional — pick from Android_testing/)
  --quiz path     Maestro latest.json (default: ${DEFAULT_QUIZ})
  --out path      Score JSON (default: ${DEFAULT_OUT})
  --strategy MIXED|SRS|NEW   (default: MIXED)
  --src lang      Override source language
  --trg lang      Override target language`);
    return;
  }

  const corpusPath = await pickCorpusPath(args.corpusPath);
  if (!fs.existsSync(args.quizPath)) {
    throw new Error(`Quiz log not found: ${args.quizPath}\nRun Maestro with the term logger first.`);
  }

  console.log(`Scoring with corpus: ${path.relative(REPO_ROOT, corpusPath) || corpusPath}\n`);

  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const quiz = JSON.parse(fs.readFileSync(args.quizPath, "utf8"));
  const report = scoreRun(corpus, quiz, {
    strategy: args.strategy,
    sourceLang: args.sourceLang,
    targetLang: args.targetLang,
  });
  report.assumptions.corpusFile = path.basename(corpusPath);

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, JSON.stringify(report, null, 2));
  const text = formatSummary(report);
  const textPath = args.outPath.replace(/\.json$/i, ".txt");
  fs.writeFileSync(textPath, text);
  process.stdout.write(text);
  console.log(`\nWrote ${args.outPath}`);
  console.log(`Wrote ${textPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
