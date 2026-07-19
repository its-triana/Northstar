// Prints Ana's profile from the Supabase `profile` table as JSON on stdout.
// Exists for cloud /score runs: the real profile/*.md files are git-ignored
// (they hold PII), so a cloud checkout doesn't have them — the DB copy,
// seeded by `npm run seed:profile`, is the fallback source of truth there.
//
//   npm run -s score:profile

import { getSupabase } from '../lib/supabase.js';

async function main(): Promise<void> {
  const { data, error } = await getSupabase()
    .from('profile')
    .select('resume_text, portfolio_cases, linkedin_text, preferences, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('profile table is empty — run `npm run seed:profile` from the machine that has profile/*.md');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
