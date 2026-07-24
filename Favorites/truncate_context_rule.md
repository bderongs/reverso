# Truncation rule — favourite text columns (512 chars)

## Scope

Apply to string columns on `FAVOURITES` when normalising length, typically:

- `SOURCE_CONTEXT` (term = `SOURCE_TEXT`)
- `TARGET_CONTEXT` (term = `TARGET_TEXT`)
- Optionally the same function for `SOURCE_TEXT`, `TARGET_TEXT`, `DOCUMENT`, `TARGET_TEXT_EDITED` (term = self for source/target text, none for document / edited)

Default max length: **512 characters** (`CHAR_LENGTH` / Python `len` on the stored UTF-8 string).

## Rule

Given `text` and optional `term` (the saved search word):

1. **If `len(text) ≤ max_len`** → leave unchanged.
2. **Default cut** → keep the **prefix**: `text[0:max_len]`  
   (remove characters from the **end**).
3. **If `term` is missing** in `text` → use the default cut.
4. **If `term` is fully inside the prefix** `[0, max_len)` → use the default cut.
5. **Otherwise** (`term` lies in the removed tail, or straddles the cut) → keep the **suffix**: `text[-max_len:]`  
   (remove characters from the **start**).
6. **Edge case** — term in the **middle** of a very long string so it fits in neither prefix nor suffix (only when `len(text) > 2 × max_len` and term is not near either end): keep a **window of `max_len` chars centered on the first `term` occurrence**.
7. **If `len(term) > max_len`** — cannot preserve the full term; fall back to the default prefix cut.

### Intuition

You normally keep the beginning of an example sentence. If the highlighted word would be chopped off at the end, keep the end instead so the term stays visible.

### Matching

- **Literal** match on the stored value (HTML / JSON in the string counts toward length).
- First occurrence of `term` wins.
- Optional **case-insensitive** mode for batch scripts (`--case-insensitive`).

## Examples

| text | term | max | result | strategy |
|------|------|-----|--------|----------|
| `"abcdef"` | `"cd"` | 4 | `"abcd"` | prefix (`cd` in kept part) |
| `"abcdef"` | `"ef"` | 4 | `"cdef"` | suffix (`ef` was in cut tail `ef`) |
| `"hello WORLD"` | `"WORLD"` | 8 | `"lo WORLD"` | suffix |
| `"short"` | `"x"` | 512 | `"short"` | unchanged |

## Script

```bash
# Preview changes on a JSON export
python Favorites/truncate_context.py export.json --dry-run

# Process CSV from stdin
python Favorites/truncate_context.py --max-len 512 --dry-run < favourites.csv

# Emit truncated JSON lines (one row per line)
python Favorites/truncate_context.py export.json --max-len 512 > truncated.json
```

Implementation: `Favorites/truncate_context.py` — `truncate_preserving_term(text, term, max_len=512)`.

## SQL migration note

For an in-place DB update, compute the new value in application code or a small batch job, then:

```sql
UPDATE FAVOURITES SET SOURCE_CONTEXT = ? WHERE ID = ?;
```

Do **not** use blind `LEFT(SOURCE_CONTEXT, 512)` — that breaks examples where the term is near the end.
