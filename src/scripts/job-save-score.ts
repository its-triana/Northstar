// Saves one job's score JSON (shape: src/scoring/rubric.md) to the jobs row.
// Validates strictly and re-applies the dealbreaker cap defensively — judgment
// happens in the /score command, but the cap is too important to trust prose.
//
//   npm run score:save -- --job=<uuid> --file=/tmp/score.json
//   npm run score:save -- --job=<uuid> --failed      # malformed judgment → surface unscored

import { readFileSync } from 'node:fs';
import { getSupabase } from '../lib/supabase.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const ELIGIBILITY = ['eligible', 'plausible', 'unlikely', 'unclear', 'not_eligible'];
const VERDICTS = ['apply', 'maybe', 'skip'];

async function main(): Promise<void> {
  const jobId = arg('job');
  if (!jobId) throw new Error('usage: --job=<uuid> (--file=score.json | --failed)');
  const sb = getSupabase();

  if (process.argv.includes('--failed')) {
    // PRD §16: on repeated malformed judgment, surface the job unscored, never drop it.
    const { error } = await sb
      .from('jobs')
      .update({ score_status: 'score_failed', scored_at: new Date().toISOString() })
      .eq('id', jobId);
    if (error) throw new Error(error.message);
    console.log(`[score] ${jobId} marked score_failed (will surface unscored)`);
    return;
  }

  const file = arg('file');
  if (!file) throw new Error('usage: --job=<uuid> --file=score.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));

  // ---- strict validation ---------------------------------------------------
  if (typeof s.fit_score !== 'number' || s.fit_score < 0 || s.fit_score > 10)
    throw new Error('fit_score must be a number 0-10');
  if (!VERDICTS.includes(s.verdict)) throw new Error(`verdict must be one of ${VERDICTS.join('|')}`);
  if (!ELIGIBILITY.includes(s.eligibility))
    throw new Error(`eligibility must be one of ${ELIGIBILITY.join('|')}`);
  if (!Array.isArray(s.strengths) || !Array.isArray(s.gaps) || !Array.isArray(s.culture_flags))
    throw new Error('strengths, gaps, culture_flags must be arrays');
  if (typeof s.one_line_take !== 'string' || !s.one_line_take)
    throw new Error('one_line_take required');

  // ---- defensive dealbreaker cap (rubric hard rule #1) ----------------------
  // If any culture flag is marked high-confidence, the score cannot exceed 5.9.
  let fit = s.fit_score;
  const confirmedDealbreaker = (s.culture_flags as string[]).some((f) => /high[\s-]*confidence|confirmed/i.test(f));
  if (confirmedDealbreaker && fit > 5.9) {
    console.error(`[score] dealbreaker cap applied: ${fit} → 5.9`);
    fit = 5.9;
  }

  const { error } = await sb
    .from('jobs')
    .update({
      fit_score: fit,
      eligibility: s.eligibility,
      eligibility_reason: s.eligibility_reason ?? null,
      culture_flags: s.culture_flags,
      fit_reasons: s, // full score JSON, for the Details view and the dashboard
      scored_at: new Date().toISOString(),
      score_status: 'scored',
    })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
  console.log(`[score] saved ${fit.toFixed(1)} (${s.verdict}, ${s.eligibility}) for ${jobId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
