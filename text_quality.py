import csv
import json
import os
import random
import requests
from bs4 import BeautifulSoup
try:
    from openai import OpenAI
    OPENAI_SDK_V1 = True
except ImportError:
    import openai
    OPENAI_SDK_V1 = False


def load_env_file(path: str, override: bool = False) -> None:
    if not os.path.exists(path):
        return

    with open(path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and (override or key not in os.environ):
                os.environ[key] = value


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_env_file(os.path.join(SCRIPT_DIR, ".env"), override=True)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
client = OpenAI() if OPENAI_SDK_V1 else None
if not OPENAI_SDK_V1:
    openai.api_key = os.getenv("OPENAI_API_KEY")

INPUT_CSV = "/Users/baptiste/Downloads/Privé et partagé 2/All Texts V2 34231386182680e4a4e9f4644d64a338_all.csv"
OUTPUT_CSV = "article_ratings.csv"
# Set to an integer (e.g. 20) to process only first N texts.
# Set to None to process the whole file.
MAX_TEXTS = 20
# Processing order for CSV rows: "asc", "desc", or "rand".
PROCESS_ORDER = "asc"
DEBUG_OPENAI = True
MAX_ARTICLE_CHARS = 5000


def mask_secret(value: str | None) -> str:
    if not value:
        return "(missing)"
    if len(value) <= 10:
        return "***"
    return f"{value[:6]}...{value[-4:]}"


def fetch_article_html(url: str) -> str:
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    return response.text


def extract_article_content(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one(".reading-list__content") or soup.find("article") or soup.body

    # Highlights are stored in <b> inside .reading-list__content.
    # Convert them to <em> so the evaluator sees a single highlight tag type.
    for bold_tag in article.find_all("b"):
        bold_tag.name = "em"

    # Keep only simple structure and normalized <em> highlights.
    for tag in article.find_all(True):
        if tag.name not in ["em", "p", "br"]:
            tag.unwrap()
        else:
            tag.attrs = {}

    return str(article)


def build_prompt(article_html: str, target_level: str) -> str:
    return f"""
You are an English teacher. your are evaluating an English-learning article for language learners.

The target level of your students is : {target_level}

You want to identify if the article is good for your students.

Definition of a good article:
A good article is level-consistent, has useful and well-chosen highlights, keeps a learner reading without feeling dull, and feels original rather than generic.

Evaluate the article on the following criteria.

1. Level fit
Does the article fit the target CEFR level?
Assess the whole text, not isolated sentences.
If CEFR demand is uneven (frequent jumps too easy/too hard), level_fit should usually not exceed 3.
- 5 = very well suited to the target CEFR level
- 4 = mostly suited, with small issues
- 3 = understandable but somewhat too easy or too hard
- 2 = clearly too easy or too hard in several places
- 1 = unsuitable for the target level

2. Highlight selection
Are the highlighted words or phrases well chosen for learning?
If highlighted tags are missing or not visible, return highlight_selection as an empty string "".
When highlights are missing, do not penalize level_fit, engagement, or freshness.
- 5 = highlighted <em> words/phrases are well chosen
- 4 = mostly good highlights, with a few weak or missed choices
- 3 = mixed: some good highlights, but several are too basic, too hard, irrelevant, or missing
- 2 = many highlights are poorly chosen
- 1 = highlights are mostly unhelpful or missing

3. Engagement
Evaluate how likely your language learner is to want to continue reading the article.

Consider:
- narrative pull: is there a situation, problem, event, or progression?
- human connection: are there people, emotions, choices, or relatable experiences?
- practical relevance: does the text help with a real-life situation learners may care about?
- curiosity or surprise: does it create interest beyond vocabulary practice?
- pacing: does the text move forward, or is it mostly static description?

Important:
Engagement should not be rated high only because the article is useful or practical.
High engagement does not require novel-like tension. It can come from relatable real-life context, concrete situations, clear progression, or vivid practical urgency.
A practical checklist, safety guide, or advice article can score high only if it also has a concrete human situation, narrative progression, emotional stakes, curiosity, tension, a memorable example, or a strong reader-facing problem that creates urgency.
If the article is mainly procedural advice with predictable steps, the maximum engagement score should usually be 3, even if the advice is useful.

Scoring:
5 = very engaging; strong curiosity, emotion, practical urgency, or narrative momentum
4 = engaging; clear story, relatable situation, practical usefulness, or interesting angle
3 = moderately engaging; readable and useful, but learners may continue mainly for vocabulary
2 = low engagement; polished but static, generic, abstract, or not very motivating
1 = not engaging; dull, repetitive, artificial, confusing, or unlikely to hold attention

4. Freshness
Evaluate whether the article feels original, specific, and non-generic compared with typical language-learning content.

Freshness is NOT the same as engagement.
- Engagement asks whether a learner wants to keep reading.
- Freshness asks whether the article avoids feeling predictable, generic, cliche, or template-like.

Consider:
- Does the article have a specific angle rather than a generic overview?
- Are there vivid details that feel intentionally chosen?
- Is the situation, example, or takeaway at least slightly unexpected?
- Does the article feel like real content adapted for learners, rather than text artificially written around vocabulary?
- Does it avoid obvious textbook-style situations, cliches, and filler sentences?

Important:
Freshness should not be rated high only because the article is clear, useful, or well organized.
If the article follows a standard advice format or gives predictable information for the topic, its freshness score should usually be 2 or 3.
To score 4 or 5, the article needs a distinctive angle, unusual scenario, vivid specific details, surprising example, or memorable takeaway that makes it feel different from standard learner content.

Scoring:
5 = very fresh; original, specific, memorable, and clearly above standard learner content
4 = fresh; contains specific or unexpected elements, though the structure may still be familiar
3 = moderately fresh; acceptable and clear, but the situation or ideas are fairly familiar
2 = not very fresh; generic, predictable, or formulaic despite being correct/useful
1 = not fresh at all; obvious filler, cliche, repetitive, or clearly written only to include target vocabulary

Return only valid JSON in this format:

{{
  "scores": {{
    "level_fit": 1,
    "highlight_selection": "",
    "engagement": 1,
    "freshness": 1
  }},
  "engagement_reason": "",
  "freshness_reason": "",
  "strengths": [],
  "issues": []
}}

Output constraints:
- "engagement_reason" and "freshness_reason" must be one short sentence each.
- Keep "strengths" and "issues" concise (max 3 items each, short phrases).
- "highlight_selection" must be either an integer 1-5 or an empty string "" when highlights are missing/not visible.

Article HTML:
{article_html}
""".strip()


def rate_article(article_html: str, target_level: str) -> dict:
    if len(article_html) > MAX_ARTICLE_CHARS:
        article_html = article_html[:MAX_ARTICLE_CHARS]

    prompt = build_prompt(article_html, target_level)
    api_key = os.getenv("OPENAI_API_KEY")
    if DEBUG_OPENAI:
        print("\n[OPENAI DEBUG] sdk:", "v1" if OPENAI_SDK_V1 else "legacy")
        print("[OPENAI DEBUG] model:", OPENAI_MODEL)
        print("[OPENAI DEBUG] api key:", mask_secret(api_key))
        print("[OPENAI DEBUG] article chars:", len(article_html))
        print("[OPENAI DEBUG] prompt chars:", len(prompt))
        print("[OPENAI DEBUG] prompt preview:", prompt[:500].replace("\n", " "))

    try:
        if OPENAI_SDK_V1:
            response = client.responses.create(
                model=OPENAI_MODEL,
                input=prompt,
            )
            content = response.output_text
            if DEBUG_OPENAI:
                print("[OPENAI DEBUG] raw response:", response)
        else:
            response = openai.ChatCompletion.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            content = response["choices"][0]["message"]["content"]
            if DEBUG_OPENAI:
                print("[OPENAI DEBUG] raw response:", response)
    except Exception as e:
        if DEBUG_OPENAI:
            print("[OPENAI DEBUG] request failed:", repr(e))
        raise

    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.startswith("json"):
            content = content[4:].strip()
    if DEBUG_OPENAI:
        print("[OPENAI DEBUG] parsed content preview:", content[:500])
    result = json.loads(content)
    scores = result.get("scores", {})

    for key in ("level_fit", "engagement", "freshness"):
        value = scores.get(key)
        if not isinstance(value, int) or not (1 <= value <= 5):
            raise ValueError(f"Invalid score for '{key}': {value!r}")

    highlight_selection = scores.get("highlight_selection")
    if isinstance(highlight_selection, int):
        if not (1 <= highlight_selection <= 5):
            raise ValueError(
                f"Invalid score for 'highlight_selection': {highlight_selection!r}"
            )
    elif highlight_selection != "":
        raise ValueError(
            "Invalid value for 'highlight_selection': expected 1-5 or empty string."
        )

    for key in ("engagement_reason", "freshness_reason"):
        value = result.get(key, "")
        result[key] = str(value).strip()

    result["strengths"] = [str(x).strip() for x in result.get("strengths", [])][:3]
    result["issues"] = [str(x).strip() for x in result.get("issues", [])][:3]

    return result


def pick_first(row: dict, *keys: str, default: str = "") -> str:
    for key in keys:
        value = row.get(key)
        if value and value.strip():
            return value.strip()
    return default


def get_article_input(row: dict) -> tuple[str, str]:
    url = pick_first(row, "url", "URL", "Reader URL")
    if url:
        html = fetch_article_html(url)
        return url, extract_article_content(html)

    # Fallback for CSVs that store plain text directly.
    text = pick_first(
        row,
        "Preview",
        "Text",
        "en-GB_transcription",
        "en-US_transcription",
        "Title",
    )
    if not text:
        raise ValueError("No usable content found: expected a URL or text column.")

    return "", f"<article><p>{text}</p></article>"


def main():
    rows = []
    input_csv = os.getenv("INPUT_CSV", INPUT_CSV)
    output_csv = os.getenv("OUTPUT_CSV", OUTPUT_CSV)
    max_texts = MAX_TEXTS
    process_order = os.getenv("PROCESS_ORDER", PROCESS_ORDER).strip().lower()
    processed_rows = 0

    with open(input_csv, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        source_rows = list(reader)

        if process_order == "desc":
            source_rows.reverse()
        elif process_order == "rand":
            random.shuffle(source_rows)
        elif process_order != "asc":
            raise ValueError(
                f"Invalid PROCESS_ORDER '{process_order}'. Use 'asc', 'desc', or 'rand'."
            )

        for row in source_rows:
            reader_url = pick_first(row, "Reader URL")
            if not reader_url:
                continue

            target_level = pick_first(row, "target_level", "Level")
            if not target_level:
                continue

            if max_texts is not None and processed_rows >= max_texts:
                break
            processed_rows += 1

            url = pick_first(row, "url", "URL", "Reader URL")
            category = pick_first(row, "category", "Type", default="general")
            title = pick_first(row, "Title", "\ufeffTitle")

            try:
                effective_url, article_html = get_article_input(row)
                result = rate_article(article_html, target_level)

                scores = result["scores"]

                rows.append({
                    "url": effective_url or url,
                    "title": title,
                    "target_level": target_level,
                    "category": category,
                    "level_fit": scores["level_fit"],
                    "highlight_selection": scores["highlight_selection"],
                    "engagement": scores["engagement"],
                    "freshness": scores["freshness"],
                    "engagement_reason": result.get("engagement_reason", ""),
                    "freshness_reason": result.get("freshness_reason", ""),
                    "strengths": " | ".join(result.get("strengths", [])),
                    "issues": " | ".join(result.get("issues", [])),
                    "error": "",
                })

            except Exception as e:
                rows.append({
                    "url": url,
                    "title": title,
                    "target_level": target_level,
                    "category": category,
                    "level_fit": "",
                    "highlight_selection": "",
                    "engagement": "",
                    "freshness": "",
                    "engagement_reason": "",
                    "freshness_reason": "",
                    "strengths": "",
                    "issues": "",
                    "error": str(e),
                })

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "url",
            "title",
            "target_level",
            "category",
            "level_fit",
            "highlight_selection",
            "engagement",
            "freshness",
            "engagement_reason",
            "freshness_reason",
            "strengths",
            "issues",
            "error",
        ]

        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()