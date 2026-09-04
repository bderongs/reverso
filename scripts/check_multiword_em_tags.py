#!/usr/bin/env python3
"""Find multi-word expressions inside <em> tags in All Texts V2.

A multi-word expression is any <em>...</em> span whose text contains
two or more whitespace-separated tokens (e.g. "come across",
"make it crystal clear"). Hyphenated single tokens like "data-driven"
are treated as one word.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEXTS_DIR = ROOT / "All Texts V2"
DEFAULT_REPORT = ROOT / "reports" / "multiword_em_tags.json"

EM_TAG = re.compile(r"<em>([^<]*)</em>", re.IGNORECASE)
TEXT_SECTION = re.compile(r"^## Text\s*$", re.MULTILINE)
NEXT_SECTION = re.compile(r"^## ", re.MULTILINE)


@dataclass
class MultiwordOccurrence:
    file: str
    title: str
    line: int
    expression: str
    word_count: int
    snippet: str


def extract_text_section(content: str) -> tuple[str, int]:
    match = TEXT_SECTION.search(content)
    if not match:
        return "", 0

    start = match.end()
    rest = content[start:]
    next_match = NEXT_SECTION.search(rest)
    body = rest[: next_match.start()] if next_match else rest
    line_offset = content[: match.start()].count("\n") + 1
    return body.strip("\n"), line_offset


def title_from_file(path: Path, content: str) -> str:
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def word_count(text: str) -> int:
    return len(text.split())


def find_occurrences(path: Path, texts_dir: Path) -> list[MultiwordOccurrence]:
    content = path.read_text(encoding="utf-8")
    text_body, line_offset = extract_text_section(content)
    if not text_body:
        return []

    rel_path = str(path.relative_to(texts_dir))
    title = title_from_file(path, content)
    occurrences: list[MultiwordOccurrence] = []

    for match in EM_TAG.finditer(text_body):
        expression = match.group(1).strip()
        n_words = word_count(expression)
        if n_words < 2:
            continue

        line_in_body = text_body[: match.start()].count("\n")
        line = line_offset + line_in_body + 1

        line_start = text_body.rfind("\n", 0, match.start()) + 1
        line_end = text_body.find("\n", match.end())
        if line_end == -1:
            line_end = len(text_body)
        snippet = text_body[line_start:line_end].strip()

        occurrences.append(
            MultiwordOccurrence(
                file=rel_path,
                title=title,
                line=line,
                expression=expression,
                word_count=n_words,
                snippet=snippet,
            )
        )

    return occurrences


def scan_directory(texts_dir: Path) -> list[MultiwordOccurrence]:
    occurrences: list[MultiwordOccurrence] = []
    for path in sorted(texts_dir.glob("*.md")):
        occurrences.extend(find_occurrences(path, texts_dir))
    return occurrences


def unique_expressions(occurrences: list[MultiwordOccurrence]) -> list[dict]:
    by_expr: dict[str, list[MultiwordOccurrence]] = defaultdict(list)
    for occ in occurrences:
        by_expr[occ.expression.lower()].append(occ)

    result = []
    for key in sorted(by_expr):
        items = by_expr[key]
        # Prefer the first-seen casing as display form.
        display = items[0].expression
        result.append(
            {
                "expression": display,
                "word_count": items[0].word_count,
                "occurrence_count": len(items),
                "files": sorted({i.file for i in items}),
            }
        )
    return result


def print_report(occurrences: list[MultiwordOccurrence], texts_dir: Path) -> None:
    unique = unique_expressions(occurrences)
    files = {occ.file for occ in occurrences}
    by_length: dict[int, int] = defaultdict(int)
    for item in unique:
        by_length[item["word_count"]] += 1

    print(f"Scanned: {texts_dir}")
    print(f"Files with multi-word <em> expressions: {len(files)}")
    print(f"Total multi-word occurrences: {len(occurrences)}")
    print(f"Unique multi-word expressions: {len(unique)}")
    if by_length:
        print(
            "Unique by word count:",
            ", ".join(f"{n}-word: {c}" for n, c in sorted(by_length.items())),
        )
    print()

    if not unique:
        print("No multi-word <em> expressions found.")
        return

    print("## Unique expressions")
    for item in unique:
        files_note = f" ({item['occurrence_count']}×)" if item["occurrence_count"] > 1 else ""
        print(f'  [{item["word_count"]}w] "{item["expression"]}"{files_note}')
    print()

    print("## Occurrences by file")
    current_file = ""
    for occ in occurrences:
        if occ.file != current_file:
            current_file = occ.file
            print(f"\n### {occ.title}")
            print(f"    {occ.file}")
        print(f'    L{occ.line} ({occ.word_count}w): "{occ.expression}"')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_TEXTS_DIR,
        help=f"Directory of text markdown files (default: {DEFAULT_TEXTS_DIR.name})",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"Path to write JSON report (default: {DEFAULT_REPORT})",
    )
    parser.add_argument(
        "--unique-only",
        action="store_true",
        help="Print only the unique expression list (no per-file occurrences)",
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit with code 1 when multi-word expressions are found",
    )
    args = parser.parse_args()

    if not args.dir.is_dir():
        print(f"Directory not found: {args.dir}", file=sys.stderr)
        return 2

    occurrences = scan_directory(args.dir)
    unique = unique_expressions(occurrences)

    if args.unique_only:
        print(f"Unique multi-word expressions: {len(unique)}\n")
        for item in unique:
            print(item["expression"])
    else:
        print_report(occurrences, args.dir)

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "texts_dir": str(args.dir),
            "files_with_multiword": len({o.file for o in occurrences}),
            "total_occurrences": len(occurrences),
            "unique_count": len(unique),
            "unique_expressions": unique,
            "occurrences": [asdict(o) for o in occurrences],
        }
        args.json.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"\nJSON report written to {args.json}")

    if args.fail_on_findings and occurrences:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
