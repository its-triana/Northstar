// Daily no-LLM nudges (runs from GitHub Actions, free):
//   1. "N roles waiting to be scored" — reminds Ana to run /score
//   2. Stale applications — anything applied/interviewing untouched for 10+ days
// Posts nothing when there's nothing to say. Silence is information.
//
//   npm run nudges

import { getSupabase } from '../lib/supabase.js';
import { postEmbeds, type Embed } from '../lib/discord.js';

const STALE_DAYS = 10;

async function main(): Promise<void> {
  const sb = getSupabase();
  const embeds: Embed[] = [];

  const { count: unscored } = await sb
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('prefilter_passed', true)
    .eq('score_status', 'unscored');

  if ((unscored ?? 0) > 0) {
    embeds.push({
      title: `🧠 ${unscored} role${unscored === 1 ? '' : 's'} waiting to be scored`,
      description: 'Open the repo in Claude Code and run `/score` to get today\'s ranked digest.',
      color: 0x9b59b6,
    });
  }

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  const { data: stale } = await sb
    .from('jobs')
    .select('title, last_touched_at, companies(name)')
    .in('status', ['applied', 'interviewing'])
    .lt('last_touched_at', staleCutoff)
    .order('last_touched_at', { ascending: true })
    .limit(15);

  if (stale?.length) {
    embeds.push({
      title: `⏳ ${stale.length} application${stale.length === 1 ? '' : 's'} gone quiet (${STALE_DAYS}+ days)`,
      description: stale
        .map((j) => {
          const days = Math.floor((Date.now() - Date.parse(j.last_touched_at as string)) / 86_400_000);
          return `• **${(j.companies as { name?: string } | null)?.name}** — ${j.title} · ${days}d silent`;
        })
        .join('\n')
        .slice(0, 3500),
      color: 0xe67e22,
    });
  }

  if (embeds.length === 0) {
    console.log('[nudges] nothing to nudge about.');
    return;
  }
  await postEmbeds(embeds);
  console.log(`[nudges] posted ${embeds.length} nudge(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
