# Practice talking — dev plan

Incremental features on top of the existing Practice talking flow (`Favorites/practice-talking.html`, `/practice-talk/*` in `server.js`).

**Current baseline:** list pick → hold-to-talk STT → chat → TTS; vocab chips; term highlighting in bubbles.

---

## Recommended build order

| Order | Feature | Why first |
|------:|---------|-----------|
| **1** | **#1 Scenario generation** | Unlocks roleplay; everything else hangs on a selected scenario |
| **2** | **#2 Use scenarios in conversation** | Replace/extend system prompt; same chat loop |
| **3** | **#4 User guidance** | Extends chat JSON schema (suggested words + hints) per agent turn |
| **4** | **#3 User scoring** | Mostly client metrics after each user turn; easiest once turns are stable |

**Start here:** implement **#1** end-to-end (generate → persist for session → pick UI → “Start with this scenario”), then wire **#2** so picking a scenario actually changes the agent.

---

## #1 — Scenario generation

### Goal
From the loaded vocabulary list, generate **5 credible scenarios** and suggest them before the conversation starts.

### Each scenario must include
| Field | Content |
|-------|---------|
| **Title** | Short, concrete situation name |
| **Goal** | What the learner is trying to achieve in the scene |
| **Persona** | Person the user talks to: **name**, **role**, **personality**, **tone** (and any extras that help roleplay) |

### Behaviour
1. User loads a list (existing auth/list flow).
2. Call LLM to generate 5 scenarios grounded in list themes / terms (not generic templates).
3. **Save** scenarios for the session (at minimum in-memory / `sessionStorage`; optional later: favourites API or localStorage keyed by `listId`).
4. **Suggest** them in the UI (cards): title, goal, persona one-liner; user picks one (or regenerate).

### Suggested API
- `POST /practice-talk/scenarios`
  - Body: `{ vocabulary, practiceLang, sourceLang, listName? }`
  - Response: `{ scenarios: [{ id, title, goal, persona: { name, role, personality, tone } }] }`
  - Structured JSON (schema) like existing `/practice-talk/chat`.

### UI sketch
- After “Start” (or between list select and first speech): **Scenario picker** with 5 cards + “Generate new set”.
- Confirm → enter conversation with that scenario attached to state.

### Acceptance
- [x] 5 scenarios returned for a non-empty list
- [x] Each has title, goal, persona (name, role, personality, tone)
- [x] Scenarios visible and selectable before talking
- [x] Regenerating replaces the set for the session

### Status
**Done** — `POST /practice-talk/scenarios`, picker UI, `sessionStorage` cache per list, begin flow. Scenarios also include **beats** (vocab topic hooks) reused live in chat.

### Conversation beats (hybrid)
- At generation: each scenario gets 5–6 beats `{ subject, askAbout, targetWords }` tied to exact SOURCE list spellings.
- Live: chat picks remaining unused beats and requires the AI question to invite answers using those words (prefer still-unused terms).
- Cache key: `practice-talk.scenarios.v3:` (regenerate scenarios after deploy).

---

## #2 — Use scenarios in conversation

### Goal
Once a scenario is selected, the chat LLM stays in character and on theme, while still weaving list vocabulary naturally.

### Prompt intent (adapt freely; keep priorities)
```
You are roleplaying as {{persona.name}}, {{persona.role}}, in the scenario: {{title}}.
Personality: {{persona.personality}}. Tone: {{persona.tone}}. Stay in character for the full session.

Priority order (higher wins on conflict):
1. The conversation should flow naturally and realistically — never sound like a vocabulary drill.
2. Weave in 1–2 of the target terms per message only where they fit naturally; never force one.
3. Advance toward the scenario objective ({{goal}}).
4. If the user goes off-topic, bring them back subtly and realistically.
```

Also keep: short replies, practice language = list target language, JSON schema for the reply.

### Behaviour
- Pass `scenario` into `/practice-talk/chat` (or bake a scenario-specific system prompt server-side).
- Opening turn: agent greets / opens the scene in character (existing `chatTurn(null)`).
- Ending conversation clears scenario selection (or keep for “retry same scenario”).

### Acceptance
- [x] Selected persona name/role drives opening and later turns
- [x] Agent does not lecture vocabulary; stays on scenario goal
- [x] Off-topic user turns get a gentle redirect
- [x] Vocab still gently used; chips / inline links still work

### Status
**Done** — `/practice-talk/chat` consumes `scenario` and roleplays with priority rules; opening turn starts in character; bubble label shows persona name. Requires server restart to take effect.

---

## #3 — User scoring

### Goal
Give a **motivational target** so the user knows they’ve “talked enough” — updated **after each user turn**.

### Advice: use **two scores** (recommended)
One combined number hides *why* they’re progressing. Two clear meters teach the intended behaviour:

| Score | Measures | Motivation |
|-------|----------|------------|
| **Talk time / volume** | Speaking effort | Cumulative user utterance length (chars or estimated seconds from recording duration) and/or turn count |
| **Vocabulary use** | List coverage | Distinct list terms (src or trg) detected in user speech this session |

**Session “done” when both thresholds are met** (e.g. talk bar ≥ 100% **and** vocab bar ≥ 100%), with a single celebratory “You’ve talked enough” state — not two unrelated win screens.

Optional later: one composite `overall = 0.5 * talk + 0.5 * vocab` for a badge, but **UI should still show both**.

### Suggested targets (tunable)
- **Talk:** e.g. 5 user turns **or** ~90s recorded speech **or** ~400 characters spoken (pick one primary; show progress).
- **Vocab:** e.g. **8 distinct** list terms used by the user (cap at `min(8, listSize)`).

### Behaviour
- Update after each successful user transcript (post-STT, when bubble is added).
- Persist only for the active session unless we later save history.
- Do not punish the agent’s word use into the user’s vocab score (user-only).

### UI sketch
- Compact dual progress in the talk controls or header: “Speaking” + “Words used”, with target labels.
- Soft celebration when both complete (toast / status); conversation can continue.

### Acceptance
- [x] Both scores update after each user turn
- [x] Targets visible and reachable on a normal short session
- [x] Clear “enough practice” signal when both hit 100%

### Status
**Done** — dual client-side meters: Speaking (400 chars) + Words used (min(8, list size)); banner + run pill when both complete. Conversation can continue.

---

## #4 — User guidance

### Goal
After each **agent** reply, help the learner answer: plausible next words + optional full-answer hints.

### After each LLM answer, return
1. **Suggested words** — short list of plausible list terms the user could incorporate next (grounded in unused / scenario-relevant vocab).
2. **Hint button** — on click, show **2 full answer suggestions**, each using **at least one** of those words; written so the user can read them aloud.

### Suggested chat schema extension
```json
{
  "reply": "...",
  "usedTerms": ["..."],
  "suggestedWords": ["...", "..."],
  "hintAnswers": ["...", "..."]
}
```
- `hintAnswers` can be generated always (hidden until Hint) or only when Hint is pressed (second LLM call — cheaper if hints are rare). **Prefer include in same turn** for snappy UX on a demo; gate display behind the button.

### UI sketch
- Below agent bubble or above mic: chip row of suggested words (tappable → maybe insert into hint banner).
- **Hint** button → expands two readable sample answers in practice language.

### Acceptance
- [x] Every agent turn exposes suggested words in the UI
- [x] Hint reveals exactly two full answers, each using ≥1 suggested word
- [x] Guidance does not block hold-to-talk

### Status
**Done** — chat schema returns `suggestedWords` + `hintAnswers`; UI shows “Try using” chips and a Hint toggle. Requires server restart.

---

## Technical notes (shared)

- Reuse `MISTRAL_API_KEY` + chat completions with JSON schema (same pattern as `/practice-talk/chat`).
- Keep STT/TTS as batch endpoints unless realtime is a later project.
- Scenario + guidance prompts must stay in **practice (list SOURCE) language** for spoken content; meta UI can stay English for this demo.
- State shape sketch:
  ```js
  state.scenarios = []
  state.scenario = null  // selected
  state.scores = { talk: 0, talkTarget, vocab: 0, vocabTarget }
  state.lastGuidance = { suggestedWords: [], hintAnswers: [] }
  ```

---

## Out of scope (for now)

- Realtime STT/TTS WebSockets
- Persisting scenarios/scores to Reverso favourites backend
- Multiplayer / shared scenarios
- Changing hold-to-talk interaction model

---

## Implementation checklist

1. [x] `#1` scenarios API + picker UI + session save  
2. [x] `#2` pass scenario into chat system prompt + verify roleplay  
3. [x] `#4` extend chat JSON + suggested words UI + Hint button  
4. [x] `#3` dual scores + targets + “talked enough” state  
5. [ ] Polish: regenerate scenarios, retry same scenario, empty-list edge cases  
