# SRS full specs (readable transcript)

Source: `Documents/DOC - SRS Full Specs 30b3138618268059a37ec54b1b7bfacc.pdf` (pages 16–30).

This is a plain-text transcription of that document: selection mix, Learn DB updates, timers, exclusions, and extra rules. Field names are written as they appear in the spec (`Memorized`, `LastStatus`, `SRScounter`, `TimesSeen`, …). API payloads may use camelCase (`memorized`, `lastStatus`, `srsCounter`, `timesSeen`).

Goal stated in the spec: too many flashcard components update Learn DB differently. One clear, consistent behaviour.

---

## 1. What spaced repetition is

Reviews are spread over **increasing intervals**. Remembering a word after a break strengthens memory.

| Review | Time after learning |
|---|---|
| 1st | 1 day later |
| 2nd | 3 days later |
| 3rd | 7 days later |
| 4th | 14 days later |
| 5th | Memorized |

---

## 2. SRS Manager API

The API does three things:

1. Fill Learn DB with enough terms to play, if it is not already populated.
2. Suggest **X terms** for one game (default example: **7**).
3. Update Learn DB for those terms from the user’s answers (correct / false).

### Input (3 parameters)

1. **Direction** — e.g. `en → fr`, `en → en`, `ar`.
2. **List to study** — `All` · `History` · `Favorites` · a particular list.
3. **Learning strategy** — `New` · `Mixed` · `SRS`.
4. **Nb of terms to review** — e.g. 7, 10, 15. *(The PDF lists this as a fourth user setting; the “3 parameters” box on the previous page is incomplete.)*

### Output

1. The best X terms to learn for the chosen strategy.
2. After play: Learn DB updated from the user’s actions and answers.

---

## 3. List progress stats (lists only)

Shown when the user is learning **a list**, not History or Favorites. Display: **E/F learned** and **G mastered**.

| Letter | Meaning | Rule | API field (favourites `?listId=…`) |
|---|---|---|---|
| E | Terms seen from the list, excluding ignored | `NbView ≠ 0` and `isIgnored = False` | `learningStatus.inProgressCards` |
| F | All terms from the list, excluding ignored | all list terms minus `isIgnored = True` | `learningStatus.totalCards` |
| G | Mastered terms from the list, excluding ignored | `isMemorized = True` and `isIgnored = False` | `memorizedOnceCards` |

C / D on that page are “Today” stats (C = same as Today, D = daily goal), not used for list progress.

---

## 4. Learning strategies (how to fill a game)

Always **insert mistakes first**, then fill remaining slots.

### SRS

“Reinforce what you’ve learned before moving on to new cards with spaced repetition.”

After mistakes, remaining slots:

| Share | Bucket | Order |
|---|---|---|
| 25% | New terms | most recently added |
| 50% | Fresh review | past due **≤ 30 days** |
| 25% | Old review | past due **> 30 days** |

Also follow the priority table in §5.

### NEW

“Study cards you haven’t learned yet, starting with the most recently added.”

- **100% new terms.**
- **Web:** most recent first.
- **Mobile:** most recent by default; user may choose *start from oldest* or *random*.
- If there are not enough terms, switch (the PDF row is cut off; MIXED’s fallback is “switch to SRS”).

### MIXED (default)

“A mix of new cards and cards to review.”

After mistakes, remaining slots:

| Share | Bucket | Order |
|---|---|---|
| 40% | New terms | most recently added |
| 50% | Fresh review | past due **≤ 30 days** |
| 10% | Old review | past due **> 30 days** |

Extra MIXED rules:

- If **not enough terms to review**, switch to **SRS**.
- If the user has **≥ 3 new terms**, play a mini-game of new cards.
- If the user has **< 3 new terms**, switch to **SRS**.
- For a standard 7-card game: **3 new + 4 SRS** (same idea as 40% new).

---

## 5. Term selection priorities

Used especially in SRS (and as fallback). Higher rows first. Tags say which sources apply: Favorites, History, List.

| Prio | Source | Name | Who | How to pick |
|---|---|---|---|---|
| 1 | Learn DB | Not yet due | Fav / Hist / List | `Memorized = False`, `LastStatus = True`, timer **not done**. Closest expiry first (due in 1 day before due in 3 days). Used when nothing else is due. |
| 1 | Learn DB | Old overdue | Fav / Hist / List | `Memorized = False`, `LastStatus = True`, timer done **> 30 days ago**. Most overdue first (47 days late before 31). |
| 1 | Favorites | New terms in selected list | Fav / Hist / List | Most recently **created**. |
| 1 | Learn DB | Fresh overdue | Fav / Hist / List | `Memorized = False`, `LastStatus = True`, timer done **≤ 30 days ago**. Longest overdue first (3 days late before 1). |
| 1 | Learn DB | Wrong terms (mistakes) | Fav / Hist / List | `Memorized = False`, `LastStatus = False`. |
| 2 | Discover | Words to discover / suggestions | History, and only if user chose **All** | Random Word / Expression of the Day. Must **not** already be in Favorites or History. API call to add them. |
| 2 | History DB | New terms from History | History, only if **All** or **History** | API to attach an example. Fetch **3 translations** and **6 examples** from Context. Source example **max 250 characters**. |
| 3 | Learn DB | Mastered terms | Fav / Hist / List | `Memorized = True`. Last resort (see §9). |
| 3 | Favorites | New reversed terms | Fav / Hist / List | If direction is e.g. `en → fr` and the user has **no** terms that way, take `fr → en` and reverse into Learn DB. Swap source/target and source/target examples. **Do not reverse** a term marked `ignored` in Learn DB. |
| 4 | History DB | Reversed terms from History | History, only if **All** or **History** | Same reverse idea; API to add an example. |

Populate Learn DB until the game has enough **available** cards (example: 7). Available = timer done and not mastered. If Learn DB only has 2 available, add 5 new terms from Favourites / History (newest first).

---

## 6. SRS timer

Depends on `LastStatus` and `SRScounter`.

| Condition | Timer |
|---|---|
| `LastStatus = False` | **0** (due now) |
| `LastStatus = True`, counter **0** | *(not specified on that page)* |
| `LastStatus = True`, counter **1** | 1 day |
| `LastStatus = True`, counter **2** | 3 days |
| `LastStatus = True`, counter **3** | 7 days |
| `LastStatus = True`, counter **4** | 14 days |
| Counter **5** | Mastered |

Worked example after one flashcard game:

| Term | Before | Answer | After SRS | LastStatus | Timer |
|---|---|---|---|---|---|
| apron | 3/5, due | Know | 4/5 | Correct | 14 days |
| colander | 2/5, due | Don’t know | 2/5 in the example* | Wrong | 0s |
| whisk | 5/5 mastered | Know | 5/5 | Correct | Memorized long term |
| punch / spike | 0/5 new | Know | 1/5 | Correct | 1 day |
| laugh / split / hunch | 0/5 new | Don’t know | 0/5 | Wrong | 0s |

\*The example leaves colander at 2/5. The **update table in §8** says Don’t know always does `SRScounter − 1` (floored at 0). Treat §8 as the field-level rule; the example is the interval illustration.

Next session example in the spec: 4 terms with timer = 0, need 3 more. If there are no new terms, take the timers **closest to finishing**.

---

## 7. Terms that must not enter Learn DB

1. Source length **< 3** or **> 24** characters.
2. History terms marked **Rude**.
3. History terms with **No results**.
4. History with a **Smart Suggestion**: take the suggestion only.
5. Type **Synonyms**.
6. Type **MT**.

Also: never reverse a term that is `ignored` in Learn DB.

---

## 8. Duplicate source/target

| Case | What to do |
|---|---|
| Same **Source + Target** already in Learn DB | Do **not** create a new row. Append a second example to `examples`. |
| Same **Source**, different **Target** | Create a new Learn DB row. Set `isExcludedfromQuiz = True` so it does not appear in games. |

---

## 9. Not enough cards (edge cases)

If fewer than 7 terms have timer done:

1. Still launch the game with fewer than 7.
2. If 1–6 remain, return those only.
3. If 0 remain, the user should still be able to learn a list.

Named quiz-launch scenarios:

| Scenario | Behaviour |
|---|---|
| 1. All terms’ timers are not ready | Take the **smallest remaining timer** and let the user play. |
| 2. All terms are Mastered | Reset SRS progress to **0**, offer them again, **keep `Memorized = True`**. |
| 3. Not enough available terms | First not-ready timers, then Mastered. |
| No compatible terms left | Error + user pop-up. |

**Never study Mastered before finishing all learning terms.** If 70 terms are learning but not yet due, show the closest next due date — not Mastered.

---

## 10. What to show on the card

| Use case | Label |
|---|---|
| `Mastered = True` | Mastered (green check) |
| `Nb view = 0` | NEW (purple) |
| `Nb view ≠ 0` and `LastStatus = True` | Progress X/5 (pie) |
| `Nb view ≠ 0` and `LastStatus = False` | Failed last time (orange repeat) |

---

## 11. Updating Learn DB after a game (canonical field rules)

Almost every action: **`TimesSeen + 1`** and refresh **`LastSeen`**.

| Action | Card state | LastStatus | SRScounter | isMemorized |
|---|---|---|---|---|
| Don’t know | counter 0–3, not memorized | False | **−1** | unchanged (False) |
| Know | counter 0–3, not memorized | True | **+1** | unchanged (False) |
| Don’t know | counter **4**, not memorized | False | **−1** | unchanged (False) |
| Know | counter **4**, not memorized | True | set to **0** | **True** (mastered) |
| Any | already `isMemorized = True` | same as Know / Don’t know above | same as above | **stays True** even after a wrong answer |

Desired mastery: the user should see the card **5 times** (5 successful Know steps), not “2 Know on the last iteration”.

---

## 12. When each game writes (and intended exceptions)

| Game | When it writes | Intended SRS behaviour |
|---|---|---|
| SRS flashcard | End of game, after **3 rounds** only. Nothing during play. | Full table in §11. Want mastery after 5 Knows, not 2. |
| Quiz — multiple choice | Each tap on an answer | Full §11 table (“classic 5-stage SRS”). |
| Quiz — flashcard + multiple choice | Each tap on an answer | Full §11 table. |
| Speak | 1st correct → partial; 2nd correct → memorized | Cards with 2 correct answers across phases are marked memorized. |
| Autoplay | Each swipe | **`TimesSeen + 1`**, update `LastSeenDate` / `NbViews`. **Do not change `SRSCounter`.** (Today it still +1 SRS; that is the old behaviour to stop.) |
| View all cards | Each swipe | `TimesSeen + 1`, `LastSeenDate` / `NbViews`, `LastStatus` True/False. **Do not change `SRSCounter`.** |
| Word to discover | Any button | “Already know” → Memorized. “Should learn” → Learning. |
| *(unnamed row)* | — | Term is added to favorites. |

The tester’s quiz endpoints (`GET /user/learn/cards/quiz` + `POST .../quiz/update`) are the **Quiz** rows: full SRS updates on each answer / submit.

---

## 13. Additional rules (why the mix exists)

| Rule | Meaning | Typical user |
|---|---|---|
| **21 cards before repeating** | In SRS mode, do not start repeating `LastStatus = True` terms until the user has **21** cards from the list in Learn DB. Stops “same 7 cards three weeks in a row” for weekly players. | One quiz per week |
| **30 days rule** | Very overdue cards are deprioritized: a **small percentage** of the game, not the majority. Matches the 10% / 25% “old review” slots. | Month of inactivity |
| **NEW strategy** | “Not started” tab → new terms only. Also the way to finish a huge list or cram without repeats. | Big list / exam |
| **Never Mastered before Learning** | If learning cards exist, even if not due, prefer closest due learning card. Never Mastered first. | 30 mastered + 70 learning |
| **MIXED as default** | History / big Favourites: **40% new**. Standard launch: **3 new + 4 SRS**. | Chill learners stuck on reviews |
| **SHUFFLE** | Pick among cards available for a given **calendar day**, then shuffle. Ignore seconds/minutes/hours so 3 sets in one session are not the identical 7. | Routine learner, 3 sets/session |

Other study-scenario mappings in the PDF:

- Chill learner who never reaches new content → NEW + MIXED default.
- Big list / exam cram → NEW.
- After inactivity, old cards crowding the queue → 30 days rule.

---

## 14. Worked refill example (Favourites + History + Learn)

Initial Favourites (newest first): punch (Dec 2), spike (Nov 3), laugh→rire (Oct 2), laugh→smile (Jul 1).

Initial History: split (Dec 1), hunch (Nov 2), dream (Oct 1), just (Jul 6).

Initial Learn DB:

- apron 3/5 — available, timer done
- colander 2/5 — available, timer done
- whisk 5/5 — mastered, **not** available

Need 7 available cards → add 5 new from those sources (punch, spike, laugh/rire, split, hunch in the example). Then play and apply §11.

---

## 15. Quick glossary

| Spec name | Meaning |
|---|---|
| Learn DB | Cards already in the learning system (`learnCard` / `LEARN_CARDS`) |
| New | Not learned yet (`Nb view = 0` / not started) |
| Mistake / wrong term | `Memorized = False` and `LastStatus = False` |
| Fresh review | Correct last time, timer expired **≤ 30 days ago** |
| Old review | Correct last time, timer expired **> 30 days ago** |
| Not yet due | Correct last time, timer still running |
| Mastered | `Memorized` / `isMemorized = True` (SRS stage 5) |
| LastStatus True / False | Know / Don’t know on the last attempt |
| SRScounter | Stage 0–4 while learning; 5 or `Memorized` when done |
| Nb view / TimesSeen | How many times the card was shown |
| isExcludedfromQuiz | Same source, different target — stored but not drawn |
