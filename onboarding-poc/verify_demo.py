#!/usr/bin/env python3
"""Smoke-test the interactive onboarding demo in a headless browser."""

from pathlib import Path
import http.server
import os
import socket
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "Reverso Chrome Extension _ Free Download.html"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> None:
    port = free_port()
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = f"http://127.0.0.1:{port}/{HTML.name}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(url, wait_until="domcontentloaded")

            demo = page.locator("[data-rvp-demo]")
            demo.wait_for(state="visible", timeout=5000)
            assert demo.count() == 1

            # Auto-demo should reveal a tooltip for the scripted words.
            page.wait_for_selector(".rvp-tip.rvp-visible", timeout=8000)
            terms = page.locator(".rvp-tip-terms").inner_text()
            assert terms, "Tooltip terms should not be empty during auto-demo"

            # After handoff, interactive mode is enabled.
            page.wait_for_selector(".rvp-handoff:not([hidden])", timeout=12000)
            assert page.locator(".rvp-demo.rvp-interactive").count() == 1

            # Manual hover should update tooltip for another word.
            page.locator('.rvp-word[data-word="before"]').hover()
            page.wait_for_timeout(400)
            assert page.locator(".rvp-tip.rvp-visible").count() == 1
            assert "avant" in page.locator(".rvp-tip-terms").inner_text().lower()

            # Other slides still use their static images.
            assert page.locator('img[src*="en(1).gif"]').count() == 1
            assert page.locator('img[src*="en.gif"]').count() == 0

            browser.close()
            print("Verification passed:", url)
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
