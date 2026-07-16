import { requireEnv } from './config.js';

export interface RawJobLine {
  company: string;
  title: string;
  location?: string;
  url: string;
}

// Minimal Discord embed shape (subset we use).
export interface Embed {
  title: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

// Post rich embeds via the webhook, chunked to Discord's 10-embeds-per-message cap.
export async function postEmbeds(embeds: Embed[], content?: string): Promise<void> {
  if (embeds.length === 0 && !content) return;
  const webhook = requireEnv('DISCORD_WEBHOOK_URL');
  for (let i = 0; i < Math.max(embeds.length, 1); i += 10) {
    const body: Record<string, unknown> = {
      username: 'Job Track OS',
      embeds: embeds.slice(i, i + 10),
    };
    if (i === 0 && content) body.content = content;
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord embeds failed: HTTP ${res.status} ${await res.text()}`);
  }
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
