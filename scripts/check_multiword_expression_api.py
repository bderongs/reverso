#!/usr/bin/env python3
"""Check that multi-word <em> expressions return Context/CPS results.

Mirrors the Reader/extension TranslateSegment call used for smart suggestions:
  GET /Api/TranslateSegment?direction=en-fr&source=<expression>&word=<clicked word>

An expression "has results" when the API returns success and at least one
source that matches the expression with a real translation (not empty/"...").

Auth:
  export REVERSO_BEARER_TOKEN='...'   # or pass --token
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEXTS_DIR = ROOT / "All Texts V2"
DEFAULT_REPORT = ROOT / "reports" / "multiword_expression_api_check.json"
DEFAULT_PROGRESS = ROOT / "reports" / "multiword_expression_api_progress.json"
DEFAULT_EXPRESSIONS_JSON = ROOT / "reports" / "multiword_em_tags.json"

EM_TAG = re.compile(r"<em>([^<]*)</em>", re.IGNORECASE)
TEXT_SECTION = re.compile(r"^## Text\s*$", re.MULTILINE)
NEXT_SECTION = re.compile(r"^## ", re.MULTILINE)

API_URL = "https://cps-api.reverso.net/Api/TranslateSegment"


@dataclass
class CheckResult:
    expression: str
    word: str
    status: str  # ok | no_match | empty | error | http_error
    http_status: int | None
    matched_source: str
    source_count: int
    top_translations: list[str]
    note: str


def extract_text_section(content: str) -> str:
    match = TEXT_SECTION.search(content)
    if not match:
        return ""
    rest = content[match.end()]
    next_match = NEXT_SECTION.search(rest)
    body = rest[: next_match.start()] if next_match else rest
    return body


def load_expressions_from_texts(texts_dir: Path) -> list[str]:
    found: dict[str, str] = {}
    for path in sorted(texts_dir.glob("*.md")):
        body = extract_text_section(path.read_text(encoding="utf-8"))
        for match in EM_TAG.finditer(body):
            expr = match.group(1).strip()
            if len(expr.split()) < 2:
                continue
            key = expr.lower()
            found.setdefault(key, expr)
    return [found[k] for k in sorted(found)]


def load_expressions_from_json(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("unique_expressions") or []
    return [item["expression"] for item in items]


def pick_clicked_word(expression: str) -> str:
    """Prefer the last alphabetic token (same pattern as the long haul example)."""
    tokens = expression.split()
    for token in reversed(tokens):
        cleaned = re.sub(r"^[^\w']+|[^\w']+$", "", token, flags=re.UNICODE)
        if cleaned:
            return cleaned
    return tokens[-1]


def normalize(text: str) -> str:
    text = re.sub(r"\s+", " ", text.lower().strip())
    text = re.sub(r"^[^\w']+|[^\w']+$", "", text, flags=re.UNICODE)
    return text


def normalize_for_match(text: str) -> str:
    """Ignore leading articles so 'a race against time' == 'race against time'."""
    text = normalize(text)
    return re.sub(r"^(a|an|the)\s+", "", text)


def sources_match(expression: str, candidate: str) -> bool:
    return normalize_for_match(expression) == normalize_for_match(candidate)


def call_translate_segment(
    expression: str,
    word: str,
    direction: str,
    token: str,
    timeout: float,
) -> tuple[int, dict]:
    params = urllib.parse.urlencode(
        {"direction": direction, "source": expression, "word": word}
    )
    url = f"{API_URL}?{params}"
    headers = {
        "accept": "application/json",
        "accept-language": "en",
        "origin": "https://www.reverso.net",
        "referer": "https://www.reverso.net/",
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
        ),
        "x-reverso-origin": "reverso.ext.chrome",
    }
    if token:
        headers["authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.load(resp)


def evaluate_payload(expression: str, payload: dict) -> CheckResult:
    word = pick_clicked_word(expression)
    if not payload.get("success"):
        return CheckResult(
            expression=expression,
            word=word,
            status="empty",
            http_status=200,
            matched_source="",
            source_count=0,
            top_translations=[],
            note=f"success=false error={payload.get('error')}",
        )

    wanted = normalize_for_match(expression)
    exact_hit: dict | None = None
    closest: dict | None = None
    for source in payload.get("sources") or []:
        src_raw = str(source.get("source") or "")
        display_raw = str(source.get("displaySource") or "")
        if sources_match(expression, src_raw) or sources_match(expression, display_raw):
            exact_hit = source
            break
        src = normalize_for_match(src_raw)
        if wanted in src or src in wanted:
            if closest is None or len(src) > len(
                normalize_for_match(str(closest.get("source") or ""))
            ):
                closest = source

    best = exact_hit or closest
    if best is None:
        return CheckResult(
            expression=expression,
            word=word,
            status="no_match",
            http_status=200,
            matched_source="",
            source_count=0,
            top_translations=[],
            note="No matching source in response",
        )

    translations = []
    for t in best.get("translations") or []:
        tr = str(t.get("translation") or "").strip()
        if tr and tr != "...":
            translations.append(tr)

    matched_source = str(best.get("displaySource") or best.get("source") or "")
    count = int(best.get("count") or 0)
    exact = exact_hit is not None

    if not translations:
        return CheckResult(
            expression=expression,
            word=word,
            status="empty",
            http_status=200,
            matched_source=matched_source,
            source_count=count,
            top_translations=[],
            note="Matched source but no real translations",
        )

    if not exact:
        return CheckResult(
            expression=expression,
            word=word,
            status="no_match",
            http_status=200,
            matched_source=matched_source,
            source_count=count,
            top_translations=translations[:5],
            note=f"Closest source is {matched_source!r}, not exact",
        )

    return CheckResult(
        expression=expression,
        word=word,
        status="ok",
        http_status=200,
        matched_source=matched_source,
        source_count=count,
        top_translations=translations[:5],
        note="",
    )


def check_one(
    expression: str,
    direction: str,
    token: str,
    timeout: float,
    retries: int,
) -> CheckResult:
    word = pick_clicked_word(expression)
    last_err = ""
    for attempt in range(retries + 1):
        try:
            status, payload = call_translate_segment(
                expression, word, direction, token, timeout
            )
            result = evaluate_payload(expression, payload)
            result.http_status = status
            return result
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                pass
            last_err = f"HTTP {exc.code}: {body}"
            if exc.code in {401, 403}:
                return CheckResult(
                    expression=expression,
                    word=word,
                    status="http_error",
                    http_status=exc.code,
                    matched_source="",
                    source_count=0,
                    top_translations=[],
                    note=last_err,
                )
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
                continue
            return CheckResult(
                expression=expression,
                word=word,
                status="http_error",
                http_status=exc.code,
                matched_source="",
                source_count=0,
                top_translations=[],
                note=last_err,
            )
        except Exception as exc:
            last_err = str(exc)
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
                continue
            return CheckResult(
                expression=expression,
                word=word,
                status="error",
                http_status=None,
                matched_source="",
                source_count=0,
                top_translations=[],
                note=last_err,
            )
    return CheckResult(
        expression=expression,
        word=word,
        status="error",
        http_status=None,
        matched_source="",
        source_count=0,
        top_translations=[],
        note=last_err or "unknown",
    )


def print_summary(results: list[CheckResult]) -> None:
    by_status: dict[str, list[CheckResult]] = {}
    for r in results:
        by_status.setdefault(r.status, []).append(r)

    print(f"Checked: {len(results)}")
    for status in ("ok", "no_match", "empty", "http_error", "error"):
        items = by_status.get(status) or []
        if items:
            print(f"  {status}: {len(items)}")
    print()

    for status in ("no_match", "empty", "http_error", "error"):
        items = by_status.get(status) or []
        if not items:
            continue
        print(f"## {status} ({len(items)})")
        for r in items:
            tops = ", ".join(r.top_translations[:3]) if r.top_translations else "-"
            print(f'  "{r.expression}"  word={r.word!r}  source={r.matched_source!r}  count={r.source_count}')
            print(f"    tops: {tops}")
            if r.note:
                print(f"    note: {r.note}")
        print()


def result_from_dict(data: dict) -> CheckResult:
    return CheckResult(
        expression=data["expression"],
        word=data.get("word", ""),
        status=data.get("status", "error"),
        http_status=data.get("http_status"),
        matched_source=data.get("matched_source", ""),
        source_count=int(data.get("source_count") or 0),
        top_translations=list(data.get("top_translations") or []),
        note=data.get("note", ""),
    )


def load_progress(path: Path) -> dict[str, CheckResult]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, CheckResult] = {}
    for item in data.get("results") or []:
        result = result_from_dict(item)
        # Retry transient failures on resume.
        if result.status in {"http_error", "error"}:
            continue
        out[normalize(result.expression)] = result
    return out


def write_progress(
    path: Path,
    direction: str,
    total: int,
    results_by_key: dict[str, CheckResult],
) -> None:
    results = sorted(
        results_by_key.values(),
        key=lambda r: (r.status != "ok", r.expression.lower()),
    )
    payload = {
        "direction": direction,
        "total": total,
        "checked": len(results),
        "remaining": max(0, total - len(results)),
        "ok": sum(1 for r in results if r.status == "ok"),
        "missing": sum(1 for r in results if r.status != "ok"),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "results": [asdict(r) for r in results],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_final_report(path: Path, direction: str, results: list[CheckResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "direction": direction,
        "checked": len(results),
        "ok": sum(1 for r in results if r.status == "ok"),
        "missing": sum(1 for r in results if r.status != "ok"),
        "results": [asdict(r) for r in results],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_TEXTS_DIR)
    parser.add_argument(
        "--from-json",
        type=Path,
        default=None,
        help=f"Reuse unique list from multiword report (default if present: {DEFAULT_EXPRESSIONS_JSON.name})",
    )
    parser.add_argument("--direction", default="en-fr")
    parser.add_argument(
        "--token",
        default=os.environ.get("REVERSO_BEARER_TOKEN", ""),
        help="Bearer token (or set REVERSO_BEARER_TOKEN)",
    )
    parser.add_argument("--limit", type=int, default=0, help="Only check first N expressions")
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Parallel workers (default 1 = slow/safe)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.6,
        help="Seconds to wait between requests per worker (default 0.6)",
    )
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--json", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--progress",
        type=Path,
        default=DEFAULT_PROGRESS,
        help="Checkpoint file used to resume (default: reports/multiword_expression_api_progress.json)",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore existing progress and start from scratch",
    )
    parser.add_argument(
        "--fail-on-missing",
        action="store_true",
        help="Exit 1 if any expression lacks an exact result",
    )
    args = parser.parse_args()

    if not args.token:
        print(
            "Missing token. Pass --token or set REVERSO_BEARER_TOKEN.",
            file=sys.stderr,
        )
        return 2

    expressions_path = args.from_json
    if expressions_path is None and DEFAULT_EXPRESSIONS_JSON.exists():
        expressions_path = DEFAULT_EXPRESSIONS_JSON

    if expressions_path and expressions_path.exists():
        expressions = load_expressions_from_json(expressions_path)
        print(f"Loaded {len(expressions)} expressions from {expressions_path}")
    else:
        expressions = load_expressions_from_texts(args.dir)
        print(f"Loaded {len(expressions)} expressions from {args.dir}")

    if args.limit > 0:
        expressions = expressions[: args.limit]
        print(f"Limiting to first {len(expressions)}")

    if args.fresh and args.progress.exists():
        args.progress.unlink()
        print(f"Cleared progress file {args.progress}")

    results_by_key = {} if args.fresh else load_progress(args.progress)
    pending = [e for e in expressions if normalize(e) not in results_by_key]
    print(
        f"Progress: {len(results_by_key)} done, {len(pending)} remaining "
        f"(delay={args.delay}s, workers={args.workers})"
    )
    if args.progress:
        print(f"Checkpoint: {args.progress}")

    if not pending:
        results = sorted(
            results_by_key.values(),
            key=lambda r: (r.status != "ok", r.expression.lower()),
        )
        print("Nothing left to check.")
        print_summary(results)
        write_final_report(args.json, args.direction, results)
        print(f"JSON report written to {args.json}")
        return 1 if args.fail_on_missing and any(r.status != "ok" for r in results) else 0

    stop_on_auth = False
    completed_now = 0
    total = len(expressions)

    def handle_result(result: CheckResult) -> None:
        nonlocal completed_now, stop_on_auth
        key = normalize(result.expression)
        results_by_key[key] = result
        completed_now += 1
        done_total = len(results_by_key)
        mark = "OK" if result.status == "ok" else result.status.upper()
        print(
            f"  [{done_total}/{total}] {mark}: {result.expression}",
            flush=True,
        )
        write_progress(args.progress, args.direction, total, results_by_key)
        if result.status == "http_error" and result.http_status in {401, 403}:
            stop_on_auth = True

    if args.workers <= 1:
        for expr in pending:
            if stop_on_auth:
                break
            result = check_one(
                expr, args.direction, args.token, args.timeout, args.retries
            )
            handle_result(result)
            if stop_on_auth:
                print("Stopping: auth error (refresh REVERSO_BEARER_TOKEN and re-run).", flush=True)
                break
            if args.delay > 0:
                time.sleep(args.delay)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {}
            for expr in pending:
                if stop_on_auth:
                    break
                futures[
                    pool.submit(
                        check_one,
                        expr,
                        args.direction,
                        args.token,
                        args.timeout,
                        args.retries,
                    )
                ] = expr
                if args.delay > 0:
                    time.sleep(args.delay / max(1, args.workers))
            for fut in as_completed(futures):
                result = fut.result()
                handle_result(result)
                if stop_on_auth:
                    print(
                        "Stopping: auth error (refresh REVERSO_BEARER_TOKEN and re-run).",
                        flush=True,
                    )
                    break

    results = sorted(
        results_by_key.values(),
        key=lambda r: (r.status != "ok", r.expression.lower()),
    )
    write_progress(args.progress, args.direction, total, results_by_key)
    write_final_report(args.json, args.direction, results)

    print()
    if len(results) < total:
        print(f"Paused/incomplete: {len(results)}/{total} checked. Re-run to resume.")
    print_summary(results)
    print(f"Progress saved to {args.progress}")
    print(f"JSON report written to {args.json}")

    if stop_on_auth:
        return 2
    if args.fail_on_missing and any(r.status != "ok" for r in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
