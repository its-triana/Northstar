// Parses profile/*.md into the single-row `profile` table (PRD §7).
// The /score command reads the local files directly (always fresh); this DB copy
// exists for the Phase 4+ surfaces (Netlify functions, dashboard) which must
// never bundle profile data client-side.
//
//   npm run seed:profile

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSupabase } from '../lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(name: string): string {
  return readFileSync(join(root, 'profile', name), 'utf8');
}

// portfolio.md holds five case studies split by "# Case Study N:" headings.
function parseCases(portfolio: string): { title: string; body: string }[] {
  const parts = portfolio.split(/^# (?=Case Study)/m).slice(1);
  return parts.map((p) => {
    const [first, ...rest] = p.split('\n');
    return { title: first.trim(), body: rest.join('\n').trim() };
  });
}

async function main(): Promise<void> {
  const resume = read('resume.md');
  const portfolio = read('portfolio.md');
  const linkedin = read('linkedin.md');
  const preferences = read('preferences.md');

  const cases = parseCases(portfolio);
  console.log(`[profile] parsed ${cases.length} case studies from portfolio.md`);

  const { error } = await getSupabase().from('profile').upsert({
    id: 1,
    resume_text: resume,
    portfolio_cases: cases,
    linkedin_text: linkedin,
    preferences: { raw: preferences },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`[profile] upsert failed: ${error.message}`);
  console.log('[profile] seeded into Supabase (row id=1).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
