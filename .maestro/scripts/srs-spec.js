/**
 * Soft SRS selection helpers for Android quiz scoring.
 * Keep in sync with Favorites/srs-game-tester.html (normalizeFavItem, classifyBucket,
 * assessSelection, mixTargets, and related helpers).
 * Corpus input: export from the SRS game tester (Expert mode → Export corpus).
 */

const DAY_MS = 86400000;
const SRS_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14 };

function isLastStatusCorrect(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === "") return false;
  const s = String(value).trim().toUpperCase();
  return s === "TRUE" || s === "CORRECT" || s === "KNOW" || s === "YES" || s === "MEMORIZED";
}

function learnStatusOf(item) {
  return String(item?.classification || item?.status || "").trim().toUpperCase();
}

function itemIsMastered(item) {
  const status = learnStatusOf(item);
  const last = String(item?.lastStatus || "").trim().toUpperCase();
  return !!(item?.memorized || item?.isMemorized) || status === "MEMORIZED" || last === "MEMORIZED";
}

function itemLastStatusCorrect(item) {
  if (isLastStatusCorrect(item?.lastStatus)) return true;
  const status = learnStatusOf(item);
  return status === "CORRECT" || status === "MEMORIZED";
}

function itemHasBeenReviewed(item) {
  const status = learnStatusOf(item);
  return Number(item?.timesSeen || 0) > 0
    || Number(item?.srsCounter || 0) > 0
    || isLastStatusCorrect(item?.lastStatus)
    || status === "CORRECT"
    || status === "INCORRECT"
    || status === "MEMORIZED";
}

function termKey(srcLang, trgLang, srcText, trgText) {
  return [
    String(srcLang || "").toLowerCase(),
    String(trgLang || "").toLowerCase(),
    String(srcText || "").trim().toLowerCase(),
    String(trgText || "").trim().toLowerCase(),
  ].join("|");
}

function isIneligibleTerm(srcText, favType, extra) {
  const len = String(srcText || "").trim().length;
  if (len > 0 && (len < 3 || len > 24)) return "source length";
  const type = String(favType || extra?.histType || "").toLowerCase();
  if (type === "syn" || type === "synonym" || type === "synonyms") return "synonym";
  if (type === "mt") return "mt";
  const register = String(extra?.register || extra?.languageLevel || "").toLowerCase();
  if (register === "rude") return "rude";
  return "";
}

function listIdsFromFav(fav) {
  const lists = fav?.lists;
  if (!Array.isArray(lists)) return [];
  return lists.map((item) => {
    if (item == null) return null;
    if (typeof item === "object") return item.id ?? item.listId;
    return item;
  }).filter((id) => id != null);
}

function normalizeLearnFields(raw) {
  const lc = raw && typeof raw === "object" ? raw : {};
  const status = String(lc.status || lc.classification || "").toUpperCase();
  const lastStatus = (lc.lastStatus != null && lc.lastStatus !== "")
    ? lc.lastStatus
    : (status === "CORRECT" || status === "INCORRECT" || status === "MEMORIZED" ? status : lc.lastStatus);
  const memorized = !!(lc.memorized ?? lc.isMemorized)
    || status === "MEMORIZED"
    || String(lc.lastStatus || "").toUpperCase() === "MEMORIZED";
  return {
    learnId: lc.id ?? null,
    timesSeen: Number(lc.timesSeen ?? 0),
    srsCounter: Number(lc.srsCounter ?? 0),
    memorized,
    lastStatus,
    lastStatusCorrect: isLastStatusCorrect(lastStatus) || status === "CORRECT" || status === "MEMORIZED",
    lastSeenDate: lc.lastSeenDate || "",
    firstSeenDate: lc.firstSeenDate || "",
    classification: status,
    ignored: status === "IGNORED" || !!lc.ignored || !!lc.isIgnored,
    hasLearnCard: lc.id != null || lc.status != null || lc.timesSeen != null
      || lc.srsCounter != null || lc.lastStatus != null,
  };
}

function normalizeFavItem(fav) {
  const srcText = String(fav.srcText || "").trim();
  const trgText = String(fav.trgText || "").trim();
  const srcLang = fav.srcLang || "";
  const trgLang = fav.trgLang || "";
  const learn = normalizeLearnFields(fav.learnCard);
  const ineligible = isIneligibleTerm(srcText, fav.favType, fav);
  return {
    origin: "favourites",
    id: fav.id,
    ...learn,
    srcText,
    trgText,
    srcLang,
    trgLang,
    srcContext: String(fav.srcContext || "").trim(),
    trgContext: String(fav.trgContext || "").trim(),
    key: termKey(srcLang, trgLang, srcText, trgText),
    creationDate: fav.creationDate || "",
    lastEdit: fav.lastEdit || fav.creationDate || "",
    favType: String(fav.favType || ""),
    listIds: listIdsFromFav(fav),
    ineligible,
    excluded: learn.ignored || !!ineligible,
  };
}

function daysOverdue(item, nowMs) {
  if (!itemLastStatusCorrect(item)) return Number.POSITIVE_INFINITY;
  const interval = SRS_INTERVAL_DAYS[item.srsCounter] ?? 0;
  if (!item.lastSeenDate) return 0;
  const seen = Date.parse(item.lastSeenDate);
  if (!Number.isFinite(seen)) return 0;
  const due = seen + interval * DAY_MS;
  return (nowMs - due) / DAY_MS;
}

function classifyBucket(item, nowMs) {
  if (item.ignored) return "excluded";
  if (item.ineligible) return "ineligible";
  if (itemIsMastered(item)) return "mastered";
  if (!item.hasLearnCard || !itemHasBeenReviewed(item)) return "new";
  if (!itemLastStatusCorrect(item)) return "mistake";
  const overdue = daysOverdue(item, nowMs);
  if (overdue < 0) return "not_due";
  if (overdue <= 30) return "fresh";
  return "old";
}

function mixTargets(strategy, n) {
  if (strategy === "NEW") return { new: n, fresh: 0, old: 0 };
  if (strategy === "SRS") {
    const nNew = Math.round(n * 0.25);
    const nFresh = Math.round(n * 0.5);
    return { new: nNew, fresh: nFresh, old: Math.max(0, n - nNew - nFresh) };
  }
  const nNew = Math.round(n * 0.4);
  const nOld = Math.round(n * 0.1);
  return { new: nNew, fresh: Math.max(0, n - nNew - nOld), old: nOld };
}

function bucketCounts(items) {
  const counts = {
    new: 0, mistake: 0, fresh: 0, old: 0,
    not_due: 0, mastered: 0, ineligible: 0, excluded: 0,
  };
  for (const item of items) {
    counts[item.bucket] = (counts[item.bucket] || 0) + 1;
  }
  return counts;
}

function assessSelection(bucket, strategy, poolCounts, n) {
  const issues = [];
  if (bucket === "ineligible") issues.push("ineligible term in quiz");
  if (bucket === "excluded") issues.push("ignored/excluded term drawn");
  if (strategy === "NEW" && bucket !== "new" && bucket !== "unknown") {
    issues.push("NEW strategy drew a non-new card");
  }
  if (bucket === "mastered") {
    const learningLeft = (poolCounts.mistake || 0) + (poolCounts.fresh || 0)
      + (poolCounts.old || 0) + (poolCounts.not_due || 0) + (poolCounts.new || 0);
    if (learningLeft > 0) issues.push("mastered drawn while learning cards remain");
  }
  if (bucket === "not_due") {
    const dueLeft = (poolCounts.mistake || 0) + (poolCounts.fresh || 0)
      + (poolCounts.old || 0) + (poolCounts.new || 0);
    if (dueLeft >= n) issues.push("not-due card drawn while enough due/new cards exist");
  }
  if (bucket === "old" && strategy === "MIXED" && (poolCounts.fresh || 0) >= n) {
    issues.push("old review drawn while enough fresh (≤30d) reviews exist");
  }
  return issues;
}

function filteredFavs(favs, params, nowMs) {
  const src = String(params.sourceLang || "").toLowerCase();
  const tgt = String(params.targetLang || "").toLowerCase();
  const out = [];
  for (const item of favs) {
    if (src && String(item.srcLang || "").toLowerCase() !== src) continue;
    if (tgt && String(item.trgLang || "").toLowerCase() !== tgt) continue;
    out.push({ ...item, bucket: classifyBucket(item, nowMs) });
  }
  return out;
}

function bucketLabel(bucket) {
  return {
    new: "New",
    mistake: "Mistake",
    fresh: "Fresh review (≤30d)",
    old: "Old review (>30d)",
    not_due: "Not yet due",
    mastered: "Mastered",
    ineligible: "Ineligible",
    excluded: "Excluded",
    unknown: "Unknown",
  }[bucket] || bucket;
}

module.exports = {
  DAY_MS,
  SRS_INTERVAL_DAYS,
  normalizeFavItem,
  classifyBucket,
  assessSelection,
  mixTargets,
  bucketCounts,
  filteredFavs,
  bucketLabel,
  isLastStatusCorrect,
  itemIsMastered,
  itemLastStatusCorrect,
  itemHasBeenReviewed,
  termKey,
};
