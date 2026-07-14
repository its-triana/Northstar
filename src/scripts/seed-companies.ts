// Seeds the companies table from data/companies.seed.csv (tier 1+2 by default,
// per the build plan) and runs ATS discovery on each so they become pollable.
//
//   npm run seed:companies -- --dry-run      # discovery only, prints results, no DB
//   npm run seed:companies                   # discovers + writes to Supabase
//   npm run seed:companies -- --all          # include tier 3 too
//
// Discovery is the slow part (~6 endpoints × ~3 slug variants per company), so
// companies run with limited concurrency. One-time cost; re-runs are idempotent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverAts } from '../lib/ats-discovery.js';
import type { SeedCompany } from '../lib/store.js';

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_TIER3 = process.argv.includes('--all');
const CONCURRENCY = 8;

interface CsvRow {
  name: string;
  group: string;
  tier: number;
  notes: string;
}

function parseCsv(): CsvRow[] {
  const csvPath = join(dirname(fileURLToPath(import.meta.url)), '../../data/companies.seed.csv');
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1); // drop header
  return lines
    .map((line) => {
      const [name, group, tier, ...notes] = line.split(',');
      return {
        name: name?.trim() ?? '',
        group: group?.trim() ?? '',
        tier: Number(tier) || 3,
        notes: notes.join(',').trim(),
      };
    })
    .filter((r) => r.name);
}

async function main(): Promise<void> {
  const all = parseCsv();
  const targets = all.filter((r) => INCLUDE_TIER3 || r.tier <= 2);
  console.log(
    `[seed] ${all.length} companies in CSV → seeding ${targets.length} (tier ${INCLUDE_TIER3 ? '1-3' : '1+2'})`,
  );

  // Discovery with limited concurrency.
  const results: (SeedCompany & { group: string; found: boolean })[] = [];
  let done = 0;
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const match = await discoverAts(row.name);
        done++;
        if (done % 10 === 0) console.log(`[seed] …${done}/${targets.length} probed`);
        results.push({
          name: row.name,
          tier: row.tier,
          group: row.group,
          atsType: match?.atsType,
          token: match?.token,
          hqRegion: row.group.startsWith('indian') ? 'India' : 'Global',
          found: !!match,
        });
      }
    }),
  );

  const found = results.filter((r) => r.found);
  console.log(`\n[seed] ATS discovered for ${found.length}/${results.length} companies:`);
  for (const r of [...found].sort((a, b) => (a.tier ?? 3) - (b.tier ?? 3))) {
    console.log(`   T${r.tier} ${r.name.padEnd(22)} → ${r.atsType}:${r.token}`);
  }
  const missing = results.filter((r) => !r.found);
  console.log(
    `\n[seed] no public ATS found for ${missing.length} (likely Darwinbox/Keka/custom — deferred layer):`,
  );
  console.log(`   ${missing.map((r) => r.name).join(', ')}`);

  if (DRY_RUN) {
    console.log('\n[seed] --dry-run: nothing written.');
    return;
  }

  const { ensureCompanies } = await import('../lib/store.js');
  // Companies without a discovered ATS are still seeded (portals may cover them,
  // and the deferred careers-page fetcher will need them) — they just can't be polled.
  const map = await ensureCompanies(results);
  console.log(`\n[seed] ${map.size} companies upserted to Supabase (${found.length} pollable).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
