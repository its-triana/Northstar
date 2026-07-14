-- Job Track OS — database schema
-- Source of truth is PRD §7. Run this ONCE in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Free-tier additions beyond the PRD, both for the §16 failure modes:
--   * company_poll_log   — detect a normally-productive company returning zero for days
--   * jobs.score_status  — surface a role unscored rather than dropping it if judgment fails

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
create table if not exists companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  domain         text,
  ats_type       text,          -- greenhouse|lever|ashby|workable|recruitee|smartrecruiters|none
  ats_token      text,
  tier           int,           -- 1 dream, 2 strong, 3 acceptable. Drives polling frequency.
  hq_region      text,
  funding_stage  text,
  status         text not null default 'candidate',  -- candidate | active | rejected
  discovered_via text,          -- seed | portal | aggregator
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
create table if not exists company_intel (
  company_id           uuid primary key references companies(id) on delete cascade,
  glassdoor_rating     numeric,
  ambitionbox_rating   numeric,
  salary_band_senior   text,     -- what a senior designer plausibly earns here
  comp_reachable       text,     -- likely | unlikely | unknown (vs her private target CTC band)
  weekend_work         jsonb,    -- { verdict, confidence, evidence[] }
  six_day_week         jsonb,
  micromanagement      jsonb,
  politics_leadership  jsonb,
  wlb                  jsonb,
  design_culture       text,     -- real design org, or design-as-a-service
  hires_from_india     jsonb,    -- { verdict, confidence, evidence[] } (global onsite only)
  reddit_summary       text,
  reddit_sentiment     text,     -- positive | mixed | negative | thin_data
  red_flags            jsonb,
  funding_news         text,
  sources              jsonb,    -- links, so Ana can verify anything that matters
  refreshed_at         timestamptz
);

-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references companies(id) on delete cascade,
  external_id        text not null,
  source             text not null,  -- which channel found it
  title              text not null,
  location           text,
  remote_type        text,           -- remote | hybrid | onsite | unknown
  description        text,
  url                text not null,
  posted_at          timestamptz,
  first_seen_at      timestamptz not null default now(),
  prefilter_passed   boolean,
  prefilter_reason   text,           -- why it died. Needed to debug an over-aggressive filter.
  fit_score          numeric(3,1),
  eligibility        text,           -- eligible | plausible | unlikely | unclear | not_eligible
  eligibility_reason text,
  culture_flags      jsonb,          -- dealbreaker hits, surfaced regardless of score
  fit_reasons        jsonb,
  scored_at          timestamptz,
  score_status       text not null default 'unscored',  -- scored | unscored | score_failed
  status             text not null default 'new',       -- new|notified|applied|dismissed|interviewing|offer|rejected|ghosted
  dismiss_reason     text,           -- REQUIRED on dismiss. The only training data the scorer will ever get.
  applied_at         timestamptz,
  last_touched_at    timestamptz,    -- drives the 10-day stale nudge
  discord_message_id text,           -- so cards can be edited in place
  unique (company_id, external_id)
);
create index if not exists jobs_status_idx      on jobs (status);
create index if not exists jobs_first_seen_idx  on jobs (first_seen_at desc);
create index if not exists jobs_score_status_idx on jobs (score_status);

-- ---------------------------------------------------------------------------
create table if not exists application_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs(id) on delete cascade,
  event_type  text,             -- status_change | note | interview | feedback
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists application_events_job_idx on application_events (job_id);

-- ---------------------------------------------------------------------------
create table if not exists profile (
  id              int primary key default 1,
  resume_text     text not null,
  portfolio_cases jsonb not null,
  linkedin_text   text,
  preferences     jsonb not null,
  updated_at      timestamptz,
  constraint profile_singleton check (id = 1)
);

-- ---------------------------------------------------------------------------
create table if not exists company_poll_log (
  id          bigint generated always as identity primary key,
  company_id  uuid references companies(id) on delete cascade,
  source      text,
  job_count   int,
  polled_at   timestamptz not null default now()
);
create index if not exists company_poll_log_company_idx on company_poll_log (company_id, polled_at desc);

-- Note on security: all access is server-side via the service key (which bypasses RLS),
-- and the Phase 6 dashboard reads through Netlify functions, never the browser. RLS is
-- therefore left off for this single-user private system; revisit if that ever changes.
