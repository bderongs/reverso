#!/usr/bin/env python3
"""Open Reverso in a full browser window so you can log in with Google.

Fixes stale Chromium profile locks (SingletonLock) that cause immediate SIGTRAP exits.

Usage:
  python3 scripts/login_reverso.py

After logging in, close the browser window. Session is kept in .browser-profile/reverso
(or in reverso-auth.json if you pass --save-storage).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / ".browser-profile" / "reverso"
DEFAULT_URL = "https://context.reverso.net/vocabulary/favorites"


def clean_stale_locks(profile: Path) -> list[str]:
    """Remove Chromium singleton files left when a previous run crashed."""
    removed: list[str] = []
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        path = profile / name
        if path.exists() or path.is_symlink():
            path.unlink(missing_ok=True)
            removed.append(name)
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Open Reverso for Google login")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument(
        "--save-storage",
        type=Path,
        default=None,
        help="Also save cookies/localStorage to this JSON (e.g. reverso-auth.json)",
    )
    parser.add_argument(
        "--channel",
        default="chrome",
        help='Browser: "chrome" = installed Google Chrome (recommended on Mac), "chromium" = Playwright',
    )
    parser.add_argument(
        "--profile",
        type=Path,
        default=PROFILE,
        help="Chromium user-data directory (default: .browser-profile/reverso)",
    )
    args = parser.parse_args()

    profile = args.profile.resolve()
    profile.mkdir(parents=True, exist_ok=True)
    removed = clean_stale_locks(profile)
    if removed:
        print("Cleaned stale profile locks:", ", ".join(removed))

    cmd = [
        sys.executable,
        "-m",
        "playwright",
        "open",
        f"--user-data-dir={profile}",
        f"--channel={args.channel}",
        "--viewport-size=1280,900",
        args.url,
    ]
    if args.save_storage:
        cmd.insert(-1, f"--save-storage={args.save_storage.resolve()}")

    print()
    print("Opening browser…")
    print("  1. Dismiss cookies if needed (Continue without agreeing)")
    print("  2. Click Log in → Continue with Google")
    print("  3. Confirm Favorites loads (not the login wall)")
    print("  4. Close the browser window when done")
    print()
    print("Command:", " ".join(cmd))
    print()

    try:
        subprocess.run(cmd, check=False)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
