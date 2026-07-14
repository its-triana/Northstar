import { requireEnv } from './config.js';

export interface RawJobLine {
  company: string;
  title: string;
  location?: string;
  url: string;
}

// Phase 1: post a plain list of freshly-collected roles to the Discord webhook.
// Rich embeds, buttons and per-tier routing arrive in Phase 3/4.
export async function postRawList(jobs: RawJobLine[]): Promise<void> {
  if (jobs.length === 0) return; // Silence is information (PRD §12). Post nothing.

  const webhook = requireEnv('DISCORD_WEBHOOK_URL');
  const header = `**${jobs.length} new design role${jobs.length === 1 ? '' : 's'} collected**`;
  const lines = jobs.map(
    (j) => `• **${j.title}** — ${j.company}${j.location ? ` · ${j.location}` : ''}\n${j.url}`,
  );

  // Discord's per-message content cap is 2000 chars; chunk conservatively.
  const chunks = chunkLines(lines, 1800);
  for (let i = 0; i < chunks.length; i++) {
    const content = i === 0 ? `${header}\n\n${chunks[i]}` : chunks[i];
    await postWebhook(webhook, content);
  }
}

async function postWebhook(webhook: string, content: string): Promise<void> {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Job Track OS', content }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: HTTP ${res.status} ${await res.text()}`);
  }
}

function chunkLines(lines: string[], max: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (candidate.length > max && cur) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
