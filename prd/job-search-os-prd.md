# Job Search OS — PRD v3 (final)

**Owner:** Ana (Anamika Tripathi)
**Build agent:** Claude Code
**Build window:** ~12 days, 5 sequential phases
**Status:** Ready to build

---

## 1. One-liner

A private, always-on system that watches job sources continuously, catches design roles within an hour of posting, scores each against Ana's actual resume and portfolio, attaches the company research she'd otherwise do by hand, and pushes only the ones worth acting on to Discord, where she acts on them.

## 2. Core loop

> Every morning Ana opens one Discord digest of scored roles, each with a fit score, a culture read, and a company dossier. She clicks Applied or Dismiss on the card. The system records it and gets sharper.

If this loop works, the build is a success even with nothing else.

## 3. The two things this system is actually for

Everything below serves these. When a design decision is ambiguous, resolve it toward one of them.

1. **Speed.** Know about the right role within an hour of it going live, before the applicant pile forms.
2. **Judgment.** Never apply to a company that will make her miserable, and never *miss* one that wouldn't. The culture dossier is not a garnish. It is half the product.

---

## 4. Collection: three channels

### Channel A — ATS direct polling (primary, fastest signal)

Companies post to their own ATS before the job syndicates anywhere. These are public, unauthenticated JSON endpoints. Not scraping.

| ATS | Endpoint pattern |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{token}` |
| Workable | `https://apply.workable.com/api/v1/widget/accounts/{token}?details=true` |
| Recruitee | `https://{token}.recruitee.com/api/offers/` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{token}/postings` |

**Staggered polling**, to avoid rate limits and wasted calls:
- Tier 1: hourly
- Tier 2: every 4 hours
- Tier 3: daily

Tier drives freshness. A company in the wrong tier means late notification, so tiers matter more than they look.

### Channel B — Free job APIs (breadth, remote roles)

All public, no key or free key, no scraping:

- RemoteOK: `https://remoteok.com/api`
- Remotive: `https://remotive.com/api/remote-jobs?category=design`
- Himalayas: public jobs API
- We Work Remotely: RSS, `https://weworkremotely.com/categories/remote-design-jobs.rss`
- Arbeitnow: public API
- Jobicy: public API
- Working Nomads: RSS
- Hacker News "Who is Hiring": Algolia API, free, monthly thread, high signal

Poll every 2 hours.

### Channel C — Aggregator (India coverage + discovery)

- **JSearch via RapidAPI** wraps Google Jobs, which indexes Naukri, Indeed, Glassdoor and thousands of career pages. ~$10-30/month. This is the India coverage layer.
- **Apify LinkedIn actor** (`fantastic-jobs/advanced-linkedin-job-search-api`): **weekly, discovery only**, budget-capped. Not a primary feed.

**Hard rule: never scrape LinkedIn, Naukri, Indeed, Glassdoor or AmbitionBox directly.** They block aggressively and the build will die fighting Cloudflare instead of shipping. Everything above is an official API or a public feed.

### The discovery loop

A curated list can only find companies Ana already knows. So the portals feed the list:

1. A job arrives from Channel B or C.
2. Its company is not in `companies`.
3. It clears the prefilter.
4. → Company inserted as `status = 'candidate'`.
5. → **ATS discovery** runs: try each ATS URL pattern against slugified variants of the company name and its domain. If one returns valid JSON, record `ats_type` and `ats_token`.
6. → Company appears in the **Monday "new companies" digest** with its dossier and two buttons. Approve → `active`, polled directly from then on. Reject → never surfaced again.

The list grows itself. Reject aggressively: portals are full of staffing agencies and consultancies, and a loosely-approved list wastes the polling budget on junk.

---

## 5. Non-goals

- **No web dashboard until Phase 5.** Discord is the interface first. The dashboard is built *after* the loop works, against real data.
- **No Gmail integration.** Cut from scope entirely (owner's call): status updates stay deliberate, human taps on the card — the tracker never reads the inbox.
- **No AI/design news feed.** Content consumption, not job search.
- **No standalone profile-rating engine.** That analysis was done once, by hand. Its output is `/profile`, which is an *input* here.
- **No interview audio upload or transcription.** Different product, zero shared code.
- **No resume rewriting.** The scorer suggests specific edits. It does not generate documents.
- **No multi-user, no accounts, no auth.** Single user.
- **GitHub Pages is explicitly rejected as a host.** See §11.

---

## 6. Architecture

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, one mental model |
| Collector | Node script | Stateless. Runs, writes, dies. |
| Scheduler | GitHub Actions cron | Free, always-on, no server |
| Database | Supabase (Postgres, free tier) | **Single source of truth.** Its table editor doubles as the browse UI until Phase 5. |
| Scoring + intel | Anthropic API, `claude-sonnet-4-6` | Two-stage. LLM only on prefilter survivors. |
| Search (for intel) | Serper or Brave Search API | Cheap. Reaches blocked review sites via public snippets. |
| Reddit | Official Reddit API (free tier) | Direct access, 100 req/min |
| Notifications + actions | Discord webhook + interactions endpoint | Notifications and actions in one surface |
| Serverless functions | Netlify Functions | Handles Discord interactions and dashboard reads. Keys stay server-side. |
| Dashboard (Phase 5) | Netlify, private repo | Not GitHub Pages. See §11. |
| Repo | **Private** GitHub repo | Contains resume, portfolio, salary, application history |

### Sync model: there is no sync

Discord and the dashboard **never talk to each other and do not know the other exists.** Supabase is the only copy of the data. Both surfaces are windows onto it.

```
Click "Applied" in Discord
  → Discord POSTs to a Netlify function
  → function writes status=applied to Supabase
  → function edits the Discord card in place
  → done

Open the dashboard later
  → it asks a Netlify function for jobs
  → function reads Supabase
  → the row already says applied
```

The dashboard is never *updated*. It reads the truth whenever it's opened. The failure mode "Discord and dashboard disagree" is structurally impossible.

Optional, two lines of code: Supabase realtime subscriptions let an open dashboard update live when a Discord button is pressed on a phone.

### Data flow

```
GitHub Actions (hourly)
  → poll ATS boards (staggered by tier) + portal APIs
  → dedup pass 1: (company_id, external_id)
  → dedup pass 2: (normalised_company + normalised_title), 14-day window
  → prefilter: plain rules, no LLM, kills ~90%
  → for survivors: ensure company dossier exists (cached, 60-day TTL)
  → scorer: Claude API — job + profile + dossier in, JSON out
  → write to Supabase
  → Discord: instant alert if it clears the bar, else queue for digest

GitHub Actions (daily 9am IST)  → Discord: ranked digest + stale-application nudges
GitHub Actions (weekly Mon)     → Discord: new companies discovered, approve/reject
```

---

## 7. Data model

```sql
companies (
  id                uuid pk,
  name              text not null,
  domain            text,
  ats_type          text,           -- greenhouse|lever|ashby|workable|recruitee|smartrecruiters|none
  ats_token         text,
  tier              int,            -- 1 dream, 2 strong, 3 acceptable. Drives polling frequency.
  hq_region         text,
  funding_stage     text,
  status            text default 'candidate',  -- candidate | active | rejected
  discovered_via    text,           -- seed | portal | aggregator
  created_at        timestamptz default now()
)

company_intel (
  company_id            uuid pk fk -> companies.id,
  glassdoor_rating      numeric,
  ambitionbox_rating    numeric,
  salary_band_senior    text,       -- what a senior designer plausibly earns here
  comp_reachable        text,       -- likely | unlikely | unknown  (vs Ana's private target CTC band)
  weekend_work          jsonb,      -- { verdict, confidence, evidence[] }
  six_day_week          jsonb,      -- { verdict, confidence, evidence[] }
  micromanagement       jsonb,      -- { verdict, confidence, evidence[] }
  politics_leadership   jsonb,      -- { verdict, confidence, evidence[] }
  wlb                   jsonb,      -- { verdict, confidence, evidence[] }
  design_culture        text,       -- real design org, or design as a service function
  hires_from_india      jsonb,      -- { verdict, confidence, evidence[] }  (global onsite only)
  reddit_summary        text,
  reddit_sentiment      text,       -- positive | mixed | negative | thin_data
  red_flags             jsonb,
  funding_news          text,
  sources               jsonb,      -- links, so Ana can verify anything that matters
  refreshed_at          timestamptz
)

jobs (
  id                 uuid pk,
  company_id         uuid fk -> companies.id,
  external_id        text not null,
  source             text not null,  -- which channel found it
  title              text not null,
  location           text,
  remote_type        text,           -- remote | hybrid | onsite | unknown
  description        text,
  url                text not null,
  posted_at          timestamptz,
  first_seen_at      timestamptz default now(),
  prefilter_passed   boolean,
  prefilter_reason   text,           -- why it died. Needed to debug an over-aggressive filter.
  fit_score          numeric(3,1),
  eligibility        text,           -- eligible | plausible | unlikely | unclear | not_eligible
  eligibility_reason text,
  culture_flags      jsonb,          -- dealbreaker hits, surfaced regardless of score
  fit_reasons        jsonb,
  scored_at          timestamptz,
  status             text default 'new',  -- new|notified|applied|dismissed|interviewing|offer|rejected|ghosted
  dismiss_reason     text,           -- REQUIRED on dismiss. The only training data the scorer will ever get.
  applied_at         timestamptz,
  last_touched_at    timestamptz,    -- drives the 10-day stale nudge
  discord_message_id text,           -- so cards can be edited in place
  unique(company_id, external_id)
)

application_events (
  id          uuid pk,
  job_id      uuid fk -> jobs.id,
  event_type  text,                  -- status_change | note | interview | feedback
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz default now()
)

profile (
  id              int pk default 1,
  resume_text     text not null,
  portfolio_cases jsonb not null,
  linkedin_text   text,
  preferences     jsonb not null,
  updated_at      timestamptz
)
```

### Profile seeding

`/profile/` in the repo holds `resume.md`, `portfolio.md`, `linkedin.md`, `preferences.md`. A seed script parses them into the `profile` table on first run and on demand.

**Profile data is server-side only, always.** It contains a phone number, a personal email, and salary figures. It must never be bundled into the dashboard's client-side JavaScript. All dashboard reads go through a Netlify function.

---

## 8. Prefilter (deterministic, no LLM, free)

Kill the job if **any** are true:

1. Title doesn't match the design pattern (product designer, UX designer, UI designer, senior/staff/lead designer, design lead, interaction designer, experience designer, product design).
2. Wrong seniority in title: `intern`, `junior`, `associate`, `graduate`, `principal`, `director`, `VP`, `head of`, `manager`.
3. Location is an Indian city other than Gurgaon/NCR or Bengaluru, and the role is not remote.
4. `posted_at` older than 14 days.
5. Already exists by either dedup key.
6. Company `status = 'rejected'`.

Note: **global onsite roles are NOT killed here.** They go to the scorer, which judges eligibility (§10). A location filter that quietly deletes them is exactly the failure this system must not have.

Expected survivors: 5-20/day.

**Always write `prefilter_reason`, even on kills.** The most dangerous failure mode of this system is a filter silently eating the perfect role. The daily digest reports the kill count so a spike is visible.

---

## 9. Company intel dossier (cached, once per company, 60-day TTL)

Company reputation doesn't change hourly. Generate once, refresh every 60 days, reuse across every job from that company. This keeps cost near zero.

**Reddit (official API):** search the company across r/developersIndia, r/india, r/UXDesign, r/cscareerquestions, r/product_design.

**Glassdoor / AmbitionBox / Blind / Levels.fyi:** these block direct access. **Do not attempt to scrape them.** Query a search API (Serper or Brave) with `"{company}" glassdoor rating`, `"{company}" ambitionbox reviews`, `"{company}" senior product designer salary`, and extract from the **public search snippets**. Less complete than scraping, legal, won't break.

### The five culture questions (these are dealbreaker checks, not colour)

Ana's dealbreakers do not appear in job descriptions. They appear in reviews. The dossier must answer each explicitly:

1. **Is weekend work normal here?**
2. **Is this a six-day week / non-Mon-Fri schedule?**
3. **Is micromanagement a recurring complaint?**
4. **Are politics or bad leadership a recurring complaint?**
5. **How is work-life balance actually reported?**

Each returns `{ verdict, confidence: high|medium|low, evidence: [quotes or links] }`.

A confirmed hit on 1, 2, 3 or 4 is a **dealbreaker**. It caps the fit score and shows on the card regardless of how good the role is. A 9.0 fit at a company with credible reports of Saturday working is not a 9.0.

### Calibration instruction (bake into the intel prompt)

Reddit and Glassdoor skew angry about every employer, always. Weight **recurring, specific** complaints (a named six-day policy, repeated mentions of Saturday standups, three separate people describing the same manager) over the mere existence of complaints. Three angry posts among forty neutral ones is a normal company. **Return `thin_data` when there isn't enough to judge. Do not invent a narrative.** A false dealbreaker costs Ana a job she'd have loved; a missed one costs her a year of her life. Both are real. Say what you actually know.

### Compensation check

Pull the senior-designer salary band from search snippets. Set `comp_reachable` against Ana's private target CTC band (kept out of this public repo; lives in `profile/preferences.md` locally). This is noisy data, so it is a **flag on the card, not a filter**.

---

## 10. Eligibility for global onsite roles

Job descriptions almost never mention visa sponsorship, so **do not look for it.** Judge on two things instead.

**1. Country plausibility**
- Plausible: UAE, Singapore, Netherlands, Germany, Ireland, UK, Canada, Australia
- Hard / lottery-gated: USA (H-1B lottery; realistic mainly via internal transfer, O-1, cap-exempt)
- Rare: Japan, South Korea, most others

**2. Company evidence** (from the dossier's `hires_from_india`)
- Does the company have an India office? If yes, it likely transfers internally rather than hiring cold from India.
- Any evidence of relocation support, or of Indian hires who moved *from* India rather than already living locally?
- Does the listing require existing local work authorisation?

**Output states:** `eligible` (India-based or India-friendly remote), `plausible`, `unlikely`, `unclear`, `not_eligible` (explicitly excludes India).

Only `not_eligible` is silently suppressed. **`unclear` and `unlikely` are still surfaced, flagged.** Being honestly uncertain beats being confidently wrong.

---

## 11. Hosting: why not GitHub Pages

Rejected for two hard reasons, both of which are security problems, not preferences:

1. **Free Pages requires a public repo.** This repo contains a resume, a phone number, salary figures, and an application history. It cannot be public.
2. **Pages is static only.** A dashboard there must talk to Supabase from the browser, putting the database key in client-side JavaScript. With no login on the site, anyone who finds the URL reads the entire job search.

**Netlify** hosts from a private repo on the free tier and provides serverless functions, so keys stay server-side and profile data never reaches the browser. It does everything Pages was wanted for and none of the bad parts.

---

## 12. Discord (the primary interface)

**Setup:** Server Settings → Integrations → Webhooks → New Webhook → copy URL. Separately, create a Discord application with an **interactions endpoint URL** pointing at the Netlify function, so buttons work without a persistent bot process. Verify request signatures with `DISCORD_PUBLIC_KEY`.

### Channels

- `#alerts` — instant. Tier 1, score ≥ 8.5, eligible, no dealbreaker hit. 1-3 per week.
- `#digest` — 9am IST. Everything scored in the last 24h with score ≥ 6, ranked. Footer: prefilter kill count.
- `#pipeline` — cards move here on Applied. This is the tracker.
- `#discoveries` — Monday's new companies, approve/reject.

**If nothing clears the bar, send nothing.** Silence is information. Pinging on every job trains Ana to ignore the tool within two weeks.

### The card is the tracker row

There is no separate tracker to sync. Clicking Applied rewrites the same message in place (score badge → status badge) and moves it to `#pipeline`. The message *is* the record.

**Job card:** score, verdict, company, title, location, eligibility flag, `one_line_take`, Glassdoor/AmbitionBox ratings, comp flag, **culture flags shown regardless of score**, apply link.

**Buttons:** `Applied` · `Dismiss` (modal, **reason required**) · `Details` (expands strengths, gaps, lead case study, resume edits, full dossier into a thread) · `Open role`

**In `#pipeline`, buttons become:** `Update status` (modal: dropdown + note) · `Add note`

### Slash commands

- `/pipeline` — active applications and statuses
- `/status <company>` — modal to update status and add a note
- `/note <company>` — append interview feedback to `application_events`
- `/company <name>` — pull the dossier on demand

### The stale nudge

Anything in `#pipeline` untouched for 10 days is flagged in the daily digest. Silence from a company is the most common outcome in a job search and the easiest thing to lose track of. Nearly free to build.

---

## 13. Scorer (Claude API, survivors only)

**Model:** `claude-sonnet-4-6`
**Inputs:** job description, company row, company dossier, full `profile`.
**Output:** strict JSON. No prose, no markdown fences.

```json
{
  "fit_score": 8.5,
  "verdict": "apply" | "maybe" | "skip",
  "eligibility": "eligible" | "plausible" | "unlikely" | "unclear" | "not_eligible",
  "eligibility_reason": "one line",
  "culture_flags": ["dealbreaker hits from the dossier, with confidence"],
  "comp_flag": "one line if the band likely can't reach her target CTC",
  "strengths": ["3 specific reasons, naming her actual work, not generic praise"],
  "gaps": ["2-3 honest gaps between the JD and her profile"],
  "lead_case_study": "which portfolio case to lead with, and one line on why",
  "resume_edits": ["2-3 concrete line-level edits. Not 'tailor your resume'."],
  "one_line_take": "the honest sentence a friend would say about this role"
}
```

### Rubric

| Score | Meaning |
|---|---|
| 9-10 | Tier 1, matches her level and domain, her portfolio directly answers the JD, culture is clean. Drop everything. |
| 7.5-8.9 | Strong match, 1-2 stretch areas. Apply this week. |
| 6-7.4 | Plausible, but she's a stretch or it needs real resume work. Apply only if the pipeline is thin. |
| Below 6 | Do not apply. One line on why. |

**Hard cap:** a confirmed dealbreaker (weekend work, six-day week, high-confidence micromanagement or politics) caps the score at **5.9**, whatever else is true. Show the role anyway, with the reason. Ana decides, but she decides knowing.

### Calibration instruction

**Be honest, not encouraging.** A 6 dressed up as an 8 costs Ana a week of her life. Calibration matters more than kindness. Her profile is genuinely strong in compliance UX, funnel optimisation, and high-scale B2C fintech; it is genuinely thin in design systems, B2B depth, and shipped AI product work. Score accordingly. Do not inflate.

---

## 14. Build phases

**Strictly sequential. Each phase must run before the next starts.**

**Phase 1 (days 1-2): the pipe is alive.**
Repo, Supabase, schema. Greenhouse collector only, three hardcoded companies. No prefilter, no scorer. Fetch → write → post a raw list to Discord.
**Success: a real job posting appears in Discord.**

**Phase 2 (days 3-4): breadth and the filter.**
The other five ATS collectors. Channel B portal APIs. Prefilter. Seed the company list with **tier 1 and 2 only** (not all 160). Deploy the GitHub Actions cron.
**Success: hourly runs produce a small, sane, relevant list.**

**Phase 3 (days 5-8): the brain. This is the hard phase.**
Seed `/profile` into the database. Company intel dossier with the five culture questions, caching, and search-snippet extraction. Eligibility model. The scorer. Both notification tiers as rich embeds.
**Success: a scored digest arrives at 9am, the scores feel right, and a culture flag correctly fires on a company Ana already knows is rough.**

Budget extra time here. The dossier is doing most of the work in this system and it is the part most likely to be subtly wrong.

**Phase 4 (days 9-11): the loop closes.**
Netlify interactions endpoint. Buttons, modals, slash commands. Card-in-place editing. `#pipeline`. Stale nudges. Channel C aggregator. Discovery loop and the Monday digest.
**Success: Ana applies to something from Discord and never touches a spreadsheet.**

**Phase 5 (day 12+, only after Phases 1-4 run): the dashboard.**
Next.js on Netlify, reading through serverless functions. Three views: inbox, tracker, companies. Optional Supabase realtime.

**Constraint on Phase 5, stated deliberately:** three views, one afternoon, ugly is fine. By this point there will be twenty real applications in the database, so it gets designed against real data instead of imagined data. **Do not start it early. Do not build it in parallel.** Given a blank dashboard before the scorer works, the scorer will not get built.

Commit at every working checkpoint. If Phase 5 never happens, Phases 1-4 are a complete, useful product.

---

## 15. Environment variables

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
DISCORD_WEBHOOK_URL
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
SERPER_API_KEY              # or BRAVE_API_KEY
RAPIDAPI_KEY                # JSearch
REDDIT_CLIENT_ID
REDDIT_CLIENT_SECRET
APIFY_TOKEN                 # weekly discovery only
```

GitHub Actions secrets for the collector. Netlify env vars for the functions. **Never in code, never committed.** The repo is private. Build as if it weren't.

---

## 16. Known failure modes (build defensively from day one)

| Failure | Mitigation |
|---|---|
| An ATS changes its URL format; a company silently returns zero jobs forever | Log per-company job counts. Alert if a normally-productive company returns zero for 7 straight days. |
| The prefilter is too aggressive and eats the perfect role | Log every kill with its reason. Kill count in the daily digest. |
| The same job arrives from three channels with three IDs | Two-pass dedup, including normalised company + title in a 14-day window. |
| One company's server is down and kills the whole run | Every fetch in its own try/catch. One failure must never abort a run. |
| Claude returns malformed JSON | Retry once. On second failure, mark `score_failed` and surface the job **unscored** rather than dropping it. |
| The dossier invents a culture problem that isn't real | Confidence levels + evidence links on every verdict. `thin_data` is a valid answer. Ana can always click through to the source. |
| Rate limits from hammering 250 companies hourly | Staggered polling by tier. Portals every 2 hours. |
| Notification fatigue | Two tiers only. Silence when nothing clears the bar. |
| Cost creep from LLM calls | Prefilter kills 90% before any API call. Dossiers cached 60 days. Expect ~$5-10/month total. |

---

## 17. Deferred (v2+)

- **Score recalibration from outcomes.** After ~25 applications the tracker knows which fit-scores actually converted to interviews *for Ana*. Feed that back into the scorer. No commercial tool does this. It is the differentiator and the build-log story.
- Generic careers-page fetcher with LLM extraction, for Indian companies on Darwinbox, Keka, or custom pages.
- Interview recording upload, transcription, feedback analysis. Separate product.
- AI/design news digest. Probably never, and that's fine.
