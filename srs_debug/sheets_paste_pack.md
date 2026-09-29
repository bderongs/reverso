# Google Sheets update pack — Executive Summary
# Paste these manually (browser automation could not commit cell edits while unsigned-in).

## 1) Config sheet — replace column A with:

id
658
659
660
698
702
706
737
738
652
654
655
703
707
656
704
700
746
770
769
771
772

## 2) Summary sheet — set row 2 (2026-08-13 baseline) from Dashboard 49 Prior:

A2	2026-08-13
B2	820702	# Active users Prior (Q730)
C2	817853	# Active searchers Prior (Q731)
D2	94715	# Active favoriters Prior (Q732)
E2	39875	# Active learners Prior (Q733)
F2	1551	# Active readers Prior (Q741)

## 3) Summary sheet — add headers in row 1 starting at H1 (tab-separated):

Strong favoriters (30 days)	Strong learners (30 days)	Strong readers (30 days, >3 texts)	Search → Save rate (30 days)	Total premium subscribers	Premium rate — active users (30 days)	Active rate — premium subscribers (30 days)	Premium rate — favoriters (30 days)	Premium rate — learners (30 days)	Learn rate — premium subscribers (30 days)	% users — learn cards created but never seen (30 days)	Avg learn cards per learner (30 days)	Created but not played Cards	Being Learned cards	Mastered this month

## 4) Summary sheet — fill Aug-13 priors for new columns (H2:K2):

H2	10127	# Strong favoriters Prior (Q735)
I2	24515	# Strong learners Prior (Q736)
J2	95	# Strong readers Prior (Q740)
K2	0.115809	# Search→Save rate Prior (Q734)

## 5) Executive — fix Evolution (D3), then fill down to D7 (and later new rows):

=WENN(ODER(C3="";C3=0);"";B3/C3-1)

## 6) Executive — add metric rows under General Activity (after Active readers), then Learning Activity:

### General Activity (A column labels — formulas in B/C/D same pattern as existing rows)
Strong favoriters (30 days)
Strong readers (30 days, >3 texts)
Search → Save rate (30 days)
Total premium subscribers
Premium rate — active users (30 days)
Active rate — premium subscribers (30 days)
Premium rate — favoriters (30 days)

### Learning Activity
Active learners (30 days)   # already listed under General — move here if preferred
Strong learners (30 days)
Avg learn cards per learner (30 days)
% users — learn cards created but never seen (30 days)
Premium rate — learners (30 days)
Learn rate — premium subscribers (30 days)
Created Cards last 30D
Created but not played Cards
Being Learned cards
Mastered this month

## Notes
- Headers MUST match Metabase question names exactly (N8N maps by name).
- Premium / D50 metrics have no MoM Prior yet → Aug-13 cells stay blank until N8N backfills or we add MoM questions.
- Queried Metabase Dashboard 49 on 2026-09-25 for Prior window (−60…−31d).
