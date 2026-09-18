# Start a new Android quiz vs SRS comparison

Follow this top to bottom every time you start a run.  
Repo root: `/Users/baptiste/reverso`

**One rule:** phone and web export must be the **same Reverso account**. Export Favourites **before** Maestro. Do **not** tap web “Play games” in between (it mutates Learn DB).

---

## Every new run (copy this order)

### 1. Archive the previous Maestro run

Keeps the last `latest.json` / scores from being overwritten or mixed.

```bash
cd /Users/baptiste/reverso
node .maestro/scripts/archive-last-run.js --label my-label
```

Use any short label (`account-a`, `en-fr-test`, …).  
Creates: `.maestro/quiz-runs/archive/<timestamp>-my-label/`

If there is nothing to archive, the script says so — that is fine.

---

### 2. Same account on phone + web

| Where | What |
|-------|------|
| Emulator / phone | Log into Reverso with the account you want to test |
| Browser | SRS game tester → that account’s refresh token |

---

### 3. Export Favourites (web) — before any quiz on the phone

```bash
npm start
```

Then in the browser:

1. Open the SRS game tester (`/srs-game-tester`)
2. **Expert mode** on → **Load account** (use **Full reload** if the cache might be stale)
3. **Export corpus**
4. Move the downloaded file into:

```text
Android_testing/
```

Keep the filename as downloaded (e.g. `corpus-<userId>-<timestamp>.json`).  
You can keep several corpora in that folder.

---

### 4. Start the term logger (leave this terminal open)

```bash
cd /Users/baptiste/reverso
node .maestro/scripts/term-logger.js
```

Without this, Maestro still plays the quiz but **does not** write `.maestro/quiz-runs/latest.json` for scoring.

---

### 5. Pick the device and run Maestro (second terminal)

```bash
cd /Users/baptiste/reverso
node .maestro/scripts/list-android-devices.js --turns 5
```

- Lists connected adb devices
- Asks which to use if there are several
- Prints the exact command — **copy and run it**

Example of what it prints:

```bash
maestro test --device emulator-5554 -e TURNS=5 .maestro/favorites-play-quiz.yaml
```

Use that `--device` id (e.g. `emulator-5554`), not the AVD name from `maestro list-devices`.

Boot the emulator first if no device is listed.

---

### 6. Score

```bash
cd /Users/baptiste/reverso
node .maestro/scripts/score-android-quiz.js
```

- Lists every corpus JSON in `Android_testing/`
- Asks which file to use (must match the account you just played)
- Writes:
  - `.maestro/quiz-runs/latest-score.txt` ← read this
  - `.maestro/quiz-runs/latest-score.json`

Or skip the prompt:

```bash
node .maestro/scripts/score-android-quiz.js --corpus Android_testing/corpus-….json
```

---

### 7. Done — before the next run

Either start again at **step 1**, or archive now so the folder stays clean:

```bash
node .maestro/scripts/archive-last-run.js --label my-label
```

Corpus files in `Android_testing/` stay put (safe to keep many).

---

## What you should see after a good run

| Step | Output |
|------|--------|
| Export | `Android_testing/corpus-….json` |
| Maestro + logger | `.maestro/quiz-runs/latest.json` (presented terms) |
| Score | `.maestro/quiz-runs/latest-score.txt` |

**Reading the score**

- **Turn 1** = cleanest read (later turns are noisier after answers)
- Soft checks only: term in Favourites? mastered while learning left? not-due while due/new exist?
- Unmatched terms or wrong language pair → bug, wrong corpus, or wrong account on the phone

---

## Same account again vs new account

| Situation | Do this |
|-----------|---------|
| Same account, new Maestro run | Step 1 (archive) → re-export if Learn DB may have changed → 4 → 5 → 6 |
| Different account | Step 1 → log into that account on **phone and web** → export **that** account → 4 → 5 → 6 → pick **that** corpus when scoring |

---

## Do not

- Score with account A’s corpus while the phone played account B  
- Skip the term logger if you want a score  
- Skip archive if you still need the previous `latest.json`  
- Run web **Play games** between export and Maestro  

---

## Quick command strip (after export is in Android_testing/)

```bash
cd /Users/baptiste/reverso
node .maestro/scripts/archive-last-run.js --label prev-run

# terminal A
node .maestro/scripts/term-logger.js

# terminal B
node .maestro/scripts/list-android-devices.js --turns 5
# …then paste/run the printed maestro test command…

node .maestro/scripts/score-android-quiz.js
# open .maestro/quiz-runs/latest-score.txt
```
