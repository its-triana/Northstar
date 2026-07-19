// Loads .env (if present) and reads required secrets lazily, so that read-only
// paths like `collect --dry-run` run with no credentials at all.
import 'dotenv/config';

const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_APPLICATION_ID',
  'DISCORD_PUBLIC_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CHANNEL_DIGEST',
  'DISCORD_CHANNEL_PIPELINE',
  'DISCORD_CHANNEL_DISCOVERIES',
  'RAPIDAPI_KEY',
] as const;

type EnvKey = (typeof KEYS)[number];

export function env(name: EnvKey): string | undefined {
  return process.env[name] || undefined;
}

export function requireEnv(name: EnvKey): string {
  const v = env(name);
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example → .env and fill it in (see README, "Setup").`,
    );
  }
  return v;
}
