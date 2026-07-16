// One-time registration of the slash commands (PRD §12) with Discord.
// Guild-scoped when DISCORD_GUILD_ID is set (instant), global otherwise (~1h).
//
//   npm run register:commands

import 'dotenv/config';
import { requireEnv } from '../lib/config.js';

const COMMANDS = [
  { name: 'pipeline', description: 'Active applications and their statuses' },
  {
    name: 'status',
    description: 'Update the status of an application',
    options: [{ type: 3, name: 'company', description: 'Company name (partial ok)', required: true }],
  },
  {
    name: 'note',
    description: 'Append a note / interview feedback to an application',
    options: [{ type: 3, name: 'company', description: 'Company name (partial ok)', required: true }],
  },
  {
    name: 'company',
    description: 'Pull the culture dossier for a company',
    options: [{ type: 3, name: 'name', description: 'Company name (partial ok)', required: true }],
  },
];

async function main(): Promise<void> {
  const appId = requireEnv('DISCORD_APPLICATION_ID');
  const guildId = process.env.DISCORD_GUILD_ID;
  const path = guildId
    ? `/applications/${appId}/guilds/${guildId}/commands`
    : `/applications/${appId}/commands`;

  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'PUT', // bulk overwrite — idempotent
    headers: {
      authorization: `Bot ${requireEnv('DISCORD_BOT_TOKEN')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });
  if (!res.ok) throw new Error(`register failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`[commands] registered ${COMMANDS.length} ${guildId ? 'guild' : 'global'} commands.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
