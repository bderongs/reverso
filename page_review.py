#!/usr/bin/env python3
"""LLM-driven Reverso page review using browser-use + Playwright."""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import yaml
from browser_use import Agent, BrowserProfile, BrowserSession, ChatOpenAI

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = SCRIPT_DIR / "page_review_config.yaml"
DEFAULT_PROMPT = SCRIPT_DIR / "prompts" / "page_review_system.md"
REPORTS_DIR = SCRIPT_DIR / "reports"
_run_log_file: object | None = None


@contextmanager
def run_logging(log_path: Path):
    """Send browser-use logs and script messages to a per-run log file."""
    global _run_log_file
    from browser_use.logging_config import setup_logging

    log_path.parent.mkdir(parents=True, exist_ok=True)
    setup_logging(info_log_file=str(log_path), force_setup=True)
    _run_log_file = log_path.open("a", encoding="utf-8")
    _run_log_file.write(f"Run started {datetime.now().isoformat()}\n")
    _run_log_file.flush()
    try:
        yield log_path
    finally:
        _run_log_file.write(f"Run ended {datetime.now().isoformat()}\n")
        _run_log_file.close()
        _run_log_file = None


def run_log(message: str = "") -> None:
    print(message)
    if _run_log_file is not None:
        _run_log_file.write(message + "\n")
        _run_log_file.flush()


def make_run_paths() -> tuple[Path, Path]:
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    return (
        REPORTS_DIR / f"page_review_{stamp}.md",
        REPORTS_DIR / f"page_review_{stamp}.log",
    )


def load_env_file(path: Path, override: bool = False) -> None:
    if not path.exists():
        return

    with path.open(encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and (override or key not in os.environ):
                os.environ[key] = value


load_env_file(SCRIPT_DIR / ".env", override=True)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Stop the agent when it appears stuck (repeated failures / same action / same page).
STUCK_MAX_FAILURE_EVALS = 3
STUCK_MAX_ACTION_REPEATS = 4
STUCK_MAX_STAGNANT_PAGES = 4
STUCK_MAX_SAME_GOAL = 3


@dataclass
class PageResult:
    page_id: str
    goal: str
    visited_url: str | None
    review: str
    screenshot: str | None
    error: str | None = None


def load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_system_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def build_task(
    goal: str,
    system_prompt: str,
    *,
    start_url: str,
    is_first: bool,
    max_steps: int = 30,
) -> str:
    if is_first:
        entry = f"You should already be on {start_url} with cookies dismissed."
    else:
        entry = "Continue from your current browser tab."

    return f"""{system_prompt}

---
{entry}

Your goal for this session:
{goal.strip()}

Achieve this goal by browsing as the persona above, then write your review. You have at most {max_steps} browser actions.

If you are blocked (sign-up modal, same click failing), try another approach once, then call done with a partial review rather than repeating the same action.
"""


DISMISS_COOKIES_JS = """() => {
  const patterns = /continue without agreeing|continuer sans accepter|reject all|tout refuser|disagree|refuser/i;
  const candidates = document.querySelectorAll(
    'button, a, span[role="button"], [id*="didomi"], [class*="didomi"]'
  );
  for (const el of candidates) {
    const text = (el.textContent || '').trim();
    if (text.length > 80 || text.length < 5) continue;
    if (patterns.test(text)) {
      el.click();
      return 'clicked:' + text.slice(0, 120);
    }
  }
  if (typeof Didomi !== 'undefined') {
    try {
      if (Didomi.notice && Didomi.notice.isVisible && Didomi.notice.isVisible()) {
        const disagree = document.querySelector('#didomi-notice-disagree-button, .didomi-dismiss-button');
        if (disagree) {
          disagree.click();
          return 'clicked:didomi-button';
        }
      }
    } catch (e) {}
  }
  return 'no-banner';
}"""


DISMISS_MODALS_JS = """() => {
  const signup = /get started|sign up|log in|login|s'inscrire|se connecter|créer un compte/i;
  const dismiss = /close|×|✕|not now|skip|later|no thanks|fermer|ignorer|continuer sans|continue without/i;

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

  const buttons = document.querySelectorAll('button, a, span[role="button"], [aria-label]');
  for (const el of buttons) {
    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
    if (text.length > 80 || text.length < 1) continue;
    if (dismiss.test(text) && !signup.test(text)) {
      el.click();
      return 'dismissed:' + text.slice(0, 80);
    }
  }

  const closeIcon = document.querySelector(
    '[class*="close" i], [class*="dismiss" i], button[aria-label*="close" i], button[aria-label*="fermer" i]'
  );
  if (closeIcon) {
    closeIcon.click();
    return 'dismissed:close-icon';
  }

  return 'no-modal';
}"""


class StuckMonitor:
    """Detect when the agent is looping on failures and should stop."""

    def __init__(
        self,
        *,
        max_failure_evals: int = STUCK_MAX_FAILURE_EVALS,
        max_action_repeats: int = STUCK_MAX_ACTION_REPEATS,
        max_stagnant_pages: int = STUCK_MAX_STAGNANT_PAGES,
        max_same_goal: int = STUCK_MAX_SAME_GOAL,
    ) -> None:
        self.max_failure_evals = max_failure_evals
        self.max_action_repeats = max_action_repeats
        self.max_stagnant_pages = max_stagnant_pages
        self.max_same_goal = max_same_goal
        self.failure_eval_streak = 0
        self.same_goal_streak = 0
        self._last_next_goal = ""
        self.stop_reason: str | None = None

    def update(self, agent: Agent) -> None:
        if self.stop_reason:
            return

        output = agent.state.last_model_output
        if output and output.current_state:
            eval_text = (output.current_state.evaluation_previous_goal or "").lower()
            next_goal = output.current_state.next_goal or ""

            if "verdict: failure" in eval_text or "repeated attempts" in eval_text:
                self.failure_eval_streak += 1
            else:
                self.failure_eval_streak = 0

            if next_goal and next_goal == self._last_next_goal:
                self.same_goal_streak += 1
            else:
                self.same_goal_streak = 0
            self._last_next_goal = next_goal

        loop = agent.state.loop_detector
        if loop.max_repetition_count >= self.max_action_repeats:
            self.stop_reason = (
                f"Stopped: repeated the same action {loop.max_repetition_count} times"
            )
        elif loop.consecutive_stagnant_pages >= self.max_stagnant_pages:
            self.stop_reason = (
                f"Stopped: page unchanged for {loop.consecutive_stagnant_pages} steps"
            )
        elif self.failure_eval_streak >= self.max_failure_evals:
            self.stop_reason = (
                f"Stopped: agent reported failure {self.failure_eval_streak} times in a row"
            )
        elif self.same_goal_streak >= self.max_same_goal and self.failure_eval_streak >= 1:
            self.stop_reason = "Stopped: retrying the same goal after repeated failures"

    def should_stop(self) -> bool:
        return self.stop_reason is not None


async def dismiss_blocking_modals(session: BrowserSession) -> str:
    page = await session.get_current_page()
    if not page:
        return "no-page"
    return str(await page.evaluate(DISMISS_MODALS_JS))


async def prepare_reverso_session(session: BrowserSession, start_url: str) -> None:
    """Load Reverso and dismiss Didomi before the LLM agent starts."""
    pages = await session.get_pages()
    if pages:
        page = pages[0]
        await page.goto(start_url)
    else:
        page = await session.new_page(start_url)

    for attempt in range(8):
        await asyncio.sleep(1.5 if attempt == 0 else 2)
        result = str(await page.evaluate(DISMISS_COOKIES_JS))
        if result.startswith("clicked:"):
            run_log(f"  cookies: dismissed ({result[8:][:60]})")
            await asyncio.sleep(1)
            return
        if result == "no-banner" and attempt >= 2:
            run_log("  cookies: no banner detected")
            return

    run_log("  cookies: banner may still be visible — agent will retry")


def extract_visited_url(history) -> str | None:
    urls = [url for url in history.urls() if url]
    return urls[-1] if urls else None


def build_browser_profile(defaults: dict, headless: bool | None) -> BrowserProfile:
    viewport = defaults.get("viewport") or {}
    profile_kwargs = dict(
        headless=defaults.get("headless", True) if headless is None else headless,
        viewport={
            "width": int(viewport.get("width", 1280)),
            "height": int(viewport.get("height", 900)),
        },
        allowed_domains=defaults.get("allowed_domains"),
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
        ),
    )
    user_data_dir = defaults.get("user_data_dir")
    if user_data_dir:
        profile_kwargs["user_data_dir"] = str(SCRIPT_DIR / user_data_dir)
    return BrowserProfile(**profile_kwargs)


async def review_page(
    scenario: dict,
    defaults: dict,
    system_prompt: str,
    session: BrowserSession,
    max_steps: int | None,
    *,
    is_first: bool,
) -> PageResult:
    page_id = scenario["id"]
    goal = scenario.get("goal") or scenario.get("hint") or scenario.get("url", "")
    if not goal:
        return PageResult(
            page_id=page_id,
            goal="",
            visited_url=None,
            review="",
            screenshot=None,
            error="Scenario missing 'goal' (or legacy 'hint' / 'url').",
        )

    start_url = scenario.get("start_url") or defaults.get("start_url", "https://www.reverso.net/")
    steps = max_steps if max_steps is not None else scenario.get("max_steps", defaults.get("max_steps", 30))

    task = build_task(
        goal,
        system_prompt,
        start_url=start_url,
        is_first=is_first,
        max_steps=steps,
    )
    llm = ChatOpenAI(model=OPENAI_MODEL, temperature=0)
    monitor = StuckMonitor()

    async def on_step_end(agent: Agent) -> None:
        monitor.update(agent)
        if monitor.failure_eval_streak >= 1 and not monitor.stop_reason:
            result = await dismiss_blocking_modals(session)
            if result.startswith("dismissed:"):
                run_log(f"  modal: auto-dismissed ({result[10:][:50]})")
                monitor.failure_eval_streak = max(0, monitor.failure_eval_streak - 1)

    async def should_stop() -> bool:
        return monitor.should_stop()

    agent = Agent(
        task=task,
        llm=llm,
        browser_session=session,
        extend_system_message=system_prompt,
        max_failures=2,
        final_response_after_failure=True,
        register_should_stop_callback=should_stop,
    )

    try:
        history = await agent.run(max_steps=steps, on_step_end=on_step_end)
        review = clean_review(history.final_result() or "Agent finished without a written review.")
        screenshot_name = save_screenshot_from_history(history, page_id)
        error = monitor.stop_reason
        if error and not history.final_result():
            review = (
                f"_Agent stopped early: {error}_\n\n"
                "Partial observation: the agent could not complete the goal — "
                "often due to a sign-up modal or a gated list. "
                "Try another list or note the blocker in a manual review."
            )
        return PageResult(
            page_id=page_id,
            goal=goal.strip(),
            visited_url=extract_visited_url(history),
            review=review.strip(),
            screenshot=screenshot_name,
            error=error,
        )
    except Exception as exc:
        return PageResult(
            page_id=page_id,
            goal=goal.strip(),
            visited_url=None,
            review="",
            screenshot=None,
            error=str(exc),
        )


def clean_review(text: str) -> str:
    if "\nAttachments:" in text:
        text = text.split("\nAttachments:", maxsplit=1)[0]
    return text.strip()


def save_screenshot_from_history(history, page_id: str) -> str | None:
    paths = [path for path in history.screenshot_paths(n_last=3) if path]
    if not paths:
        return None

    for src_path in reversed(paths):
        src = Path(src_path)
        if not src.exists():
            continue
        dest = REPORTS_DIR / f"{page_id}.png"
        shutil.copy(src, dest)
        return dest.name
    return None


def write_report(
    results: list[PageResult],
    report_path: Path,
    log_path: Path | None = None,
) -> None:
    lines = [f"# Reverso page review — {date.today().isoformat()}", ""]
    if log_path:
        lines.append(f"**Debug log:** `{log_path.name}`")
        lines.append("")
    for result in results:
        lines.append(f"## {result.page_id}")
        lines.append("")
        lines.append(f"**Goal:** {result.goal}")
        if result.visited_url:
            lines.append(f"**URL visited:** {result.visited_url}")
        lines.append("")
        if result.screenshot:
            lines.append(f"![{result.page_id}]({result.screenshot})")
            lines.append("")
        lines.append("### Review")
        lines.append("")
        if result.error:
            lines.append(f"_Error: {result.error}_")
        else:
            lines.append(result.review)
        lines.append("")
        lines.append("---")
        lines.append("")
    report_path.write_text("\n".join(lines), encoding="utf-8")


async def run_reviews(
    config_path: Path,
    prompt_path: Path,
    page_filter: str | None,
    headless: bool | None,
    max_steps: int | None,
) -> Path:
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is not set. Add it to .env or your environment.")

    config = load_config(config_path)
    defaults = config.get("defaults", {})
    scenarios = config.get("scenarios") or config.get("pages", [])
    if page_filter:
        scenarios = [s for s in scenarios if s.get("id") == page_filter]
        if not scenarios:
            raise SystemExit(f"No scenario with id '{page_filter}' in {config_path}")

    system_prompt = load_system_prompt(prompt_path)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path, log_path = make_run_paths()

    with run_logging(log_path):
        run_log(f"Report: {report_path.name}")
        run_log(f"Config: {config_path}")
        if page_filter:
            run_log(f"Scenario filter: {page_filter}")

        profile = build_browser_profile(defaults, headless)
        session = BrowserSession(browser_profile=profile)
        await session.start()

        start_url = defaults.get("start_url", "https://www.reverso.net/")
        run_log(f"Preparing session at {start_url}...")
        await prepare_reverso_session(session, start_url)

        results: list[PageResult] = []
        try:
            for index, scenario in enumerate(scenarios, start=1):
                goal_preview = (scenario.get("goal") or scenario.get("hint") or "")[:80]
                run_log(f"\n[{index}/{len(scenarios)}] {scenario['id']}: {goal_preview}...")
                result = await review_page(
                    scenario=scenario,
                    defaults=defaults,
                    system_prompt=system_prompt,
                    session=session,
                    max_steps=max_steps,
                    is_first=index == 1,
                )
                if result.error:
                    run_log(f"  stopped: {result.error}")
                else:
                    url_note = f" @ {result.visited_url}" if result.visited_url else ""
                    run_log(f"  done ({len(result.review)} chars){url_note}")
                results.append(result)
        finally:
            await session.close()

        write_report(results, report_path, log_path)
        run_log(f"\nReport written to {report_path}")
        run_log(f"Log written to {log_path}")

    print(f"\nReport: {report_path}")
    print(f"Log:    {log_path}")
    return report_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LLM-driven Reverso page reviews")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="YAML config with scenarios to review",
    )
    parser.add_argument(
        "--prompt",
        type=Path,
        default=DEFAULT_PROMPT,
        help="System prompt / review rubric markdown",
    )
    parser.add_argument("--page", help="Run only the scenario with this id")
    parser.add_argument(
        "--headless",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Override headless browser setting from config",
    )
    parser.add_argument("--max-steps", type=int, default=None, help="Max agent steps per page")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(
            run_reviews(
                config_path=args.config,
                prompt_path=args.prompt,
                page_filter=args.page,
                headless=args.headless,
                max_steps=args.max_steps,
            )
        )
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
