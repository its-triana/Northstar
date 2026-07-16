// Discord REST helpers for the bot (Phase 4). Plain channel webhooks cannot
// carry interactive components — buttons require messages sent by the app's
// bot user. The bot posts cards; the Netlify interactions endpoint handles clicks.
import { requireEnv } from './config.js';
import type { Embed } from './discord.js';

const API = 'https://discord.com/api/v10';

export interface ButtonRow {
  type: 1; // ACTION_ROW
  components: {
    type: 2; // BUTTON
    style: number; // 1 primary · 2 secondary · 3 success · 4 danger · 5 link
    label: string;
    custom_id?: string;
    url?: string;
  }[];
}

async function rest(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bot ${requireEnv('DISCORD_BOT_TOKEN')}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`discord ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
}

// Post a message with embeds + buttons. Returns the message id (store as
// `channelId:messageId` so the card can be edited in place later).
export async function postCard(
  channelId: string,
  embeds: Embed[],
  components: ButtonRow[] = [],
  content?: string,
): Promise<string> {
  const msg = await rest('POST', `/channels/${channelId}/messages`, { content, embeds, components });
  return `${channelId}:${msg.id}`;
}

// Edit a card in place — the message IS the tracker row (PRD §12).
export async function editCard(
  ref: string, // "channelId:messageId"
  patch: { embeds?: Embed[]; components?: ButtonRow[]; content?: string },
): Promise<void> {
  const [channelId, messageId] = ref.split(':');
  await rest('PATCH', `/channels/${channelId}/messages/${messageId}`, patch);
}

// Start a thread on a card (the Details expansion).
export async function createThread(ref: string, name: string): Promise<string> {
  const [channelId, messageId] = ref.split(':');
  const thread = await rest('POST', `/channels/${channelId}/messages/${messageId}/threads`, {
    name: name.slice(0, 100),
    auto_archive_duration: 10080,
  });
  return thread.id as string;
}

export async function postToThread(threadId: string, content: string, embeds?: Embed[]): Promise<void> {
  // Discord content cap is 2000 chars — chunk defensively.
  const chunks = content.match(/[\s\S]{1,1900}/g) ?? [''];
  for (let i = 0; i < chunks.length; i++) {
    await rest('POST', `/channels/${threadId}/messages`, {
      content: chunks[i],
      embeds: i === chunks.length - 1 ? embeds : undefined,
    });
  }
}
