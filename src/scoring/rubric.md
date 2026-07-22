# Fit scorer rubric

Inputs per job: the JD (title/location/description), the company row, the company
dossier (company_intel), and Ana's full profile (`profile/*.md`).

Output: **strict JSON only** — no prose, no markdown fences:

```json
{
  "fit_score": 8.5,
  "verdict": "apply | maybe | skip",
  "eligibility": "eligible | plausible | unlikely | unclear | not_eligible",
  "eligibility_reason": "one line",
  "culture_flags": ["dealbreaker hits from the dossier, each with its confidence"],
  "comp_flag": "one line ONLY if the company's senior-design band likely can't reach Ana's target; else null",
  "strengths": ["3 specific reasons naming her actual work — not generic praise"],
  "gaps": ["2-3 honest gaps between the JD and her profile"],
  "lead_case_study": "which portfolio case to lead with, and one line on why",
  "resume_edits": ["2-3 concrete line-level edits. Not 'tailor your resume'."],
  "one_line_take": "the honest sentence a friend would say about this role"
}
```

## Score bands

| Score | Meaning |
|---|---|
| 9–10 | Tier 1 company, matches her level and domain, her portfolio directly answers the JD, culture clean. Drop everything. |
| 7.5–8.9 | Strong match, 1–2 stretch areas. Apply this week. |
| 6–7.4 | Plausible but a stretch, or needs real resume work. Apply only if the pipeline is thin. |
| < 6 | Do not apply. One line on why. |

## Hard rules

1. **Dealbreaker cap:** a confirmed (high-confidence) dossier hit on weekend work,
   six-day week, micromanagement, or politics/bad-leadership **caps fit_score at 5.9**,
   whatever else is true. Show the role anyway with the reason in `culture_flags`.
   Ana decides, but she decides knowing.
2. **Level fit (updated 2026-07-24):** Ana's exact targets are **Senior Product
   Designer, Product Designer II, Product Designer III**. Plain "Product Designer"
   at a large/high-bar org can map up — fine. Anything ABOVE the targets (Staff,
   Sr Staff, Principal, Group Lead, any manager track) is excluded — the prefilter
   now kills those; if one slips through, score it ≤ 5 and say why.
   Design-systems-only roles are not targets.
3. **Comp is a flag, not a filter** — use `salary_band_senior`/`comp_reachable`
   from the dossier; if the band credibly can't reach her target, say so in
   `comp_flag` and reflect it in the score modestly.
4. **Domain order:** fintech (payments/credit/wealth) > healthtech > fashiontech >
   consumer tech > B2B SaaS. Her strongest evidence is B2C fintech at scale.
5. `culture_flags` must surface **regardless of score** — a 9.0 with a medium-confidence
   weekend-work flag still shows the flag.

## Calibration — read this twice

**Be honest, not encouraging.** A 6 dressed up as an 8 costs Ana a week of her life.
Her profile is genuinely strong in: compliance/KYC UX, funnel optimisation,
high-scale B2C fintech, 0→1 feature design, cross-sell/monetisation design.
It is genuinely thin in: design systems ownership, B2B/enterprise depth,
shipped AI-product work, people management. Score accordingly. Do not inflate.
Do not deflate either — a JD asking for exactly her compliance-UX story is rare
and should score like it.
