// Phase 1 collector: the whole pipe, end to end, on three hardcoded companies.
//   fetch (Greenhouse) → write (Supabase) → notify (Discord webhook)
//
//   npm run collect -- --dry-run   # fetch + print only. No creds needed.
//   npm run collect                # real run: writes to Supabase, posts to Discord.
//
// Phase 2 replaces the hardcoded list with the seeded `companies` table, adds the
// other collectors, real dedup and the deterministic prefilter.

import { fetchGreenhouse } from '../collectors/greenhouse.js';
import type { CollectedJob } from '../lib/types.js';
import type { SeedCompany } from '../lib/store.js';

// Three companies that resolved on Greenhouse in the ATS probe.
const PHASE1_COMPANIES: SeedCompany[] = [
  { name: 'Groww', token: 'groww', tier: 1, atsType: 'greenhouse' },
  { name: 'PhonePe', token: 'phonepe', tier: 1, atsType: 'greenhouse' },
  { name: 'Figma', token: 'figma', tier: 1, atsType: 'greenhouse' },
];

const DRY_RUN = process.argv.includes('--dry-run');
const POST_LIMIT = 15; // keep the Phase-1 raw list readable

// A LIGHT title match, NOT the Phase 2 prefilter. Just enough to keep the raw
// list to design roles instead of dumping every open req.
function looksLikeDesign(title: string): boolean {
  return /\bdesign(er|ers|ing)?\b|\bux\b|\bui\b/i.test(title);
}

async function main(): Promise<void> {
  const collected: CollectedJob[] = [];

  for (const c of PHASE1_COMPANIES) {
    // Each fetch in its own try/catch: one company failing must never abort the run (§16).
    try {
      const all = await fetchGreenhouse(c.name, c.token!);
      const design = all.filter((j) => looksLikeDesign(j.title));
      console.log(`[collect] ${c.name.padEnd(10)} ${all.length} jobs → ${design.length} design`);
      collected.push(...design);
    } catch (err) {
      console.error(`[collect] ${c.name} FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`[collect] ${collected.length} design roles collected total`);

  if (DRY_RUN) {
    for (const j of collected.slice(0, POST_LIMIT)) {
      console.log(`   • ${j.title} — ${j.companyName}${j.location ? ` · ${j.location}` : ''}`);
      console.log(`     ${j.url}`);
    }
    if (collected.length > POST_LIMIT) console.log(`   … +${collected.length - POST_LIMIT} more`);
    console.log('[collect] --dry-run: skipped Supabase write and Discord post.');
    return;
  }

  // Real run — pull in credential-backed modules only now.
  const { writeJobs } = await import('../lib/store.js');
  const { postRawList } = await import('../lib/discord.js');

  const inserted = await writeJobs(PHASE1_COMPANIES, collected);
  console.log(`[collect] ${inserted.length} new job(s) written to Supabase`);

  await postRawList(
    inserted.slice(0, POST_LIMIT).map((j) => ({
      company: j.companyName,
      title: j.title,
      location: j.location,
      url: j.url,
    })),
  );
  console.log(
    inserted.length > 0
      ? `[collect] posted ${Math.min(inserted.length, POST_LIMIT)} to Discord.`
      : '[collect] nothing new — posted nothing (silence is information).',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
