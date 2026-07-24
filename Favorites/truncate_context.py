#!/usr/bin/env python3
"""
Truncate favourite text fields to a max length, preserving the search term when possible.

Rule (see truncate_context_rule.md):
  - Default: keep the start of the string (drop the tail).
  - If the term would fall in the dropped tail, keep the end instead (drop the head).
  - If the term still does not fit (very long term or term in the middle of a long string),
    keep a window centered on the first term occurrence.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from typing import Callable, Optional


DEFAULT_MAX_LEN = 512


@dataclass(frozen=True)
class TruncateResult:
    value: str
    strategy: str  # "unchanged" | "prefix" | "suffix" | "center"


def find_term_span(text: str, term: str, *, case_insensitive: bool = False) -> Optional[tuple[int, int]]:
    """Return (start, end) of the first occurrence of term in text, or None."""
    if not text or not term:
        return None
    haystack = text
    needle = term
    if case_insensitive:
        haystack = text.lower()
        needle = term.lower()
    idx = haystack.find(needle)
    if idx == -1:
        return None
    return idx, idx + len(term)


def _term_fits(span: Optional[tuple[int, int]], start: int, end: int) -> bool:
    if span is None:
        return False
    term_start, term_end = span
    return term_start >= start and term_end <= end


def truncate_preserving_term(
    text: Optional[str],
    term: Optional[str],
    max_len: int = DEFAULT_MAX_LEN,
    *,
    case_insensitive: bool = False,
) -> TruncateResult:
    """
    Truncate `text` to at most `max_len` characters.

    `term` is the substring that must be kept when possible (e.g. SOURCE_TEXT inside
    SOURCE_CONTEXT). Matching is literal on the stored string (HTML included).
    """
    if text is None:
        return TruncateResult(value=None, strategy="unchanged")  # type: ignore[arg-type]
    if max_len <= 0:
        raise ValueError("max_len must be positive")
    if len(text) <= max_len:
        return TruncateResult(value=text, strategy="unchanged")

    span = find_term_span(text, term or "", case_insensitive=case_insensitive)

    # No term to preserve → default prefix cut.
    if span is None:
        return TruncateResult(value=text[:max_len], strategy="prefix")

    prefix = text[:max_len]
    if _term_fits(span, 0, max_len):
        return TruncateResult(value=prefix, strategy="prefix")

    # Term is in the cut tail (or spans the cut boundary) → keep suffix.
    suffix = text[-max_len:]
    if _term_fits(span, len(text) - max_len, len(text)):
        return TruncateResult(value=suffix, strategy="suffix")

    # Term sits in the middle: neither prefix nor suffix contains it whole.
    term_start, term_end = span
    term_len = term_end - term_start
    if term_len > max_len:
        # Cannot preserve the full term; fall back to prefix.
        return TruncateResult(value=prefix, strategy="prefix")

    padding = max_len - term_len
    left_pad = padding // 2
    window_start = max(0, term_start - left_pad)
    window_end = window_start + max_len
    if window_end > len(text):
        window_end = len(text)
        window_start = max(0, window_end - max_len)
    return TruncateResult(value=text[window_start:window_end], strategy="center")


def truncate_favourite_row(
    row: dict,
    max_len: int = DEFAULT_MAX_LEN,
    *,
    case_insensitive: bool = False,
) -> dict:
    """
    Apply truncation to context columns on a favourite-shaped dict.

    Keys (DB or API):
      SOURCE_TEXT, SOURCE_CONTEXT, TARGET_TEXT, TARGET_CONTEXT,
      TARGET_TEXT_EDITED, DOCUMENT
    """
    out = dict(row)

    pairs = [
        ("SOURCE_CONTEXT", "SOURCE_TEXT"),
        ("TARGET_CONTEXT", "TARGET_TEXT"),
    ]
    for context_key, term_key in pairs:
        if context_key in out and out[context_key] is not None:
            result = truncate_preserving_term(
                out[context_key],
                out.get(term_key),
                max_len,
                case_insensitive=case_insensitive,
            )
            out[context_key] = result.value

    for solo_key in ("SOURCE_TEXT", "TARGET_TEXT", "TARGET_TEXT_EDITED", "DOCUMENT"):
        if solo_key in out and out[solo_key] is not None:
            result = truncate_preserving_term(
                out[solo_key],
                out.get(solo_key) if solo_key in ("SOURCE_TEXT", "TARGET_TEXT") else None,
                max_len,
                case_insensitive=case_insensitive,
            )
            out[solo_key] = result.value

    return out


def _read_rows(path: str) -> list[dict]:
    if path == "-":
        data = sys.stdin.read()
    else:
        with open(path, encoding="utf-8") as f:
            data = f.read()
    if not data.strip():
        return []
    if path.endswith(".json") or data.lstrip().startswith("["):
        parsed = json.loads(data)
        if isinstance(parsed, list):
            return parsed
        return [parsed]
    reader = csv.DictReader(data.splitlines())
    return list(reader)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Truncate favourite text fields to max length, preserving the search term in context columns.",
    )
    parser.add_argument("input", nargs="?", default="-", help="CSV/JSON file or '-' for stdin")
    parser.add_argument("--max-len", type=int, default=DEFAULT_MAX_LEN)
    parser.add_argument("--case-insensitive", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print JSON diff preview only")
    parser.add_argument(
        "--columns",
        nargs="*",
        default=["SOURCE_CONTEXT", "TARGET_CONTEXT", "SOURCE_TEXT", "TARGET_TEXT", "DOCUMENT", "TARGET_TEXT_EDITED"],
    )
    args = parser.parse_args()

    rows = _read_rows(args.input)
    changed = 0
    preview = []

    for row in rows:
        new_row = dict(row)
        for col in args.columns:
            if col not in row or row[col] is None:
                continue
            term = None
            if col == "SOURCE_CONTEXT":
                term = row.get("SOURCE_TEXT")
            elif col == "TARGET_CONTEXT":
                term = row.get("TARGET_TEXT")
            elif col in ("SOURCE_TEXT", "TARGET_TEXT"):
                term = row[col]

            result = truncate_preserving_term(
                row[col],
                term,
                args.max_len,
                case_insensitive=args.case_insensitive,
            )
            if result.value != row[col]:
                changed += 1
                preview.append(
                    {
                        "id": row.get("ID") or row.get("id"),
                        "column": col,
                        "strategy": result.strategy,
                        "before_len": len(row[col]),
                        "after_len": len(result.value),
                        "before": row[col],
                        "after": result.value,
                    }
                )
            new_row[col] = result.value

        if not args.dry_run:
            print(json.dumps(new_row, ensure_ascii=False))

    if args.dry_run:
        print(json.dumps({"changed_fields": changed, "preview": preview}, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
