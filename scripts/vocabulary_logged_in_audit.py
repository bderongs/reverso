#!/usr/bin/env python3
"""Quick logged-in vocabulary flow audit using saved browser profile."""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

PROFILE = Path(__file__).resolve().parents[1] / ".browser-profile" / "reverso"
OUT = Path(__file__).resolve().parents[1] / "reports" / "vocabulary_logged_in_audit.json"


def clean_stale_locks(profile: Path) -> None:
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        path = profile / name
        if path.exists() or path.is_symlink():
            path.unlink(missing_ok=True)


def dismiss_overlays(page) -> None:
    page.keyboard.press("Escape")
    for label in ("Continue without agreeing", "Close"):
        try:
            page.get_by_role("button", name=label).click(timeout=1500)
        except Exception:
            pass


def audit() -> dict:
    findings: dict = {"logged_in": False, "steps": []}

    with sync_playwright() as p:
        clean_stale_locks(PROFILE)
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        # Favorites hub
        page.goto("https://context.reverso.net/vocabulary/favorites", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        dismiss_overlays(page)
        body = page.inner_text("body")
        findings["logged_in"] = "You should be logged in" not in body
        findings["steps"].append(
            {
                "url": page.url,
                "title": page.title(),
                "has_start_practice": "Start Practice" in body,
                "has_learning_strategy": "Learning strategy" in body,
                "has_login_gate": "You should be logged in" in body,
                "sample_text": body[:500],
            }
        )

        # Animals list — Learn this list
        page.goto("https://context.reverso.net/vocabulary/261044", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        dismiss_overlays(page)
        learn_step = {"action": "Learn this list", "clicked": False}
        try:
            learn = page.get_by_role("button", name="Learn this list").first
            learn.click(timeout=8000)
            learn_step["clicked"] = True
            page.wait_for_timeout(3000)
        except Exception as exc:
            learn_step["error"] = str(exc)
        learn_step["url_after"] = page.url
        learn_step["title_after"] = page.title()
        learn_step["body_snippet"] = page.inner_text("body")[:600]
        findings["steps"].append(learn_step)

        # Star on list term
        page.goto("https://context.reverso.net/vocabulary/261044", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        dismiss_overlays(page)
        star_step = {"action": "star on sparrow term"}
        try:
            page.get_by_role("button", name="sparrow").first.click(timeout=5000)
            page.wait_for_timeout(1000)
            star_step["after_click_snippet"] = page.inner_text("body")[:500]
        except Exception as exc:
            star_step["error"] = str(exc)
        findings["steps"].append(star_step)

        # Context — Add to list
        page.goto("https://context.reverso.net/translation/english-french/sparrow", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        dismiss_overlays(page)
        add_step = {"action": "Add to list (sparrow)"}
        try:
            page.get_by_role("button", name="Add to list").click(timeout=5000)
            page.wait_for_timeout(2000)
            modal_text = ""
            try:
                modal_text = page.locator("[role=dialog], .modal, .popup").first.inner_text(timeout=3000)
            except Exception:
                modal_text = page.inner_text("body")[:800]
            add_step["modal_or_page"] = modal_text[:800]
            add_step["is_signup_modal"] = "Sign up" in modal_text or "Continue with Google" in modal_text
            add_step["has_list_picker"] = "list" in modal_text.lower() and "Sign up" not in modal_text
        except Exception as exc:
            add_step["error"] = str(exc)
        findings["steps"].append(add_step)

        context.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(findings, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(findings, indent=2, ensure_ascii=False))
    return findings


if __name__ == "__main__":
    audit()
