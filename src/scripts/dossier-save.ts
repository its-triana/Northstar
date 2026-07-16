// Saves a researched company dossier into company_intel (60-day cache).
// The dossier JSON (shape: src/scoring/dossier-prompt.md) arrives via a file.
//
//   npm run score:save-dossier -- --company="Monzo" --file=/tmp/dossier.json

import { readFileSync } from 'node:fs';
import { getSupabase } from '../lib/supabase.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const CULTURE_KEYS = ['weekend_work', 'six_day_week', 'micromanagement', 'politics_leadership', 'wlb'] as const;

async function main(): Promise<void> {
  const company = arg('company');
  const file = arg('file');
  if (!company || !file) throw new Error('usage: --company="Name" --file=dossier.json');

  const d = JSON.parse(readFileSync(file, 'utf8'));

  // Validate: the five culture questions must each be {verdict, confidence, evidence[]}.
  for (const k of CULTURE_KEYS) {
    const v = d[k];
    if (!v || typeof v.verdict !== 'string' || !['high', 'medium', 'low'].includes(v.confidence) || !Array.isArray(v.evidence)) {
      throw new Error(`dossier invalid: "${k}" must be {verdict, confidence: high|medium|low, evidence[]}`);
    }
  }

  const sb = getSupabase();
  const { data: rows, error: findErr } = await sb.from('companies').select('id').eq('name', company).limit(1);
  if (findErr) throw new Error(findErr.message);
  if (!rows?.length) throw new Error(`company not found: ${company}`);

  const { error } = await sb.from('company_intel').upsert({
    company_id: rows[0].id,
    glassdoor_rating: d.glassdoor_rating ?? null,
    ambitionbox_rating: d.ambitionbox_rating ?? null,
    salary_band_senior: d.salary_band_senior ?? null,
    comp_reachable: d.comp_reachable ?? 'unknown',
    weekend_work: d.weekend_work,
    six_day_week: d.six_day_week,
    micromanagement: d.micromanagement,
    politics_leadership: d.politics_leadership,
    wlb: d.wlb,
    design_culture: d.design_culture ?? null,
    hires_from_india: d.hires_from_india ?? null,
    reddit_summary: d.reddit_summary ?? null,
    reddit_sentiment: d.reddit_sentiment ?? 'thin_data',
    red_flags: d.red_flags ?? [],
    funding_news: d.funding_news ?? null,
    sources: d.sources ?? [],
    refreshed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  console.log(`[dossier] saved for ${company}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
