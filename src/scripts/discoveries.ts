// The Monday discovery digest (PRD §4, the discovery loop):
// portal-found companies that produced at least one prefilter survivor are
// candidates. Each gets ATS discovery (so approval makes it directly pollable)
// and an approve/reject card in #discoveries. Approve → active (tier 3 poll).
// Reject → never surfaced again. Un-actioned candidates reappear next Monday.
//
//   npm run discoveries

import { getSupabase } from '../lib/supabase.js';
import { env } from '../lib/config.js';
import { discoverAts } from '../lib/ats-discovery.js';
import { postEmbeds, type Embed } from '../lib/discord.js';

async function main(): Promise<void> {
  const sb = getSupabase();

  const { data: candidates, error } = await sb
    .from('companies')
    .select('id, name, ats_type, ats_token, jobs!inner(id, title, prefilter_passed)')
    .eq('status', 'candidate')
    .eq('jobs.prefilter_passed', true);
  if (error) throw new Error(error.message);

  const unique = new Map((candidates ?? []).map((c) => [c.id as string, c]));
  if (unique.size === 0) {
    console.log('[discoveries] no candidates with surviving roles — nothing to post.');
    return;
  }
  console.log(`[discoveries] ${unique.size} candidate companies to present`);

  const botMode = !!(env('DISCORD_BOT_TOKEN') && env('DISCORD_CHANNEL_DISCOVERIES'));

  for (const c of unique.values()) {
    // Fill in ATS discovery so an approval is immediately pollable.
    let ats = c.ats_type && c.ats_token ? { atsType: c.ats_type, token: c.ats_token } : null;
    if (!ats) {
      ats = await discoverAts(c.name as string);
      if (ats) {
        await sb.from('companies').update({ ats_type: ats.atsType, ats_token: ats.token }).eq('id', c.id);
      }
    }
    const roles = (c.jobs as { title: string }[]).slice(0, 3).map((j) => `• ${j.title}`).join('\n');
    const embed: Embed = {
      title: `🔍 New company discovered: ${c.name}`,
      description:
        `Found via portals with surviving design role(s):\n${roles}\n\n` +
        (ats ? `✅ Pollable directly (${ats.atsType})` : '⚠️ No public ATS found — portal coverage only'),
      color: 0x9b59b6,
    };

    if (botMode) {
      const { postCard } = await import('../lib/discord-rest.js');
      const { requireEnv } = await import('../lib/config.js');
      await postCard(requireEnv('DISCORD_CHANNEL_DISCOVERIES'), [embed], [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Approve — poll it', custom_id: `co:approve:${c.id}` },
            { type: 2, style: 4, label: 'Reject — never again', custom_id: `co:reject:${c.id}` },
          ],
        },
      ]);
    } else {
      await postEmbeds([embed], undefined);
    }
  }
  console.log(`[discoveries] posted ${unique.size} candidate card(s)${botMode ? ' with buttons' : ' (webhook fallback, no buttons)'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
