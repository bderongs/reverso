#!/usr/bin/env python3
"""Verify vocabulary flows — logged-in session, structured output."""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / ".browser-profile" / "reverso"
OUT = ROOT / "reports" / "vocabulary_flow_verify_logged_in.json"


def clean_locks(profile: Path) -> None:
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        p = profile / name
        if p.exists() or p.is_symlink():
            p.unlink(missing_ok=True)


def dismiss(page) -> None:
    page.keyboard.press("Escape")
    for label in ("Continue without agreeing", "Unlock", "Close"):
        try:
            page.get_by_role("button", name=label).click(timeout=800)
        except Exception:
            pass


def visible_buttons(page) -> list[str]:
    names: list[str] = []
    for el in page.locator("button, a[role=button], [role=link]").all():
        try:
            t = (el.inner_text(timeout=500) or el.get_attribute("aria-label") or "").strip()
            if t and len(t) < 80:
                names.append(t)
        except Exception:
            pass
    return list(dict.fromkeys(names))[:40]


def probe(name: str, page, url: str, actions: list[dict]) -> dict:
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    dismiss(page)
    entry = {"flow": name, "url": page.url, "title": page.title(), "probes": []}
    for act in actions:
        result = {"action": act["label"], "type": act["type"]}
        try:
            if act["type"] == "click_role":
                loc = page.get_by_role(act["role"], name=act["name"])
                if act.get("nth") is not None:
                    loc = loc.nth(act["nth"])
                else:
                    loc = loc.first
                loc.click(timeout=act.get("timeout", 5000), force=act.get("force", False))
            elif act["type"] == "click_text":
                page.locator(act["selector"]).first.click(
                    timeout=act.get("timeout", 5000), force=act.get("force", False)
                )
            page.wait_for_timeout(act.get("wait", 2000))
            result["outcome"] = "clicked"
            result["url_after"] = page.url
            body = page.inner_text("body")
            result["body_signals"] = {
                k: v in body
                for k, v in act.get("signals", {}).items()
            }
            result["snippet"] = body[: act.get("snippet", 400)]
        except Exception as exc:
            result["outcome"] = "failed"
            result["error"] = str(exc)[:350]
            result["snippet"] = page.inner_text("body")[:300]
        entry["probes"].append(result)
    entry["visible_controls"] = visible_buttons(page)
    return entry


def main() -> None:
    clean_locks(PROFILE)
    findings: list[dict] = []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # F1 sparrow
        page.goto("https://context.reverso.net/translation/english-french/sparrow", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        dismiss(page)
        body = page.inner_text("body")
        findings.append(
            {
                "flow": "F1-sparrow",
                "url": page.url,
                "has_animals_chip": "Animals" in body and "Related" in body or page.locator("a:has-text('Animals')").count() > 0,
                "has_discover_section": "Discover and learn" in body,
                "chip_count": page.locator("a.vocabulary-topic-chip, a:has-text('Animals')").count(),
                "visible_controls": visible_buttons(page)[:25],
            }
        )

        # F1 hello
        page.goto("https://context.reverso.net/translation/english-french/hello", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        dismiss(page)
        body = page.inner_text("body")
        findings.append(
            {
                "flow": "F1-hello",
                "url": page.url,
                "has_animals_chip": page.locator("a.vocabulary-topic-chip").count() > 0,
                "has_discover_section": "Discover and learn" in body,
                "chip_count": page.locator("a.vocabulary-topic-chip").count(),
            }
        )

        # F2 add to list hello
        findings.append(
            probe(
                "F2-hello-save",
                page,
                "https://context.reverso.net/translation/english-french/hello",
                [
                    {
                        "label": "Add to list",
                        "type": "click_text",
                        "selector": "button:has-text('Add to list')",
                        "force": True,
                        "signals": {
                            "signup": "Continue with Google",
                            "favorites_link": "Favorites",
                            "list_picker": "Create a list",
                        },
                        "snippet": 600,
                    }
                ],
            )
        )

        # F3 index
        page.goto("https://context.reverso.net/vocabulary", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        findings.append(
            {
                "flow": "F3-index",
                "url": page.url,
                "has_get_started": "Get started" in body,
                "has_reading_list": "Reading List" in body,
                "categories": [h for h in ["Business", "TOEFL", "IELTS", "Daily Life", "By Level"] if h in body],
                "visible_controls": visible_buttons(page)[:20],
            }
        )

        # F4 animals list
        findings.append(
            probe(
                "F4-animals",
                page,
                "https://context.reverso.net/vocabulary/261044",
                [
                    {
                        "label": "Learn this list (last button)",
                        "type": "click_role",
                        "role": "button",
                        "name": "Learn this list",
                        "nth": -1,
                        "force": True,
                        "wait": 4000,
                        "signals": {
                            "know": "Know",
                            "dont_know": "Don't know",
                            "flip": "Click to flip",
                            "progress": "Progress",
                        },
                        "snippet": 500,
                    }
                ],
            )
        )

        # F5 favorites
        page.goto("https://context.reverso.net/vocabulary/favorites", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        findings.append(
            {
                "flow": "F5-favorites",
                "url": page.url,
                "login_gate": "You should be logged in" in body,
                "entry_count": "entries" in body.lower(),
                "has_start_practice": "Start Practice" in body,
                "has_filters": all(x in body for x in ["ALL", "LEARNING", "MASTERED"]),
                "has_expand_ai": "Expand with AI" in body,
                "snippet": body[:700],
                "visible_controls": visible_buttons(page)[:25],
            }
        )

        ctx.close()

    OUT.write_text(json.dumps(findings, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(findings, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
