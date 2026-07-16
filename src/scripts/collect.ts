// Phase 2 collector: the full hourly pipe.
//
//   fetch (6 ATS types, staggered by tier + 8 free portals, every 2h)
//     → dedup pass 1 (DB unique key) + pass 2 (normalised company+title, 14d)
//     → deterministic prefilter (PRD §8 — every kill logged with a reason)
//     → write everything to Supabase (kills included, for the audit trail)
//     → post survivors to Discord
//
//   npm run collect -- --dry-run             # sample companies + portals, no creds
//   npm run collect                          # real run against the companies table
//   npm run collect -- --tiers=1,2,3         # override the hour-based stagger
//   npm run collect -- --no-portals          # ATS only
//
// Stagger (UTC hour): tier 1 every run · tier 2 when hour % 4 == 0 · tier 3 once
// daily at 03:00 UTC (08:30 IST) · portals when hour % 2 == 0.

import type { CollectedJob } from '../lib/types.js';
import { prefilter, killBreakdown, type PrefilterResult } from '../lib/prefilter.js';
import { dedupPass2 } from '../lib/dedup.js';
import { fetchGreenhouse } from '../collectors/greenhouse.js';
import { fetchLever } from '../collectors/lever.js';
import { fetchAshby } from '../collectors/ashby.js';
import { fetchWorkable } from '../collectors/workable.js';
import { fetchRecruitee } from '../collectors/recruitee.js';
import { fetchSmartRecruiters } from '../collectors/smartrecruiters.js';
import { fetchWorkday } from '../collectors/workday.js';
import { fetchRemoteOk } from '../collectors/portals/remoteok.js';
import { fetchRemotive } from '../collectors/portals/remotive.js';
import { fetchHimalayas } from '../collectors/portals/himalayas.js';
import { fetchWwr } from '../collectors/portals/wwr.js';
import { fetchArbeitnow } from '../collectors/portals/arbeitnow.js';
import { fetchJobicy } from '../collectors/portals/jobicy.js';
import { fetchWorkingNomads } from '../collectors/portals/workingnomads.js';
import { fetchHn } from '../collectors/portals/hn.js';

const DRY_RUN = process.argv.includes('--dry-run');
const NO_PORTALS = process.argv.includes('--no-portals');
const TIER_OVERRIDE = process.argv.find((a) => a.startsWith('--tiers='));
const POST_LIMIT = 20;

const ATS_FETCHERS: Record<string, (name: string, token: string) => Promise<CollectedJob[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  recruitee: fetchRecruitee,
  smartrecruiters: fetchSmartRecruiters,
  workday: fetchWorkday,
};

const PORTAL_FETCHERS: Record<string, () => Promise<CollectedJob[]>> = {
  remoteok: fetchRemoteOk,
  remotive: fetchRemotive,
  himalayas: fetchHimalayas,
  wwr: fetchWwr,
  arbeitnow: fetchArbeitnow,
  jobicy: fetchJobicy,
  workingnomads: fetchWorkingNomads,
  hn: fetchHn,
};

// Dry-run sample: known-good tokens across ATS types, so the whole pipe can be
// exercised with zero credentials. The real run reads the companies table.
const DRY_RUN_COMPANIES = [
  { id: 'dry-1', name: 'Groww', tier: 1, atsType: 'greenhouse', atsToken: 'groww' },
  { id: 'dry-2', name: 'PhonePe', tier: 1, atsType: 'greenhouse', atsToken: 'phonepe' },
  { id: 'dry-3', name: 'Figma', tier: 1, atsType: 'greenhouse', atsToken: 'figma' },
  { id: 'dry-4', name: 'Cred', tier: 1, atsType: 'lever', atsToken: 'cred' },
  { id: 'dry-5', name: 'Meesho', tier: 2, atsType: 'lever', atsToken: 'meesho' },
  { id: 'dry-6', name: 'Notion', tier: 1, atsType: 'ashby', atsToken: 'notion' },
  { id: 'dry-7', name: 'Ramp', tier: 2, atsType: 'ashby', atsToken: 'ramp' },
  { id: 'dry-8', name: 'Razorpay', tier: 1, atsType: 'greenhouse', atsToken: 'razorpaysoftwareprivatelimited' },
  { id: 'dry-9', name: 'PayPal', tier: 2, atsType: 'workday', atsToken: 'paypal|paypal.wd1.myworkdayjobs.com|jobs' },
];

function tiersForThisRun(): number[] {
  if (TIER_OVERRIDE) {
    return TIER_OVERRIDE.replace('--tiers=', '')
      .split(',')
      .map(Number)
      .filter((n) => n >= 1 && n <= 3);
  }
  const hour = new Date().getUTCHours();
  const tiers = [1];
  if (hour % 4 === 0) tiers.push(2);
  if (hour === 3) tiers.push(3);
  return tiers;
}

function portalsThisRun(): boolean {
  if (NO_PORTALS) return false;
  if (DRY_RUN || TIER_OVERRIDE) return true;
  return new Date().getUTCHours() % 2 === 0;
}

async function main(): Promise<void> {
  const tiers = tiersForThisRun();
  const doPortals = portalsThisRun();
  console.log(`[collect] tiers=${tiers.join(',')} portals=${doPortals} dry-run=${DRY_RUN}`);

  // ---- 1. Which companies to poll -----------------------------------------
  let companies = DRY_RUN_COMPANIES;
  if (!DRY_RUN) {
    const { getActiveCompanies } = await import('../lib/store.js');
    companies = await getActiveCompanies(tiers);
  } else {
    companies = DRY_RUN_COMPANIES.filter((c) => tiers.includes(c.tier));
  }
  console.log(`[collect] polling ${companies.length} companies + ${doPortals ? Object.keys(PORTAL_FETCHERS).length : 0} portals`);

  // ---- 2. Fetch — every fetch isolated; one failure never aborts the run --
  const collected: CollectedJob[] = [];
  const pollCounts: { companyId: string; source: string; count: number }[] = [];

  await Promise.all(
    companies.map(async (c) => {
      const fetcher = ATS_FETCHERS[c.atsType];
      if (!fetcher) return;
      try {
        const jobs = await fetcher(c.name, c.atsToken);
        pollCounts.push({ companyId: c.id, source: c.atsType, count: jobs.length });
        collected.push(...jobs);
        console.log(`[collect] ${c.name.padEnd(18)} ${String(jobs.length).padStart(3)} jobs (${c.atsType})`);
      } catch (err) {
        console.error(`[collect] ${c.name} FAILED: ${(err as Error).message}`);
      }
    }),
  );

  if (doPortals) {
    await Promise.all(
      Object.entries(PORTAL_FETCHERS).map(async ([name, fetcher]) => {
        try {
          const jobs = await fetcher();
          collected.push(...jobs);
          console.log(`[collect] portal:${name.padEnd(12)} ${String(jobs.length).padStart(3)} jobs`);
        } catch (err) {
          console.error(`[collect] portal:${name} FAILED: ${(err as Error).message}`);
        }
      }),
    );
  }
  console.log(`[collect] ${collected.length} jobs fetched total`);

  // ---- 3. Dedup pass 2 (cross-source, 14-day window) -----------------------
  let recentKeys: { companyName: string; title: string }[] = [];
  let rejectedCompanies = new Set<string>();
  if (!DRY_RUN) {
    const { getRecentJobKeys, getRejectedCompanySet } = await import('../lib/store.js');
    [recentKeys, rejectedCompanies] = await Promise.all([
      getRecentJobKeys(14),
      getRejectedCompanySet(),
    ]);
  }
  const { unique, duplicates } = dedupPass2(collected, recentKeys);

  // ---- 4. Prefilter (PRD §8) ------------------------------------------------
  const evaluated: { job: CollectedJob; verdict: PrefilterResult }[] = unique.map((job) => ({
    job,
    verdict: prefilter(job, { rejectedCompanies }),
  }));
  // Duplicates are stored as kills too — the audit trail must explain every drop.
  for (const d of duplicates) {
    evaluated.push({ job: d.job, verdict: { passed: false, reason: d.reason } });
  }

  const survivors = evaluated.filter((e) => e.verdict.passed);
  const kills = evaluated.filter((e) => !e.verdict.passed);
  console.log(`[collect] prefilter: ${survivors.length} survive · ${kills.length} killed`);
  for (const [family, n] of Object.entries(killBreakdown(evaluated.map((e) => e.verdict)))) {
    console.log(`           kill: ${family} × ${n}`);
  }

  if (DRY_RUN) {
    console.log('\n[collect] survivors:');
    for (const s of survivors.slice(0, POST_LIMIT)) {
      console.log(`   • ${s.job.title} — ${s.job.companyName}${s.job.location ? ` · ${s.job.location}` : ''} [${s.job.source}]`);
      console.log(`     ${s.job.url}`);
    }
    if (survivors.length > POST_LIMIT) console.log(`   … +${survivors.length - POST_LIMIT} more`);
    console.log('\n[collect] --dry-run: skipped Supabase write and Discord post.');
    return;
  }

  // ---- 5. Write everything (survivors + kills), Discord only the new survivors
  const {
    ensureCandidateCompanies,
    writeJobs,
    markNotified,
    logPoll,
  } = await import('../lib/store.js');
  const { postRawList } = await import('../lib/discord.js');

  // ATS companies already exist; portal jobs may introduce new candidate companies.
  const companyIds = new Map(companies.map((c) => [c.name, c.id]));
  const unknownNames = evaluated
    .map((e) => e.job.companyName)
    .filter((n) => !companyIds.has(n));
  const candidateIds = await ensureCandidateCompanies(unknownNames);
  for (const [name, id] of candidateIds) companyIds.set(name, id);

  const inserted = await writeJobs(companyIds, evaluated);
  const newSurvivors = inserted.filter((j) => j.prefilterPassed);
  console.log(`[collect] wrote ${inserted.length} new rows (${newSurvivors.length} survivors, ${inserted.length - newSurvivors.length} kill records)`);

  await Promise.all(pollCounts.map((p) => logPoll(p.companyId, p.source, p.count)));

  await postRawList(
    newSurvivors.slice(0, POST_LIMIT).map((j) => ({
      company: j.companyName,
      title: j.title,
      location: j.location,
      url: j.url,
    })),
  );
  await markNotified(newSurvivors.slice(0, POST_LIMIT).map((j) => j.id));
  console.log(
    newSurvivors.length > 0
      ? `[collect] posted ${Math.min(newSurvivors.length, POST_LIMIT)} to Discord.`
      : '[collect] nothing new cleared the bar — posted nothing (silence is information).',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
