# Queue crowding: mastered cards shown before unfinished learning

Synthesis of the Sep 2026 analysis. The question was: **are people reviewing cards they already mastered while they still have other cards to learn?**

This is **not** the “Already know in 1 view” shortcut (that is C19). This is about **selection order after some cards are already mastered**.

---

## What should happen

SRS is meant to finish learning before it spends slots on mastered reviews.

From the spec (`Documents/SRS-full-specs.md`):

| Rule | Intent |
|---|---|
| **Never Mastered before Learning** | If learning cards exist — even if not due — prefer the closest due **learning** card. Never pull Mastered first. Typical case: 30 mastered + 70 still learning. |
| **21 cards before repeating** | In SRS mode, do not start repeating `LastStatus = True` terms until the user has **21** cards from the list in Learn DB. Stops “same 7 cards three weeks in a row”. |
| **30 days rule** | Very overdue cards are a **small share** of the game (the 10% / 25% old-review slots), not the majority. |
| **MIXED default** | Standard launch: **3 new + 4 SRS**. History / big Favourites: 40% new. |

Mastery itself: SRS 0→4 (five successful Knows), then `MEMORIZED = true` and SRS resets to 0. Showing a mastered card again is allowed **once the learning queue is empty**. It is a problem if unfinished cards (SRS 0–3) are still sitting there.

---

## How to spot it in `LEARN_CARDS`

`TIMES_SEEN > 5` is **not** the signal. A clean first mastery is already ~5 views (that is the mode on mastered cards). Extra views are mistakes *or* later reviews, mixed together.

What actually means “shown again after mastery”:

| Signal | Meaning |
|---|---|
| `MEMORIZED = true` and `LAST_STATUS` is `CORRECT` or `INCORRECT` | Last event was a **review**, not the mastery tap |
| `MEMORIZED = true` and `SRS_COUNTER > 0` | Card **re-entered the ladder** after the post-mastery reset to 0 |
| `LAST_STATUS = MEMORIZED` | Last event **was** mastery — do not treat as crowding |

The useful product filter is the other half: the user **still has learning cards**. Showing mastered cards is fine if that queue is empty.

---

## KPI we kept (C18)

**C18 — Learning system anomalies (queue crowding, 30d)**  
Dashboard: [46 — C. Actions & Anomalies](https://metabaseapp.reverso.net/dashboard/46-management-dashboard-c-actions-anomalies)  
Question: [762](https://metabaseapp.reverso.net/question/762)

Count of distinct users who meet **both**:

1. **Post-mastery review in the last 30 days**  
   `MEMORIZED = true`, `TIMES_SEEN > 0`, `LAST_SEEN_DATE` in the window, and (`LAST_STATUS` is `CORRECT`/`INCORRECT` **or** `SRS_COUNTER > 0`).

2. **Learning backlog remains**  
   ≥1 non-mastered `CLASSIFICATION = DEFAULT` card with `SRS_COUNTER` between 0 and 3. Unseen leftovers count. No `>20` card-count filter. No `TARGET_LIST` split.

Window is Metabase “last 30 days” (excludes today). This is **not** C17 (users who mastered a word).

Value when saved (8 Sep 2026): **4,864 users**.

---

## Variants we tried and dropped

Around the same window, **~36.3K active learners**, **~4.9K** with a post-mastery review.

| Variant | Users | Why we dropped it |
|---|---:|---|
| Post-mastery review only | ~4,890 | Includes people whose learning queue is empty — allowed |
| Review + learning card unseen **> 30 days** (“starved”) | ~4,397 (12% of active learners) | Almost every reviewer already has old unfinished cards. Starve does not separate a sharper group. |
| Review + **>20** SRS 0–3 cards | ~4,411 | Same people. ~90% of reviewers already have that backlog. Half of all active learners have >20 SRS < 4 cards. |
| Same, practiced only (`TIMES_SEEN > 0` on the backlog) | ~4,381 | No material change |

`>20` does not bite. A threshold that actually shrinks the set would need to be much higher, or a per-list / “starved while mastered was shown” session-level check we cannot do cleanly on current columns.

Shipped C18 therefore uses **any** unfinished DEFAULT card (SRS 0–3), not starve and not `>20`.

---

## Caveats

- **Leftovers inflate the number.** Most people who review a mastered card still have *some* SRS < 4 card from an old session. C18 is a **quality / selection signal**, not proof that every one of the 4.8K users is stuck in a broken session right now.
- **`TARGET_LIST` is a false friend** for “which list they were studying.” Computing at user level can flag someone who finished list A and is reviewing it, while list B sits untouched. A per-list KPI would be tighter if a reliable “current list” existed.
- **Do not mix with C19.** C19 counts cards mastered in **fewer than 4 views** (Already know / Word to discover). That is a write-path shortcut. C18 is a **draw-path** issue: mastered cards taking slots that learning cards should have.

---

## How to read it

If C18 is high and stable, the mix is still serving **mastered reviews ahead of unfinished learning**, against **Never Mastered before Learning**.

If C18 falls toward 0, either selection improved, or people simply no longer have a backlog — check C17 / active learners alongside it.

Related: C17 = users who mastered a word (30d). C19 = cards mastered in < 4 views (should be 0).
