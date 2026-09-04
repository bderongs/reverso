#!/usr/bin/env python3
"""Find adjacent <em> vocabulary tags in All Texts V2 markdown files.

Adjacent tags (only whitespace between </em> and <em>) can look like one
continuous highlighted expression and cause UX issues in the Reader.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEXTS_DIR = ROOT / "All Texts V2"
DEFAULT_REPORT = ROOT / "reports" / "adjacent_em_tags.json"

# Two or more <em>...</em> blocks separated only by whitespace.
ADJACENT_EM_CHAIN = re.compile(
    r"(?:<em>(?P<term>[^<]*)</em>\s+)+<em>(?P<last_term>[^<]*)</em>",
    re.IGNORECASE,
)

TEXT_SECTION = re.compile(r"^## Text\s*$", re.MULTILINE)
NEXT_SECTION = re.compile(r"^## ", re.MULTILINE)


@dataclass
class AdjacentEmIssue:
    file: str
    title: str
    line: int
    chain_length: int
    terms: list[str]
    snippet: str


def extract_text_section(content: str) -> tuple[str, int]:
    """Return the ## Text body and the 1-based line where it starts."""
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


def find_issues(path: Path, texts_dir: Path) -> list[AdjacentEmIssue]:
    content = path.read_text(encoding="utf-8")
    text_body, line_offset = extract_text_section(content)
    if not text_body:
        return []

    rel_path = str(path.relative_to(texts_dir))
    title = title_from_file(path, content)
    issues: list[AdjacentEmIssue] = []

    for match in ADJACENT_EM_CHAIN.finditer(text_body):
        chain = match.group(0)
        terms = re.findall(r"<em>([^<]*)</em>", chain, flags=re.IGNORECASE)
        if len(terms) < 2:
            continue

        line_in_body = text_body[: match.start()].count("\n")
        line = line_offset + line_in_body + 1

        line_start = text_body.rfind("\n", 0, match.start()) + 1
        line_end = text_body.find("\n", match.end())
        if line_end == -1:
            line_end = len(text_body)
        snippet = text_body[line_start:line_end].strip()

        issues.append(
            AdjacentEmIssue(
                file=rel_path,
                title=title,
                line=line,
                chain_length=len(terms),
                terms=terms,
                snippet=snippet,
            )
        )

    return issues


def scan_directory(texts_dir: Path) -> list[AdjacentEmIssue]:
    issues: list[AdjacentEmIssue] = []
    for path in sorted(texts_dir.glob("*.md")):
        issues.extend(find_issues(path, texts_dir))
    return issues


def print_report(issues: list[AdjacentEmIssue], texts_dir: Path) -> None:
    files = {issue.file for issue in issues}
    chains_by_length: dict[int, int] = {}
    for issue in issues:
        chains_by_length[issue.chain_length] = chains_by_length.get(issue.chain_length, 0) + 1

    print(f"Scanned: {texts_dir}")
    print(f"Files with adjacent <em> chains: {len(files)}")
    print(f"Total adjacent chains found: {len(issues)}")
    if chains_by_length:
        print("Chains by length:", ", ".join(f"{n}-tag: {c}" for n, c in sorted(chains_by_length.items())))
    print()

    if not issues:
        print("No adjacent <em> tags found.")
        return

    current_file = ""
    for issue in issues:
        if issue.file != current_file:
            current_file = issue.file
            print(f"## {issue.title}")
            print(f"   {issue.file}")
        terms = " + ".join(f'"{t.strip()}"' for t in issue.terms)
        print(f"   L{issue.line} ({issue.chain_length} tags): {terms}")
        print(f"      {issue.snippet}")
        print()


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
        default=None,
        help="Optional path to write JSON report",
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit with code 1 when issues are found (useful in CI)",
    )
    args = parser.parse_args()

    if not args.dir.is_dir():
        print(f"Directory not found: {args.dir}", file=sys.stderr)
        return 2

    issues = scan_directory(args.dir)
    print_report(issues, args.dir)

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "texts_dir": str(args.dir),
            "files_with_issues": len({i.file for i in issues}),
            "total_chains": len(issues),
            "issues": [asdict(i) for i in issues],
        }
        args.json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"JSON report written to {args.json}")

    if args.fail_on_findings and issues:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
