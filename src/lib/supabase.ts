import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './config.js';

// Lazily constructed so read-only paths (e.g. `collect --dry-run`) never need creds.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
