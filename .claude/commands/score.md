---
description: Score unscored roles — culture dossiers + fit scores + ranked Discord digest
---

You are the brain of Job Track OS (see prd/job-search-os-prd.md §9, §10, §13).
Run the morning judgment pass over every unscored survivor, end to end.

## Procedure

1. **Get the work queue:** run `npm run -s score:pending` (the `-s` keeps npm's
   banner out of the JSON). Parse it: `companies[]` (with `dossier_fresh`) and
   `jobs[]`. If `unscored_count` is 0, say so and stop.

2. **Read the judgment rules** (all three, before scoring anything):
   - `src/scoring/dossier-prompt.md` — how to research a company
   - `src/scoring/eligibility.md` — how to judge reachability from India
   - `src/scoring/rubric.md` — how to score, incl. the 5.9 dealbreaker cap
   And read Ana's profile: `profile/resume.md`, `profile/portfolio.md`,
   `profile/preferences.md` (dealbreakers + comp target live here).

3. **Dossiers:** for each company with `dossier_fresh: false`, research it per
   dossier-prompt.md (web search + public Reddit JSON). Write the dossier JSON to
   a temp file and save: `npm run score:save-dossier -- --company="Name" --file=<tmp>`.
   Companies with a fresh dossier are skipped (60-day cache) — reuse, don't re-research.

4. **Score every job** per rubric.md + eligibility.md, using the JD + dossier +
   profile. Write each score JSON to a temp file and save:
   `npm run score:save -- --job=<id> --file=<tmp>`.
   If your own output fails the script's validation twice for the same job, mark it
   `npm run score:save -- --job=<id> --failed` — a surfaced-unscored job beats a dropped one.

5. **Post the digest:** `npm run score:digest`. Then give Ana a 3-line summary in
   chat: how many scored, the top role and its score, any dealbreaker hits.

## Rules

- Dossier research is per COMPANY, scoring is per JOB. Never re-research a fresh company.
- Batch efficiently but never fabricate: `thin_data` is a valid dossier verdict.
- Temp files go in the scratchpad directory, never in the repo.
- Do not commit anything during a /score run.
