# Emailing cohorts — tracking

## How batches work

1. Addressable pool starts in `c1b_strong_favoriters_EN_addressable_excl_campaign4977.csv`.
2. Each send: take the next N from `c1b_strong_favoriters_EN_remaining.csv` (or regenerate remaining from addressable − `sent_log.csv`).
3. Record every recipient in **`sent_log.csv`** with a `BATCH_ID`.
4. Summarize batches in **`batches_ledger.csv`**.
5. Batch CSVs live in **`batches/`**.

## Current status (2026-07-21)

| Item | Value |
|------|-------|
| Cohort | C1b strong favoriters EN (excl. campaign 4977) |
| Addressable total | 1972 before this batch cut |
| This batch | `c1b_en_2026-07-21_batch1` — **500** users |
| Remaining | **1472** |
| Status | `queued` — set to `sent` in ledger + sent_log when Brevo campaign is live |

## Files to use for this week's send

- Brevo import: `batches/c1b_en_2026-07-21_batch1_emails_only.csv`
- Full detail: `batches/c1b_en_2026-07-21_batch1.csv`
