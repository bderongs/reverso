# Filtering API — local demo tools

Handoff note for the Favourites **filtering + premium-banner demo**. Use this to continue work without rediscovering the setup.

Product sources (do not replace them):

- Stats & Filtering API Spec — under `Privé et partagé/`
- `[premium] Improve Premium limits` — `Privé et partagé/[premium] Improve Premium limits 387313861826804fa0c1ebc85a701658.html`

## Goal

On a real preprod account **or a predefined persona**, make it obvious:

1. Which **request** feeds each filter
2. Which **JSON field** feeds each displayed count
3. How filters **combine** (e.g. language selected → lists call must include `languagePairs`)
4. Optionally, where **premium / register banners** and the **`maxAllowed / numFilteredResults`** label appear for free users

## Files

| File | Role |
|------|------|
| `Favorites/proxy-server.js` | Local relay on port **3847** (CORS + Cloudflare-friendly `User-Agent`) |
| `Favorites/filtering-demo.html` | Main demo UI (filters + optional premium placeholders + **persona selector**) — **edit this** |
| `Favorites/api-tester.html` | Create/inspect favourites; shares auth via `localStorage` |
| `Favorites/filtering_api_spec.md` | This handoff doc |

Shared auth key: `localStorage["fav-api-tester.v1"]` (`authToken`, `origin`).

## Run

```bash
node Favorites/proxy-server.js
```

| URL | Purpose |
|-----|---------|
| http://localhost:3847/ | API tester |
| http://localhost:3847/filtering-demo.html | Filtering demo |

Open via the relay (not `file://`). Default API base is preprod (override with `FAV_API_BASE` / `PORT` if needed).

### Why a local relay?

Browser calls from `localhost` to preprod are blocked by **CORS**. The relay forwards URL, headers, and body, and sends a browser-like `User-Agent` (Cloudflare was returning 403 for default Node/curl agents).

## Page layout (`filtering-demo.html`)

Three colour-coded zones (top → bottom), with generous spacing:

| Zone | Tint | Contents |
|------|------|----------|
| **Configuration** | Indigo | Collapsible **Auth & load** + always-visible **Demo options** (data source + premium toggle) |
| **Demo** | Slate | Full-width phone mock (favourites filters, banner placeholders, sheets) |
| **Technical data** | Violet | Response counters + raw JSON payloads |

### Configuration UX

- **Auth & load** is a `<details>` panel. It **collapses after a successful Load**, stays open on missing/expired token or request error. Skipped (labelled) when a predefined user is selected.
- **JWT validity** is decoded client-side from `exp`:
  - Badge in the summary: valid remaining time / expires soon (&lt; 2 min) / expired / not a JWT
  - Inline warning under the token field when not good
  - Refreshes on input and every 15s; Load is blocked if expired (**Live API only**)
- **Demo options** stay visible even when auth is collapsed:
  - **Data source** select — `Live API (JWT → preprod DB)` or a predefined persona (no token)
  - Persona blurb + tags under the select; switching persona resets filters and reloads
  - `Premium banner mode` checkbox (off by default for Live; personas that need banners turn it on)
  - When on: **Registered (free)** vs **Anonymous** simulate switch
  - Header badge `Premium banners on` (or `… · anonymous`)

### Demo zone

- Full width of the block (no max-width on the phone mock).
- Chips: **Language**, **List**, **Status**.
- Opening a chip shows options with the purple source path under each value.
- Sheet header shows the **exact request** + active filter query params.
- Active chips keep their label even if the option disappears under other filters.
- Banner slots: `#banner-top` (above chips) and `#banner-bottom` (below list). Placeholders only — text like `premium banner`, not production UI.

### Technical data zone

- **Response counters**: `numTotalResults`, `numFilteredResults`, `results.length`, learning denom; when premium mode is on, also `freemiumLimit.limitReached` / `storedItems` / `maxAllowed`.
- **Raw payloads**: `GET /user/favourites` and `GET /user/favouritesLists` (persona mode shows the same shapes, generated client-side).

## Predefined users (personas)

Live API stays available. Personas are **client-side fixtures** that still run through `refresh()` → chips → banners → raw JSON. Changing Language / List / Status **recomputes** counts locally the same way the Live API would (count map ignores language; lists honour `languagePairs` + `favouriteLearningStatus`).

| Id | Label | Traits | What it demos |
|----|-------|--------|---------------|
| `premium-heavy` | Premium · 240 favs, 5 lists | 240 favs, 5 pairs, 5 lists, **no** `freemiumLimit` | Filtering at scale; premium → no banners even with mode on |
| `free-35` | Free registered · 35 favs | 35 favs, `limitReached: false` | Mid-funnel: premium V1 top+bottom (&gt;10, under display cap) |
| `free-capped` | Free · limit reached (67 stored) | 67 stored, `limitReached: true`, page truncated to 40 | Limit-reached banner + orange **40/N** terms |
| `free-store-wall` | Free · near store wall (208) | 208 stored (&gt;200 store wall), display still capped at 40 | Heavy free user / store-wall context for viewing |
| `anon-fresh` | Anonymous · 4 favs | 4 favs, anon | Register banner only (&lt;10) |
| `anon-active` | Anonymous · 22 favs | 22 favs, anon | Register on top **stacked** with premium V1 |
| `exact-10` | Free registered · exactly 10 | Exactly 10 favs | Spec gap (`&lt;10` / `&gt;10`) → no banner for registered |
| `learning-spread` | Learning statuses · 36 favs | Balanced Learning / Mastered / Ignored / Not Started | Status chip + learning count fields |
| `list-skew` | List skew · uneven lists | Huge Travel vs tiny Almost-empty | List filter + language×list combine |
| `single-pair` | Single pair · all en-fr | All `en-fr` | Degenerate language chip; lists/status still useful |
| `empty` | Empty account · 0 favs | 0 favs | Empty states |

Persona catalogue + fixture builder live in `filtering-demo.html` (`PERSONAS`, `buildPool()`, `personaPayloads()`). To add one: append a `PERSONAS` entry with `build: () => buildPool({…})`.

### How to use personas in a review

1. Start the relay → open the filtering demo.
2. **Demo options → Data source** → pick a persona (no JWT).
3. Walk filters; with premium mode on (auto for free/anon personas), point at banners / `40/N`.
4. Switch back to **Live API** when you need a real preprod account.

## Filtering behaviour (unchanged core)

| Filter | Request | Count field(s) |
|--------|---------|----------------|
| Language pairs | `GET /user/favourites?learningInfo=true` (+ other filters except language itself for the `count` map) | `count["en-fr"]`, … |
| Lists | `GET /user/favouritesLists?learningInfo=true` (+ `languagePairs`, `favouriteLearningStatus` when set) | `results[].numFavourites` |
| Learning status | Same favourites GET | `learningStatus.inProgressCardsFiltered` (Learning), `memorizedOnceCardsFiltered` (Mastered), `ignoredCardsFiltered` (Ignored); Not Started = `numFilteredLearningResults −` sum of the three |

Result list uses `results` / `numFilteredResults` from `GET /user/favourites`.

Key JS entry points in `filtering-demo.html`: `refresh()`, `favParams()` / `listParams()`, `renderSheet()`, `renderFavs()`, `updateChips()`, `personaPayloads()`.

## Premium banner mode

Off by default so filter reviews stay clean (Live). Free/anon personas enable it automatically. When on, applies **Favorites / My List viewing** rules from Improve Premium limits — **not** saving-event walls, editorial 12-term rule, Learn/Vocabulary banners, or discount walls.

Banners are **placeholders only** (`premium banner` / `register banner`).

### API object (free users only; absent for Premium)

```json
"freemiumLimit": {
  "limitReached": true,
  "storedItems": 67,
  "maxAllowed": 40
}
```

Prod field names: `storedItems` / `maxAllowed`. Older wording: `storedFavsNo` / `numberOfFavsAllowed`. The demo accepts both via `freemiumLimit()`.

### Display rules (what the demo implements)

| Condition | Demo shows | Best persona |
|-----------|------------|--------------|
| No `freemiumLimit` | Nothing extra | `premium-heavy` |
| `limitReached === true` | `premium banner (limit reached)` at top | `free-capped`, `free-store-wall` |
| …and `numFilteredResults > maxAllowed` | Terms = orange **`maxAllowed`**`/`**`numFilteredResults`** (e.g. **40**/67) | `free-capped` |
| `limitReached === false`, registered, `numFilteredResults < 10` | Nothing | (slice filters on `free-35`, or `empty`) |
| `limitReached === false`, anonymous, `numFilteredResults < 10` | `register banner` at top | `anon-fresh` |
| `limitReached === false`, `numFilteredResults > 10` | `premium banner` top **and** bottom | `free-35`, `anon-active` |
| Anonymous (any count) | Always `register banner` on top as well (stacks with premium V1 when `> 10`) | `anon-active` |
| Registered, exactly 10 | Nothing (spec gap) | `exact-10` |

Note: product wording uses `< 10` and `> 10`; **exactly 10** is a gap → registered shows nothing; anonymous still gets register on top.

Logic lives in `renderPremiumBanners()` and `renderTermsCount()`. Use a **free** preprod account so the API returns `freemiumLimit`, or pick a free/anon persona.

## Seed data (for Live API demos)

~50 favourites on a test account across `en-fr`, `en-nl`, `en-es`, `en-de`, `fr-en` (comments prefixed `filter-demo-…`) and two lists:

- **Filter Demo — Travel** (`67854`) — mostly `en-fr` / `fr-en`
- **Filter Demo — Daily** (`67855`) — `en-nl`

List assignment: `POST /user/favourites/addToLists` with `{ "<favouriteId>": [<listId>] }`.

Prefer personas when you need a specific freemium / size edge case without seeding the DB.

## How to use in a review

1. Start the relay → open the filtering demo.
2. **Configuration**: either paste a fresh GAS JWT (~15 min) and Load, **or** pick a predefined user.
3. Optionally tweak Premium banner mode / Registered vs Anonymous.
4. **Demo**: walk Language → List → Status; with premium on, point at top/bottom placeholders and the orange `40/N` terms label.
5. **Technical data**: open counters / raw JSON when someone asks “which field?”.
6. Use the API tester to create/inspect individual favourites if needed (Live only).

## Continuing the work — likely next steps

Safe extension points (keep the three-zone layout):

- **History** — same filter + `freemiumLimit` viewing rules; demo is favourites-only today.
- **Saving-event / premium wall** flows from the premium doc (3rd/6th save, ≥10 nagging, ≥40 / &gt;200 walls) — intentionally not in this demo; `free-store-wall` only covers the *viewing* side.
- **Real banner copy** — loc keys are in the premium doc wording table; demo deliberately uses placeholders.
- **Simulate `freemiumLimit` override on Live** — useful when the logged-in account is Premium (no object in the response); personas already cover this.
- **Editorial list** 12-term + banner rules — separate product surface.
- **More personas** — e.g. exactly 40 stored, or History-shaped payloads, if reviews need them.

When changing premium rules, update both `renderPremiumBanners()` / `renderTermsCount()` **and** the table above so the doc stays the source of truth for the demo.

## Out of scope (deliberate)

- Production UI polish (Practice now, cards view, real banner design).
- History endpoints.
- Learning-status *card* mutations (we only read `*Filtered` fields).
- Real premium/register banner assets and copy.
- Writing persona data into the real preprod DB (fixtures are client-side only).
