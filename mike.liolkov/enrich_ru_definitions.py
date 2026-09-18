#!/usr/bin/env python3
"""Enrich en→en definition favorites with Russian targetText / targetContext."""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

INPUT = Path(__file__).with_name(
    "query_result_2026-09-15T15_45_29.125786042Z.csv"
)
OUTPUT = Path(__file__).with_name("favorites_en_ru_enriched.csv")
CACHE = Path(__file__).with_name("definition_api_cache.json")
ERRORS = Path(__file__).with_name("enrich_ru_errors.jsonl")

API = (
    "https://definition-api.reverso.net/v1/api/definitions/en/{word}"
    "?targetLang=ru&maxExpressions=60&showNeighbors=2&expressionDefs=24"
    "&wordExpressions=true&showRelated=false&showMainTranslations=true"
    "&showVocabularyLists=true"
)

POS_MAP = {
    "n.": "Noun",
    "n": "Noun",
    "v.": "Verb",
    "v": "Verb",
    "adj.": "Adjective",
    "adj": "Adjective",
    "adv.": "Adverb",
    "adv": "Adverb",
    "prep.": "Preposition",
    "conj.": "Conjunction",
    "pron.": "Pronoun",
    "interj.": "Interjection",
}

TAG_RE = re.compile(r"<[^>]+>")
UA = "Mozilla/5.0 (compatible; ReversoFavoritesEnricher/1.0)"


def strip_tags(text: str) -> str:
    return TAG_RE.sub("", text or "").strip()


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower().rstrip("."))


def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def fetch_definition(word: str, cache: dict) -> dict | None:
    key = word.lower()
    if key in cache:
        return cache[key]

    url = API.format(word=urllib.parse.quote(word, safe=""))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        data = {"_error": f"HTTP {e.code}", "_body": body[:500]}
    except Exception as e:  # noqa: BLE001
        data = {"_error": str(e)}

    cache[key] = data
    return data


def iter_defs(payload: dict):
    for word_block in payload.get("DefsByWord") or []:
        for pos_block in word_block.get("DefsByPos") or []:
            pos = pos_block.get("Pos") or ""
            for definition in pos_block.get("Defs") or []:
                yield pos, definition, "def"
        for expr in word_block.get("expressionDefs") or []:
            # expressionDefs are flatter
            yield expr.get("pos") or "", expr, "expression"


def first_ru_translation(definition: dict) -> str:
    for t in definition.get("translations") or []:
        if (t.get("lang") or "ru") == "ru" and t.get("translation"):
            return strip_tags(t["translation"])
    for t in definition.get("termTranslations") or []:
        if t.get("translation"):
            return strip_tags(t["translation"])
    return ""


def first_ru_example(definition: dict, preferred_en_example: str = "") -> tuple[str, str]:
    """Return (ru_example, matched_en_example)."""
    examples = definition.get("examples") or []
    preferred = normalize(preferred_en_example)

    ordered = list(examples)
    if preferred:
        ordered.sort(
            key=lambda ex: 0 if normalize(ex.get("example") or "") == preferred else 1
        )

    for ex in ordered:
        for t in ex.get("translations") or []:
            if (t.get("lang") or "ru") == "ru" and t.get("translation"):
                return strip_tags(t["translation"]), ex.get("example") or ""
    # expressionDefs may only have English examples
    if examples:
        return "", examples[0].get("example") or ""
    return "", ""


def score_definition(
    pos: str,
    definition: dict,
    kind: str,
    wanted_def: str,
    wanted_example: str,
    wanted_pos: str,
) -> int:
    score = 0
    api_def = definition.get("Def") or definition.get("def") or ""
    if normalize(api_def) == normalize(wanted_def) and wanted_def:
        score += 100
    elif wanted_def and normalize(wanted_def) in normalize(api_def):
        score += 40
    elif wanted_def and normalize(api_def) in normalize(wanted_def):
        score += 40

    if wanted_pos and POS_MAP.get(wanted_pos.lower().strip(), wanted_pos) == pos:
        score += 20

    if wanted_example:
        for ex in definition.get("examples") or []:
            if normalize(ex.get("example") or "") == normalize(wanted_example):
                score += 80
                break

    if kind == "expression" and " " in wanted_def:
        score += 5

    if definition.get("showInFirstView"):
        score += 1

    return score


def pick_definition(payload: dict, row: dict) -> tuple[dict | None, str]:
    wanted_def = row.get("Target Text") or ""
    wanted_example = row.get("Source Context") or ""
    wanted_pos = row.get("Source Pos") or ""
    source = row.get("Source Text") or ""

    best = None
    best_score = -1
    best_pos = ""

    for pos, definition, kind in iter_defs(payload):
        # For expressionDefs, expression text should match source for multi-word
        if kind == "expression":
            expr = definition.get("expression") or ""
            if normalize(expr) != normalize(source) and " " in source:
                # still allow scoring via def text
                pass
            elif normalize(expr) == normalize(source):
                # boost exact expression match
                s = score_definition(pos, definition, kind, wanted_def, wanted_example, wanted_pos)
                s += 50
                if s > best_score:
                    best_score = s
                    best = definition
                    best_pos = pos
                continue

        s = score_definition(pos, definition, kind, wanted_def, wanted_example, wanted_pos)
        if s > best_score:
            best_score = s
            best = definition
            best_pos = pos

    if best is None:
        # fallback: first def
        for pos, definition, _kind in iter_defs(payload):
            return definition, pos
        return None, ""

    return best, best_pos


def enrich_row(row: dict, payload: dict | None) -> dict:
    out = dict(row)
    out["RU Target Text"] = ""
    out["RU Target Context"] = ""
    out["RU Matched Def"] = ""
    out["RU Match Status"] = ""

    if not payload:
        out["RU Match Status"] = "no_response"
        return out
    if payload.get("_error"):
        out["RU Match Status"] = f"error:{payload['_error']}"
        return out
    if not payload.get("DefsByWord"):
        out["RU Match Status"] = "not_found"
        return out

    definition, _pos = pick_definition(payload, row)
    if not definition:
        out["RU Match Status"] = "no_def"
        return out

    api_def = definition.get("Def") or definition.get("def") or ""
    ru_text = first_ru_translation(definition)
    ru_ctx, _en = first_ru_example(definition, row.get("Source Context") or "")

    # expressionDefs often lack translations — try parent word first sense as last resort
    if not ru_text:
        for _pos, d, kind in iter_defs(payload):
            if kind != "def":
                continue
            ru_text = first_ru_translation(d)
            if not ru_ctx:
                ru_ctx, _ = first_ru_example(d, row.get("Source Context") or "")
            if ru_text:
                api_def = d.get("Def") or api_def
                break

    out["RU Target Text"] = ru_text
    out["RU Target Context"] = ru_ctx
    out["RU Matched Def"] = api_def
    if ru_text and ru_ctx:
        out["RU Match Status"] = "ok"
    elif ru_text:
        out["RU Match Status"] = "ok_no_context"
    else:
        out["RU Match Status"] = "no_ru_translation"
    return out


def main() -> None:
    with INPUT.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    extra = ["RU Target Text", "RU Target Context", "RU Matched Def", "RU Match Status"]
    out_fields = fieldnames + [c for c in extra if c not in fieldnames]

    cache = load_cache()
    enriched = []
    errors = []

    # Only request unique Source Text values, but enrich every row (sense-matched).
    unique_words = []
    seen = set()
    for row in rows:
        w = (row.get("Source Text") or "").strip()
        if not w or w.lower() in seen:
            continue
        # Skip empty / non-en sources for API path; still process row later
        if (row.get("Source Lang") or "").lower() != "en":
            continue
        seen.add(w.lower())
        unique_words.append(w)

    print(f"Rows: {len(rows)}; unique EN sources: {len(unique_words)}")
    print(f"Cached: {sum(1 for w in unique_words if w.lower() in cache)}")

    for i, word in enumerate(unique_words, 1):
        if word.lower() not in cache:
            fetch_definition(word, cache)
            if i % 25 == 0:
                save_cache(cache)
                print(f"  fetched {i}/{len(unique_words)}: {word}")
            time.sleep(0.12)  # be polite
        elif i % 100 == 0:
            print(f"  cache hit progress {i}/{len(unique_words)}")

    save_cache(cache)

    for row in rows:
        word = (row.get("Source Text") or "").strip()
        payload = cache.get(word.lower()) if word else None
        if (row.get("Source Lang") or "").lower() != "en":
            enriched_row = dict(row)
            enriched_row.update(
                {
                    "RU Target Text": "",
                    "RU Target Context": "",
                    "RU Matched Def": "",
                    "RU Match Status": "skipped_non_en_source",
                }
            )
        else:
            enriched_row = enrich_row(row, payload)
            if enriched_row["RU Match Status"] not in {"ok", "ok_no_context"}:
                errors.append(
                    {
                        "id": row.get("ID"),
                        "source": word,
                        "status": enriched_row["RU Match Status"],
                        "target_text": row.get("Target Text"),
                    }
                )
        enriched.append(enriched_row)

    with OUTPUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(enriched)

    with ERRORS.open("w", encoding="utf-8") as f:
        for err in errors:
            f.write(json.dumps(err, ensure_ascii=False) + "\n")

    status_counts: dict[str, int] = {}
    for r in enriched:
        status_counts[r["RU Match Status"]] = status_counts.get(r["RU Match Status"], 0) + 1

    print(f"Wrote {OUTPUT}")
    print(f"Errors log: {ERRORS} ({len(errors)})")
    print("Status counts:")
    for k, v in sorted(status_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
