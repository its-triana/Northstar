// Posts the ranked digest of freshly-scored jobs to Discord as rich embeds.
// not_eligible is suppressed (PRD §10 — the only silently-suppressed state);
// everything else shows, ranked by score, culture flags always visible.
//
//   npm run score:digest              # jobs scored in the last 24h
//   npm run score:digest -- --hours=48

import { getSupabase } from '../lib/supabase.js';
import { postEmbeds, type Embed } from '../lib/discord.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function color(score: number): number {
  if (score >= 8.5) return 0x2ecc71; // green — drop everything
  if (score >= 7.5) return 0x3498db; // blue — apply this week
  if (score >= 6) return 0xf1c40f; // yellow — pipeline filler
  return 0x95a5a6; // grey — skip
}

async function main(): Promise<void> {
  const hours = Number(arg('hours') ?? 24);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const sb = getSupabase();

  const { data: jobs, error } = await sb
    .from('jobs')
    .select('id, title, location, url, fit_score, eligibility, eligibility_reason, culture_flags, fit_reasons, score_status, companies(name, tier)')
    .gte('scored_at', since)
    .in('score_status', ['scored', 'score_failed'])
    .order('fit_score', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  const visible = (jobs ?? []).filter((j) => j.eligibility !== 'not_eligible');
  const suppressed = (jobs ?? []).length - visible.length;

  // Prefilter kill count over the same window — the §8 transparency footer.
  const { count: killCount } = await sb
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('prefilter_passed', false)
    .gte('first_seen_at', since);

  if (visible.length === 0) {
    console.log('[digest] nothing scored in window — posting nothing (silence is information).');
    return;
  }

  const embeds: Embed[] = visible.map((j) => {
    const c = j.companies as { name?: string; tier?: number } | null;
    const s = (j.fit_reasons ?? {}) as Record<string, unknown>;
    const failed = j.score_status === 'score_failed';
    const scoreStr = failed ? '⚠️ unscored' : `${Number(j.fit_score).toFixed(1)}`;
    const flags = (j.culture_flags as string[] | null) ?? [];

    const fields: Embed['fields'] = [
      { name: 'Score', value: scoreStr, inline: true },
      { name: 'Eligibility', value: `${j.eligibility ?? '—'}`, inline: true },
      { name: 'Location', value: j.location || '—', inline: true },
    ];
    if (flags.length) fields.push({ name: '🚩 Culture flags', value: flags.join('\n').slice(0, 1000) });
    if (s.comp_flag) fields.push({ name: '💰 Comp', value: String(s.comp_flag).slice(0, 1000) });
    if (s.lead_case_study) fields.push({ name: '🎯 Lead with', value: String(s.lead_case_study).slice(0, 1000) });

    return {
      title: `${c?.name ?? '?'} — ${j.title}`.slice(0, 250),
      url: j.url as string,
      description: String(s.one_line_take ?? (failed ? 'Scoring failed twice — read the JD yourself; the pipe refused to guess.' : '')).slice(0, 300),
      color: failed ? 0xe74c3c : color(Number(j.fit_score ?? 0)),
      fields,
    };
  });

  const header =
    `**📋 Scored digest — ${visible.length} role${visible.length === 1 ? '' : 's'}**` +
    (suppressed ? ` · ${suppressed} not-eligible hidden` : '') +
    (killCount ? ` · prefilter killed ${killCount} in ${hours}h` : '');

  await postEmbeds(embeds, header);
  console.log(`[digest] posted ${embeds.length} scored roles (${suppressed} suppressed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
