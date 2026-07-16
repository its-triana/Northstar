# Company intel dossier (PRD §9)

Generated once per company, cached 60 days (`company_intel.refreshed_at`).
Company reputation doesn't change hourly — reuse across every job from that company.

## Research sources (all free)

- **Web search:** `"{company}" glassdoor rating`, `"{company}" ambitionbox reviews`,
  `"{company}" senior product designer salary india`, `"{company}" work life balance`,
  `"{company}" layoffs`. Extract from public snippets — do NOT try to scrape
  Glassdoor/AmbitionBox/Blind directly (they block; snippets are enough).
- **Reddit signal:** Reddit now blocks unauthenticated `.json` endpoints from most
  networks — do NOT rely on them. Get Reddit signal via web search instead
  (`"{company}" reddit review employees`, `site:reddit.com "{company}" working`),
  reading the snippets. If signal is thin, `reddit_sentiment: "thin_data"`.
- **News search** for funding/layoffs in the last year.

## The five culture questions — dealbreaker checks, not colour

Answer each explicitly. Each returns `{ "verdict": "...", "confidence": "high|medium|low", "evidence": ["quotes or links"] }`.

1. **weekend_work** — is weekend work normal here?
2. **six_day_week** — is this a six-day week / non-Mon-Fri schedule?
3. **micromanagement** — is micromanagement a recurring complaint?
4. **politics_leadership** — are politics or bad leadership a recurring complaint?
5. **wlb** — how is work-life balance actually reported?

A **high-confidence yes** on 1, 2, 3, or 4 is a dealbreaker → caps fit score at 5.9
(rubric hard rule). Medium/low-confidence hits are flags, not caps.

## Calibration — bake this in

Reddit and Glassdoor skew angry about every employer, always. Weight **recurring,
specific** complaints (a named six-day policy, repeated Saturday-standup mentions,
three people describing the same manager) over the mere existence of complaints.
Three angry posts among forty neutral ones is a normal company.
**Return `thin_data` when there isn't enough to judge. Do not invent a narrative.**
A false dealbreaker costs Ana a job she'd have loved; a missed one costs her a
year of her life. Both are real. Say what you actually know, cite what you cite.

## Full JSON shape (matches `company_intel` columns)

```json
{
  "glassdoor_rating": 4.1,
  "ambitionbox_rating": 3.8,
  "salary_band_senior": "₹25-40L (Levels/AmbitionBox snippets)",
  "comp_reachable": "likely | unlikely | unknown",
  "weekend_work": { "verdict": "no_signal", "confidence": "medium", "evidence": [] },
  "six_day_week": { "verdict": "no", "confidence": "high", "evidence": [] },
  "micromanagement": { "verdict": "thin_data", "confidence": "low", "evidence": [] },
  "politics_leadership": { "verdict": "some_complaints", "confidence": "medium", "evidence": ["..."] },
  "wlb": { "verdict": "generally_positive", "confidence": "medium", "evidence": ["..."] },
  "design_culture": "real design org (VP Design, published design blog) | design-as-service | unknown",
  "hires_from_india": { "verdict": "has_india_office", "confidence": "high", "evidence": ["..."] },
  "reddit_summary": "2-3 sentences of what Reddit actually says",
  "reddit_sentiment": "positive | mixed | negative | thin_data",
  "red_flags": ["active layoffs 2025", "..."],
  "funding_news": "one line, or null",
  "sources": ["https://...", "https://..."]
}
```

Ratings unknown → null. comp_reachable is judged against Ana's private target
band in `profile/preferences.md` (never hardcode the number in code or output).
