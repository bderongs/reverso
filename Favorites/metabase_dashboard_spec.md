# Metabase dashboard — Favourites filtering check (email)

Internal dashboard to cross-check the **filtering demo** counters against production DB values for a given user email, including Language / List / Status chip behaviour (v2).

## Dashboard

- **Name:** `Favourites Filtering Check (by email)`
- **URL:** https://metabaseapp.reverso.net/dashboard/48
- **Collection:** `Our analytics / Favourites Filtering Check`
- **Database:** `Context Prod (Replica)` (MySQL)

### How to use

1. Open the dashboard in Metabase.
2. Set **Email** (exact match).
3. Optionally set chip-like filters:
   - **Source Lang** + **Target Lang** (language pair, e.g. `en` + `fr`)
   - **List Name**
   - Learning fields: **Classification** / **Last Status** / **Memorized**
4. Read:
   - **Filtered results** → `numFilteredResults`-style count under current filters
   - **Language / List / Status options** cards → chip option tables
   - **Core favourites / Freemium** (v1 cards) → global totals (email only)

If no user matches the email, lookup/counter cards will be empty.

## Wire the new filters (one-time in Metabase UI)

Edit the dashboard → **Add a filter** for each:

| Dashboard filter | Type | Map to these cards | Field on card |
|------------------|------|--------------------|---------------|
| Email | Text | All cards | `Users → Email` / `EMAIL` |
| Source Lang | Text / Category | Filtered results, List options, Status options | `Source Lang` |
| Target Lang | Text / Category | Filtered results, List options, Status options | `Target Lang` |
| List Name | Text / Category | Filtered results, Language options, **Status buckets** | `List Name` / `Lists → List Name` |
| Classification | Category | Filtered results, Status options | `Classification` |
| Last Status | Category | Filtered results, Status options | `Last Status` |
| Memorized | Category / Boolean | Filtered results, Status options | `Memorized` |

### Important mapping rules (UX parity)

| UX behaviour | Metabase mapping |
|--------------|------------------|
| Language chip options ignore the language filter itself | **Do not** map Source/Target Lang to **Language options** card |
| Lists honour `languagePairs` | Map Source/Target Lang to **List options** |
| Lists can honour learning status | Map Classification / Last Status / Memorized to **List options** if desired |
| `numFilteredResults` uses all chips | Map **all** chip filters to **Filtered results** |
| `numTotalResults` / `freemiumLimit.storedItems` are global | Keep v1 Core / Freemium cards **email-only** (no lang/list/status) |

## UI → DB metric mapping

| UI label / API field | Dashboard source | DB logic |
|----------------------|------------------|----------|
| `numTotalResults` | Core favourites count (v1) | `COUNT(FAVOURITES)` where `REMOVED = false` for user |
| `numFilteredResults` | **v2 Filtered results** | Same count with optional lang / list / learning filters |
| `count["en-fr"]`, … | **v2 Language options** | `COUNT(*)` grouped by `SOURCE_LANG`, `TARGET_LANG` |
| `results[].numFavourites` | **v2 List options** | Count of favourite↔list links per list |
| `learningStatus.*` | **v2 Status options** | `LEARN_CARDS` fields (see status mapping below) |
| `freemiumLimit.storedItems` | Freemium snapshot (v1) | Total non-removed favourites (email only) |
| `freemiumLimit.maxAllowed` | Freemium snapshot | `40` for free users; empty for premium |
| `freemiumLimit.limitReached` | Freemium snapshot | `storedItems > 40` for free users |

### Learning status mapping (clean buckets)

Use card **Fav Check v2 — Status buckets** and filter on `status_bucket` (not raw Classification / Last Status / Memorized).

Priority (first match wins):

| UX chip | `status_bucket` | Rule on `LEARN_CARDS` |
|---------|-----------------|------------------------|
| Ignored | `Ignored` | `CLASSIFICATION = 'IGNORED'` |
| Mastered | `Mastered` | `MEMORIZED = true` |
| Learning | `Learning` | `CLASSIFICATION = 'DEFAULT'` AND `MEMORIZED = false` AND `SRS_COUNTER` between 0 and 4 |
| (other learn cards) | `Other` | anything else (e.g. SRS &gt; 4) |
| Not Started | *(derived)* | `Filtered results − Learning − Mastered − Ignored` |

**Not Started** cannot be a row in `LEARN_CARDS` (those cards are favourites with no matching Learning/Mastered/Ignored bucket). Compute it from:

1. **Filtered results** count (under Email + Lang + List)
2. Minus sum of Learning + Mastered + Ignored from the Status buckets card (same filters)

Optional dashboard filter: one **Status** filter mapped to `status_bucket` on the Status buckets + Filtered results cards (values: `Learning`, `Mastered`, `Ignored`). Do not use separate Classification / Last Status / Memorized filters once this is wired.

## Caveats vs the live web UX

- **Learning status** is approximated from `LEARN_CARDS` (joined on user + source text + langs for filtered results). API uses `learningInfo=true` on favourites; numbers can diverge.
- **Not Started** is derived in the UI; Metabase has no single enum value for it.
- **Language pair** is two filters (`Source Lang` + `Target Lang`), not one `en-fr` string.
- **Replica lag:** counts may trail live API.
- **Anonymous users** have no email — registered accounts only.
- Shared dashboard filters cannot perfectly cascade like the phone mock sheets; selective card mappings above approximate the chip rules.

## Saved questions

| Question | Purpose |
|----------|---------|
| Fav Check — User lookup | Email, user id, premium plan |
| Fav Check — Core favourites count | Global `numTotalResults` |
| Fav Check — Language pair counts | v1 language breakout |
| Fav Check — Lists and numFavourites | v1 lists |
| Fav Check — Learning status counts | v1 learning |
| Fav Check — Freemium snapshot | Global freemium inference |
| Fav Check — Metric definitions | Reference |
| **Fav Check v2 — Filtered results** | `numFilteredResults` under chip filters |
| **Fav Check v2 — Language options** | Language chip table |
| **Fav Check v2 — List options** | List chip table |
| **Fav Check v2 — Status options** | Status chip table |

## Validation checklist

| Scenario | What to verify |
|----------|----------------|
| Email only | Filtered results ≈ Core favourites count |
| Email + `en`/`fr` | Filtered results drop; Language options still show all pairs if Source/Target not mapped to that card |
| Email + List Name | Filtered results + Language options update |
| Free user, >40 favs | Freemium still based on **global** stored count |
| Unknown email | Empty / zero |

Cross-check: same account in the filtering demo (Live API) Technical data zone.
