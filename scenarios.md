# Favorites saving — strategy & scenario spec

> Goal: one source of truth for **what** each client must write to **`FAVOURITES`** when the user saves a favourite — so we can fix bugs, add API validation, and monitor data quality. (History DB is a separate concern.)

---

## 0. Strategy — source of truth, what works, and the `SCENARIO` column

### The core problem today

We try to **reverse-engineer intent** from stored data (`FAVTYPE`, `SOURCE`, which fields are filled). That fails because:

- Several different UI paths produce the **same** `FAVTYPE` (e.g. context star, BilingualCombined, reader → all blank/NULL).
- Several bugs produce **wrong** `FAVTYPE` for a known path (text-translation → empty instead of `mt`).
- `SOURCE` means “device” but is **inconsistent** between `FAVOURITES` and `HISTORY`.
- Devs must read Notion + infer rules — there is no machine-checkable contract.

**Result:** we cannot reliably answer “was this row saved correctly?” from the DB alone.

### What works vs what doesn’t (current DB)

| Works (keep) | Doesn’t work (fix or replace) |
|--------------|-------------------------------|
| Core vocabulary fields (`SOURCE_TEXT`, `TARGET_TEXT`, langs) | Inferring save path from `FAVTYPE` + `SOURCE` |
| `FAVTYPE` as **content type** (context, mt, def, syn) | Using `FAVTYPE` as **scenario identifier** |
| `HISTORY_ID` for provenance (when set) | `HISTORY_ID` optional when history already exists |
| `HASH` for client-side “already favorited?” | `HASH` as long-term identifier (planned removal) |
| `SOURCE` as device/channel (once enum aligned) | Different `SOURCE` enums on Favourites vs History |
| Junction table for lists (`FAVOURITE_ID` + `LIST_ID`) | `COMMENT` overloaded (user note + translations 2–3) |
| Separate Learn tables for SRS | No column saying **which save flow** created the row |

### Source of truth — one stack, three layers

Devs should never ask “is Notion up to date?” The hierarchy is:

```
┌─────────────────────────────────────────────────────────┐
│  1. SCENARIO REGISTRY (git)          ← human + dev SoT  │
│     Favorites/scenarios-registry.yaml                   │
│     - scenario_id, fields, rules, clients, status       │
└──────────────────────────┬──────────────────────────────┘
                           │ generates / validates
┌──────────────────────────▼──────────────────────────────┐
│  2. API CONTRACT                     ← dev implements   │
│     POST /user/favourites { scenario, ...payload }      │
│     JSON Schema per scenario_id                         │
│     400 if scenario unknown or payload invalid          │
└──────────────────────────┬──────────────────────────────┘
                           │ persists
┌──────────────────────────▼──────────────────────────────┐
│  3. DATABASE + MONITORS              ← prod truth check   │
│     FAVOURITES.SCENARIO                               │
│     Metabase: compliance % per scenario per client      │
└─────────────────────────────────────────────────────────┘
```

| Artifact | Role | Who owns it |
|----------|------|-------------|
| **`scenarios-registry.yaml`** | Canonical list of scenarios, required fields, values | Product + backend (PR-reviewed) |
| **API JSON Schema** | Generated from registry; what devs code against | Backend CI |
| **`FAVOURITES` rows** | What actually happened in prod | Monitored against registry |
| **Notion / CSV exports** | Discovery, notes, stakeholder view | Export **from** registry, not the other way |

**Rule for devs:** if it’s not in the registry with `status: active`, you don’t implement it. Every new **favourite save** path gets a scenario first. History-only flows are out of scope here.

### The `SCENARIO` column — recommended design

Add an explicit, **mandatory** scenario identifier. Do not infer it only server-side.

| Aspect | Recommendation |
|--------|----------------|
| **Column** | `SCENARIO` `VARCHAR(64)` on **`FAVOURITES` only** |
| **API** | Required field `scenario` on every create (and sync) request |
| **Format** | Stable slug: `{product}.{surface}.{action}` |
| **Examples** | `ctx.result.example-star`, `mt.text-translation`, `reader.quick-search` |
| **Set by** | Client (declares intent); API **validates** payload matches registry |
| **Distinct from** | `FAVTYPE` = content type; `SOURCE` = device; `SCENARIO` = save flow |

**Why all three?**

| Field | Question it answers |
|-------|---------------------|
| `FAVTYPE` | What **kind** of linguistic content is this? |
| `SOURCE` | Which **device/app** sent it? |
| `SCENARIO` | Which **UI action** produced this row? |

Example: `mt.text-translation` and `mt.context-box` both have `FAVTYPE=mt`, but different `SCENARIO` — so we can spot “wrong page, right type” bugs instantly.

**Request example (web text-translation):**
```json
{
  "scenario": "mt.text-translation",
  "srcText": "...",
  "trgText": "...",
  "srcLang": "en",
  "trgLang": "fr",
  "favType": "mt"
}
```

API logic:
1. Reject if `scenario` missing or unknown.
2. Load schema for `scenario` from registry.
3. Validate required fields and constraints (max length, `historyId` required if scenario says so).
4. Optionally warn if `favType` doesn’t match scenario’s expected `FAVTYPE` (don’t silently fix).
5. Persist `SCENARIO` on the row.

### Scenario registry — how to tame complexity

Don’t try to perfect every scenario before shipping. Use a **registry with lifecycle**:

```yaml
# Favorites/scenarios-registry.yaml (illustrative)
scenarios:
  - id: ctx.result.example-star
    status: active          # draft | active | deprecated
    clients: [web, ios, android]
    source: [0, 1]          # FAVOURITES.SOURCE values
    favtype: null
    histtype: null
  - id: mt.text-translation
    status: active
    clients: [web]
    source: [0]
    favtype: mt
    fields:
      required: [srcText, trgText, srcLang, trgLang, favType]
      constraints:
        srcText: { maxLength: 128 }
```

**Phased rollout**

| Phase | What | Outcome |
|-------|------|---------|
| **1. Catalog** | List all known scenarios in registry (`draft` OK) | Shared vocabulary across teams |
| **2. Instrument** | Add optional `scenario` to API; log + store when present | Measure adoption; find gaps |
| **3. Enforce** | Require `scenario` on new API version; 400 if invalid | New rows are debuggable |
| **4. Monitor** | Metabase dashboard: % rows with `SCENARIO`, compliance per scenario | Detect regressions |
| **5. Deprecate inference** | Stop guessing bugs from `FAVTYPE` alone for new code | Legacy rows tagged `unknown` or backfilled |

Legacy rows without `SCENARIO` stay as-is; monitors exclude them or bucket as `legacy.unknown`.

### Complete scenario catalog

**Scope:** favourite saves only — user taps star (or equivalent) and a row is created in `FAVOURITES`.  
History may be written as a **side effect** of some flows; that is not a separate scenario.  
Out of scope: search-without-star, Learn flashcards, MultiLists assign, offline history.

Naming: `{product}.{surface}.{action}` — platform goes in `SOURCE`, not in the slug.

**Status:** `active` = implement now · `draft` = identified, spec TBD · `internal` = batch/tools only.

#### Context (`ctx.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status | Notes |
|-------------|--------------|---------|----------------|--------|-------|
| `ctx.result.search-bar` | Star on search bar | null | 0, 1 | **active** | Often no context in payload |
| `ctx.result.translation-star` | Star on filtered translation | null | 0, 1 | **active** | May include first-example context |
| `ctx.result.example-star` | Star on a specific example | null | 0, 1 | **active** | Requires `SOURCE_CONTEXT`, `TARGET_CONTEXT` |
| `ctx.result.genai` | Star on GenAI example | ctx-genai | 0, 1 | **active** | Same field contract as context |
| `ctx.bilingual-combined` | Star on BilingualCombined | null | 0, 1 | **active** | `COMMENT` for extra translations |
| `ctx.history.promote` | Star on History page | inherits | 0, 1 | **active** | **`HISTORY_ID` required** |
| `ctx.history.promote-ss` | Star on History + Smart Suggestion | inherits | 2, 3 | draft | Extension reader/chrome |

#### Machine translation (`mt.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status | Notes |
|-------------|--------------|---------|----------------|--------|-------|
| `mt.context-box` | Star on MT box (Context page) | mt | 0, 1 | **active** | `srcText` max 128 chars |
| `mt.text-translation` | Star on /text-translation | mt | 0, 1, 4 | **active** | Known bug: web omits `favType` |

#### Define (`def.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status |
|-------------|--------------|---------|----------------|--------|
| `def.result` | Star on Define results | `def` or `aidef` | 0, 1 | **active** | Same page; `aidef` when AI-generated |

#### Synonyms (`syn.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status |
|-------------|--------------|---------|----------------|--------|
| `syn.result` | Star on Synonyms results | syn | 0, 1 | **active** |

#### Reader & extensions (`reader.*`, `ext.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status | Notes |
|-------------|--------------|---------|----------------|--------|-------|
| `reader.quick-search` | Star while reading/watching | null | 2 | **active** | `SOURCE_SEGMENT`, `DOCUMENT_*` |
| `ext.chrome.quick-search` | Star from Chrome extension | null | 3 | draft | Confirm vs reader flow |

#### Lists (`list.*`)

| scenario_id | UI / trigger | FAVTYPE | Allowed SOURCE | Status | Notes |
|-------------|--------------|---------|----------------|--------|-------|
| `list.editorial-import` | Save term from Reverso list | null or def | 0, 1 | **active** | `ORIGINAL_LIST_ID` required |
| `list.editorial-create` | Internal list creation (Oliver) | null or def | — | internal | Batch, not user UI |

#### Internal

| scenario_id | Purpose | Status |
|-------------|---------|--------|
| `legacy.unknown` | Backfill bucket for pre-migration rows | internal |

---

#### Summary — **16 scenarios** (13 active · 1 draft · 2 internal)

| Group | Active | Draft | Internal |
|-------|--------|-------|----------|
| Context | 6 | 1 | 0 |
| MT | 2 | 0 | 0 |
| Define | 1 | 0 | 0 |
| Synonyms | 1 | 0 | 0 |
| Reader / ext | 1 | 1 | 0 |
| Lists | 1 | 0 | 1 |
| Meta | 0 | 0 | 1 |
| **Total** | **13** | **1** | **2** |

Maps 1:1 to your Notion “Saving scenarios” export, with Context split into search-bar / translation / example.

#### Design rules

1. **One scenario = one favourite save action** (star tap or explicit “save to favourites”).
2. **Split Context result page into 3** — different payloads, same `FAVTYPE`.
3. **`ctx.history.promote`** — favourite only; history row already exists → `HISTORY_ID` required.
4. **Platform in `SOURCE`**, not in scenario slug.
5. **History DB is out of scope** for `SCENARIO`; spec it separately if needed later.

Each active scenario → one JSON Schema + one integration test.

### How a dev knows what to implement

Checklist — no ambiguity:

1. **Find scenario** in `scenarios-registry.yaml` (or ask product to add one).
2. **Read generated schema** for that `scenario_id` (OpenAPI / JSON Schema in repo).
3. **Send `scenario`** in every POST/sync payload.
4. **Map UI fields** using the registry’s `field_mappings` (especially mobile naming).
5. **Run scenario test** — one test file per `scenario_id` per client.
6. **PR checklist:** “Which `scenario_id`? Registry updated? Test added?”

Do **not** rely on: Notion links, copying another client’s payload, or “empty favType means context”.

### DB health — what to monitor once `SCENARIO` exists

| Monitor | Healthy | Unhealthy |
|---------|---------|-----------|
| `SCENARIO IS NULL` on new rows | → 0% after enforce phase | Clients not upgraded |
| `scenario` vs stored `FAVTYPE` | 100% match registry | text-translation-style bugs |
| `scenario` vs `SOURCE` | Client only uses allowed SOURCE for scenario | Wrong device attribution |
| Required fields per scenario | Metabase custom test per scenario | Systematic client gaps |
| `ctx.history.promote` without `HISTORY_ID` | 0% | Provenance bug |

### Relationship to existing fields

| Keep | Role after `SCENARIO` |
|------|------------------------|
| `FAVTYPE` | Content type for product features (flashcards, filters) |
| `SOURCE` | Device analytics (after enum fix) |
| `HISTORY_ID` | Link to history row when scenario requires it |
| `HASH` | Temporary client dedup until replacement designed |
| **`SCENARIO`** | **Primary key for “was this saved correctly?”** |

---

## 1. Problems with the current Notion/CSV format

| Issue | Impact |
|-------|--------|
| Field lists without **values** or **required/optional** | Clients interpret differently → `FAVTYPE` null vs `""`, missing `HISTORY_ID` |
| Notes mix **spec**, **open questions**, and **bug reports** | Hard to know what is normative vs investigative |
| No **client** / **SOURCE** / **API endpoint** column | Cannot trace bugs to a specific implementation |
| No **HASH** definition per scenario | Favorite detection on history pages breaks silently |
| Duplicate **Order** values (MT & Synonyms both = 4) | Ambiguous priority |
| Incomplete rows (`From History with SS` empty) | Gaps in coverage |
| Notion URLs instead of inline field definitions | Not usable in PRs, tests, or API docs |

---

## 2. Recommended document structure

Use **four layers** (can stay in Notion, but export as structured tables — see `Favorites/scenarios-spec.csv` template below).

### Layer A — Enums & invariants (normative)

These are global rules; every scenario must comply.

These are global rules; every scenario must comply.

> **FAVTYPE semantics (field usage per type):** see [`Favorites/favtype details.md`](Favorites/favtype%20details.md).  
> **Save path (which UI action):** scenario registry below. `FAVTYPE` = content type; `SCENARIO` = save flow.

#### `FAVTYPE` (favorites only — `Favourites - Web`)

| DB value | Meaning | Scenarios |
|----------|---------|-----------|
| `NULL` / omitted | Context saved term | All `ctx.*` (except genai), `reader.*`, `list.*` |
| `""` (empty string) | Legacy / vocab-list import | **Do not use** — API coerces to `NULL` for context |
| `ctx-genai` | Context term from GenAI feature | `ctx.result.genai` — **same fields as context** |
| `mt` | Machine translation | `mt.*` |
| `syn` | Synonyms | `syn.result` |
| `def` | Definition | `def.result` |
| `aidef` | AI-generated definition | `def.result` (same star — not a separate scenario) |

**Naming note:** Vocabulary DB doc says `def-genai`; official favtype doc says **`aidef`**. Confirm which string is written to prod and align docs + API.

Max length: **10 chars**.

#### FAVTYPE field contracts (from favtype details)

**Context (`NULL` / `ctx-genai`)**

| Field | Required | Notes |
|-------|----------|-------|
| `srcText` | yes | Term |
| `trgText` | yes | Translation from context |
| `srcLang`, `trgLang` | yes | |
| `srcContext`, `trgContext` | no | Example sentences; optional for search-bar, expected for example-star |
| `srcPos`, `trgPos` | no | |

`ctx-genai` uses the **same contract** as context; example is often AI-generated. Same display rules on vocabulary pages.

**Machine translation (`mt`)**

| Field | Required | Notes |
|-------|----------|-------|
| `srcText`, `trgText`, `srcLang`, `trgLang` | yes | From reverso.net MT |
| | | `srcText` max **128** chars (scenario constraint) |

**Synonyms (`syn`)**

| Field | Required | Notes |
|-------|----------|-------|
| `srcText` | yes | Term |
| `trgText` | yes | Synonym |
| `srcLang`, `trgLang` | yes | **Must be equal** (monolingual) |

Vocabulary API: `includeSyn=YES|NO|ONLY` (default excludes synonyms).

**Definitions (`def` / `aidef`)**

| Field | Required | Notes |
|-------|----------|-------|
| `srcText` | yes | Term |
| `trgText` | yes | Definition text — **`null` not accepted**; use `""` if empty |
| `srcLang`, `trgLang` | yes | **Must be equal** (monolingual) |
| `srcContext` | no | Term example with alignment |
| `trgContext` | — | **Stays empty** |
| `favType` | yes | `def` or `aidef` |

Vocabulary API: `includeDef=YES|NO|ONLY` (default excludes; includes both `def` and `aidef`).

**Soft delete (`REMOVED`)**

Favourites are never hard-deleted; `REMOVED=TRUE` on user delete. API: `includeRemoved=true|false`.

**Mobile `favType` (integer) → DB string** (mapping done by API/sync):

| Mobile | DB `FAVTYPE` |
|--------|--------------|
| `0` | `NULL` (context) |
| `1` | `mt` |
| `2` | *(web search — confirm DB value)* |
| `3` | `ctx-genai` |
| `4` | `def` |
| `5` | `syn` |

**Invariant:** API coerces `""` → `NULL` for Context. Reject saves where content clearly belongs to another type (e.g. long text from MT page without `mt`).

#### `HISTTYPE` (history only — parallel to `FAVTYPE`)

| DB value | Meaning |
|----------|---------|
| `NULL` / blank | Context |
| `syn` | Synonyms |
| `mt` | Machine translation |

Mobile uses integer: `0` = context, `1` = def (API must map to `def` or blank consistently).

#### `SOURCE` (device / client — **different enums for Favourites vs History**)

**`FAVOURITES.SOURCE`** (official doc):

| Value | Client | Prod volume (30d) |
|-------|--------|-------------------|
| `0` | Context web | ~2.35M |
| `1` | Mobile app | ~1.14M |
| `2` | **Reader extension** | ~30k |
| `3` | **Chrome extension** | ~2.5k |
| `4` | Desktop app | ~118k |

**`HISTORY.SOURCE`** (official doc):

| Value | Client |
|-------|--------|
| `0` | Context web |
| `1` | Mobile app |
| `2` | **Chrome extension** |
| `3` | **Reader extension** |
| `4` | Desktop app |
| `5` | Define web |

> **BUG / spec conflict:** values `2` and `3` are **swapped** between `FAVOURITES` and `HISTORY`. Any cross-table join or analytics on `SOURCE` without normalizing will mis-attribute reader vs chrome. **Fix:** align enums or add a `SOURCE_CLIENT` lookup table; until then, always filter by table when interpreting `SOURCE`.

#### `HISTORY_ID` vs `HASH`

| Mechanism | Direction | Purpose |
|-----------|-----------|---------|
| `HISTORY_ID` on favorite | History → Favorite | “This favorite was created from history entry X” — **only** set when saving from History UI |
| `HASH` on both tables | Favorite ↔ History lookup | Client-side dedup / “is this already favorited?” on a history page |

Per official doc: `HASH` is an internal UI identifier, planned for removal. Max **200 chars** (favorites), **2000 chars** (history).

**Invariant:** when saving from an **existing** history entry, `HISTORY_ID` **must** = `HISTORY.ID`. Hash alone is not enough for provenance.

#### Always-on fields (all favorites)

| Field | Tag | Set by | Spec |
|-------|-----|--------|------|
| `ID` | ID | DB | auto |
| `NUSER_ID` | ID | API | from access token |
| `CREATION_DATE` | ID | API | server time; mobile may send `createdAt` on sync |
| `LAST_EDIT` | Editing | API | server time; mobile `modifiedAt` |
| `SOURCE_LANG` | Always | Client | max 10 chars |
| `TARGET_LANG` | Always | Client | max 10 chars |
| `SOURCE_TEXT` | Always | Client | original search; max **2000** chars (MT: enforce **128** on client) |
| `TARGET_TEXT` | Always | Client | filtered translation or first `<em>` highlight; max 2000 chars |
| `FAVTYPE` | Always | Client | see enum; Context = omit / `NULL` |
| `SOURCE` | Always | Client | per `FAVOURITES.SOURCE` enum |
| `HASH` | Other | API | MD5 of canonical payload |
| `REMOVED` | Editing | API | default false; mobile `isRemoved` |
| `WORDCOUNT` | Other | API | derived from `SOURCE_TEXT` |

---

### Layer B — Field catalog (`Favourites - Web`)

Grouped by logical order from official DB doc. Status `NA` = documented but not yet on prod replica (IMAGE, transliteration, ORIGINAL_LIST_ID).

| Order | Field | Tag | Max / spec | Description |
|-------|-------|-----|------------|-------------|
| 1.0 | `ID` | ID | | Favourite ID |
| 1.1 | `NUSER_ID`, `CREATION_DATE` | ID | | Owner + created at |
| 2.1 | `SOURCE_LANG` | Always | 10 chars | |
| 2.2 | `TARGET_LANG` | Always | 10 chars | |
| 2.3 | `SOURCE_TEXT` | Always | 2000 chars | Original search term |
| 2.4 | `TARGET_TEXT` | Always | 2000 chars | Translation (filtered or first highlight) |
| 2.5 | `FAVTYPE` | Always | 10 chars | Origin type (blank = Context) |
| 2.6 | `SOURCE` | Always | | Device enum |
| 3.1 | `SOURCE_CONTEXT` | Example | 2000 chars | Source example sentence |
| 3.2 | `TARGET_CONTEXT` | Example | 2000 chars | Target example sentence |
| 4.1 | `SOURCE_POS` | Optional | 30 chars | Part of speech (source) |
| 4.2 | `TARGET_POS` | Optional | 30 chars | Part of speech (target) |
| 4.3 | `REGISTER` | Optional | | e.g. Informal (editorial lists) |
| 4.4 | `LANGUAGE_LEVEL` | Optional | | CEFR: A1…C2, Rare |
| 4.5 | `COMMENT` | Optional | 2000 chars | User comment **or** 2nd/3rd translation when saving from History |
| 5.1 | `SOURCE_SEGMENT` | Read/Watch | 2000 chars | Sentence containing term (extension) |
| 5.2 | `DOCUMENT_TITLE` | Read/Watch | 200 chars | Page/video title |
| 5.3 | `DOCUMENT` | Read/Watch | 2000 chars | URL where term was saved |
| — | `ORIGINAL_LIST_ID` | | | Editorial list ID (`From a list`) |
| — | `IMAGE`, `SOURCE_TRANSLIT`, `TARGET_TRANSLIT` | | | Define / editorial / context enrichments |
| — | `HISTORY_ID` | Other | | `HISTORY.ID` when saved from History |
| — | `TARGET_TEXT_EDITED` | Editing | 2000 chars | User-edited target |
| — | `DOMAIN` | Other | 200 chars | **Not used** (legacy) |

#### Mobile ↔ Web column mapping (`Favorites - Mobile`)

Critical for debugging sync bugs — **names do not match 1:1**:

| Mobile field | DB column | Notes |
|--------------|-----------|-------|
| `searchText` | `SOURCE_TEXT` | The searched word |
| `serverTargetText` | `TARGET_TEXT` | Server translation; also stores definitions |
| `sourceText` | `SOURCE_CONTEXT` | Example source (not `SOURCE_TEXT`!) |
| `targetText` | `TARGET_CONTEXT` | Example target |
| `favType` (int) | `FAVTYPE` (string) | See mapping table above |
| `sourceLanguage` | `SOURCE_LANG` | |
| `targetLanguage` | `TARGET_LANG` | |
| `createdAt` | `CREATION_DATE` | |
| `modifiedAt` | `LAST_EDIT` | |
| `isRemoved` | `REMOVED` | |
| `serverID` | `ID` | After sync |

#### Related tables (out of scope for save scenarios, but linked)

| Table | Role |
|-------|------|
| `FAVOURITES_VOCABULARY_LISTS` / `Favourites - MultiLists` | `FAVOURITE_ID` + `LIST_ID` junction |
| `Lists` | Vocabulary list metadata (`LIST_NAME`, `SHARING`, `DIFFICULTY`, …) |
| `Learn - Web` / `Learn - Mobile` | Flashcard SRS state; links via `FAVOURITE_ID` / `card` relationship on history |

---

### Layer C — Scenario matrix (core deliverable)

Each scenario is one row with **fixed columns**:

| Column | Description |
|--------|-------------|
| `scenario_id` | Stable slug, e.g. `ctx-example-star` |
| `name` | Human label |
| `placement` | UI location + URL |
| `clients` | web / iOS / Android / extension |
| `source_value` | `SOURCE` int |
| `api_endpoint` | e.g. `POST /user/favourites` |
| `favtype` | Exact value (`NULL`, `mt`, `def`, …) |
| `histtype` | If history is also written |
| `history_id_rule` | `required` / `optional` / `never + when` |
| `hash_inputs` | Ordered list of fields in hash |
| `required_fields` | Must be non-null |
| `optional_fields` | May be null |
| `field_mappings` | UI element → DB column |
| `status` | `spec` / `bug` / `deprecated` |
| `owner` | Team / person |
| `validation_query` | Metabase/SQL check for compliance |

---

### Layer D — Scenario definitions

#### `all` — Global baseline

Applies to every favorite save. See Layer A.

---

#### `ctx-result-star` — Context result page (star)

| | |
|--|--|
| **FAVTYPE** | `NULL` (omit from request; never send `""`) |
| **Clients** | Web (`SOURCE=0`), Mobile (`SOURCE=1`) |
| **Placement** | Context results — search bar star, filtered translation star, example star |
| **Required** | `SOURCE_TEXT`, `TARGET_TEXT`, `SOURCE_LANG`, `TARGET_LANG`, `SOURCE` |
| **Context fields** | `SOURCE_CONTEXT`, `TARGET_CONTEXT` when saving from an **example**; optional for search-bar-only save |
| **Optional** | `SOURCE_POS`, `TARGET_POS`, `REGISTER`, `IMAGE`, `SOURCE_TRANSLIT`, `TARGET_TRANSLIT` |
| **History** | `HISTTYPE` + `TRANSLATION1..3` when history row created |
| **HISTORY_ID** | Set when user saves from History UI; **currently broken** when saving from context while history exists |

**Web payload (example with context):**
```json
{
  "srcText": "<query>",
  "trgText": "<translation>",
  "srcContext": "<example source HTML cleaned>",
  "trgContext": "<example target HTML cleaned>",
  "srcLang": "en",
  "trgLang": "fr",
  "srcPos": "…",
  "trgPos": "…"
}
```
Note: no `favType` key → Context.

---

#### `ctx-from-history` — Save from History page

| | |
|--|--|
| **FAVTYPE** | inherit from history (`HISTTYPE` → `FAVTYPE`) |
| **Required** | all baseline + **`HISTORY_ID`** = `HISTORY.ID` |
| **COMMENT** | When history has multiple translations: `COMMENT` stores translations 2 & 3 on the favorite |
| **Bug** | Saving from context does not pass `historyId` even when history row exists (~3M null `HISTORY_ID` on context favorites / 30d) |

---

#### `def-result` — Define result page

| | |
|--|--|
| **FAVTYPE** | `def` or `aidef` (same star, per [favtype details](Favorites/favtype%20details.md)) |
| **Required** | `srcText`, `trgText` (definition — use `""` not null), `srcLang` = `trgLang`, `favType` |
| **Optional** | `srcContext` (aligned example) |
| **Empty** | `trgContext` |
| **History** | `HISTTYPE` blank or def; `TRANSLATION1`; `HISTORY.SOURCE` = 5 on history row |

Enrichment fields (`SOURCE_POS`, `LANGUAGE_LEVEL`, `REGISTER`, `IMAGE`, `TARGET_TRANSLIT`) still apply per Vocabulary DB doc / editorial lists — not repeated in favtype details.

---

#### `mt-context-box` — MT on Context page

| | |
|--|--|
| **FAVTYPE** | `mt` |
| **Placement** | `#mt-box` on context results |
| **Web** | `addMTFavourite()` sends `favType: "mt"` ✓ |
| **Required** | `SOURCE_TEXT`, `TARGET_TEXT`, langs, `SOURCE` |
| **Max length** | 128 chars on `SOURCE_TEXT` (per scenario notes; DB allows 2000) |
| **History** | `HISTTYPE` = `mt`; `TARGET_TEXT` on history is **not used today** (candidate for MT target storage) |

---

#### `mt-text-translation` — Text translation page

| | |
|--|--|
| **FAVTYPE** | **`mt`** (required) |
| **Placement** | https://www.reverso.net/text-translation |
| **Bug (confirmed)** | Web does **not** send `favType: "mt"` → saves as Context (`FAVTYPE` empty, `SOURCE=0`). ~282 rows >100 chars in last 30d. |
| **Fix** | Same payload as `mt-context-box`; add `favType: "mt"` |

---

#### `syn-result` — Synonyms result page

| | |
|--|--|
| **FAVTYPE** | `syn` |
| **Required** | `srcText`, `trgText` (synonym), `srcLang`, `trgLang` with **`srcLang` = `trgLang`** |

---

#### `bilingual-combined` — BilingualCombined result page

| | |
|--|--|
| **FAVTYPE** | `NULL` (blank / Context — listed in FAVTYPE scenarios but no dedicated type) |
| **Required** | `SOURCE_CONTEXT`, `TARGET_CONTEXT`, `SOURCE_POS`, `LANGUAGE_LEVEL`, `REGISTER`, `TARGET_TRANSLIT`, `COMMENT` |
| **COMMENT** | May store extra translation variants (same dual-use as History) |
| **History** | `HISTTYPE` (blank) |

---

#### `reader-quick-search` — Reading / Watching (Quick search)

| | |
|--|--|
| **FAVTYPE** | `NULL` |
| **SOURCE** | `2` (Reader extension) on favorites; History uses `3` for reader — see SOURCE swap issue |
| **Favorites** | `SOURCE_SEGMENT`, `DOCUMENT_TITLE`, `DOCUMENT` |
| **History** | `SOURCE_CONTEXT`, `DOCUMENT_*`, `SOURCE_SENTENCE`, `SOURCE_SENTENCE_TRANSLATION1..3` |

---

#### `history-from-ss` — From History with Smart Suggestion

| | |
|--|--|
| **SS** | Smart Suggestion = `SOURCE_SENTENCE` + `SOURCE_SENTENCE_TRANSLATION1..3` (extension/reader) |
| **FAVTYPE** | inherit from history |
| **Required** | `HISTORY_ID` + sentence fields when promoting a reader history entry |

---

#### `list-import` — Save from a list

| | |
|--|--|
| **Required** | `ORIGINAL_LIST_ID` |
| **FAVTYPE** | `NULL` for bilingual lists; `def` for monolingual English lists (per Olivier vocab import) |

---

#### `editorial-list` — Creating editorial list

| | |
|--|--|
| **FAVTYPE** | `NULL` or `def` depending on list language |
| **Required** | full context + POS + register + level + transliteration + image |

---

#### `offline-sync` — Offline save (history)

| | |
|--|--|
| **Field** | `isPerformedOffline` on `History - mobile` (`0` = online) |
| **Rule** | mobile-only; maps to history row, not favorites |

---

## 3. Production data — issues to fix (short term)

Validated on `FAVOURITES` (last 30 days, Metabase):

| Issue | Evidence | Priority fix |
|-------|----------|--------------|
| `FAVTYPE` null **and** `""` for Context | 1.42M null + 1.56M empty | API: coerce `""` → `NULL`; clients: stop sending `""` |
| `HISTORY_ID` missing from context saves | ~2.97M context favorites with null `HISTORY_ID` | Web/mobile: pass `historyId` when history exists |
| Text-translation not tagged `mt` | 282 rows: `SOURCE=0`, `FAVTYPE=""`, len>100 | Web text-translation: add `favType: "mt"` |
| MT mostly mobile | 33k `mt` with `SOURCE=1` vs 1.2k `SOURCE=0` | Web MT surfaces under-tagged |
| `ctx-genai` in prod | 862 rows last month | Covered by `ctx.result.genai` |
| `aidef` vs `def-genai` naming | favtype doc vs Vocabulary DB | Align API + DB on one string |
| **SOURCE 2/3 swapped** Favourites vs History | Official DB doc | Align enums or normalize in API |
| Mobile `sourceText` → `SOURCE_CONTEXT` | Field mapping doc | Document in client code to avoid text in wrong column |

### Suggested Metabase monitors

1. **Context with empty string FAVTYPE** — should trend to 0 after API coercion.
2. **Long text without `mt`** — `LENGTH(SOURCE_TEXT) > 100 AND FAVTYPE IS NULL`.
3. **History save without HISTORY_ID** — favorites created within 5s of a matching history hash but `HISTORY_ID IS NULL`.
4. **MT over 128 chars** — `FAVTYPE = 'mt' AND LENGTH(SOURCE_TEXT) > 128`.
5. **Reader favorites with wrong SOURCE** — cross-check `DOCUMENT IS NOT NULL` with `SOURCE` value.

---

## 4. Artifact templates

### `scenarios-registry.yaml` (source of truth — add to git)

```yaml
version: 1
scenarios:
  - id: mt.text-translation
    status: active
    name: Text translation page
    clients: [web]
    favourites_source: [0]
    favtype: mt
    history: false
    api: POST /user/favourites
    fields:
      required: [scenario, srcText, trgText, srcLang, trgLang, favType]
      optional: []
    constraints:
      srcText: { maxLength: 128 }
      favType: { const: mt }
```

### CSV exports (generated from registry, not authored by hand)

**`scenarios.csv`**
```csv
scenario_id,name,status,clients,favourites_source,favtype,histtype,history_id_rule,owner
ctx.result.example-star,Context example star,active,web;mobile,0;1,,,optional,web
mt.text-translation,Text translation page,active,web,0,mt,,never,web
```

**`scenario-fields.csv`**
```csv
scenario_id,db_table,field_name,requirement,value_or_source,notes
ctx.result.example-star,FAVOURITES,SCENARIO,required,ctx.result.example-star,client sends scenario
ctx.result.example-star,FAVOURITES,SOURCE_TEXT,required,UI query,
mt.text-translation,FAVOURITES,FAVTYPE,required,mt,must match scenario
```

**`bugs.csv`**
```csv
bug_id,scenario_id,description,evidence,fix,status
BUG-001,mt.text-translation,Web omits favType,282 rows SOURCE=0 len>100,Add favType mt + scenario field,open
BUG-002,ctx.history.promote,history_id not set,2.97M null HISTORY_ID,Pass historyId when scenario requires,open
```

---

## 5. Implementation roadmap

### Week 1 — Foundation
1. Create **`scenarios-registry.yaml`** in git with ~15 scenarios (`draft` where unsure).
2. Add **`SCENARIO` column** to `FAVOURITES` only (nullable initially).
3. API: accept optional `scenario`, persist it, log validation warnings against registry.
4. Fix known bugs: text-translation `favType`, `FAVTYPE ""` → `NULL`, SOURCE enum alignment.

### Week 2 — Dev contract
5. Generate **JSON Schema per scenario** from registry; publish in API repo.
6. Require `scenario` on **new API version** (`/v2/user/favourites` or header `API-Version: 2`).
7. One **integration test per scenario** per active client.
8. Metabase: dashboard “rows by SCENARIO” + compliance checks.

### Week 3 — Enforce & clean
9. Make `scenario` **required** for all clients on new API version.
10. Fix `HISTORY_ID` for `ctx.history.promote`.
11. Deprecate Notion as spec source — export from registry only.

---

## 6. Open questions (remaining)

- Mobile `favType = 2` (web search): what DB string does API write?
- `HISTORY.TARGET_TEXT`: when will MT target be stored here?
- `WORDCOUNT`, `DOMAIN`: still needed or deprecate?
- `HASH` removal plan — what replaces client-side favorite detection?
- Mobile `status` vs web `STATUS` use different integer scales — document mapping?
