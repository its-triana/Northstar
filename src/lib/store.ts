import { getSupabase } from './supabase.js';
import type { CollectedJob } from './types.js';

export interface SeedCompany {
  name: string;
  token?: string;
  tier?: number;
  atsType?: string;
}

export type InsertedJob = CollectedJob & { id: string };

// Upsert companies by name → return name→id map. Idempotent: re-running keeps ids stable.
export async function ensureCompanies(companies: SeedCompany[]): Promise<Map<string, string>> {
  const sb = getSupabase();
  const rows = companies.map((c) => ({
    name: c.name,
    ats_type: c.atsType ?? null,
    ats_token: c.token ?? null,
    tier: c.tier ?? null,
    status: 'active',
    discovered_via: 'seed',
  }));

  const { data, error } = await sb
    .from('companies')
    .upsert(rows, { onConflict: 'name', ignoreDuplicates: false })
    .select('id, name');
  if (error) throw new Error(`[store] company upsert: ${error.message}`);

  return new Map((data ?? []).map((r) => [r.name as string, r.id as string]));
}

// Insert jobs, skipping ones already seen via the (company_id, external_id) unique key.
// Returns only the rows that were newly inserted — i.e. genuinely new postings.
export async function writeJobs(
  seed: SeedCompany[],
  jobs: CollectedJob[],
): Promise<InsertedJob[]> {
  if (jobs.length === 0) return [];
  const sb = getSupabase();
  const companyIds = await ensureCompanies(seed);

  // Dedup within this batch on (companyName, externalId) before hitting the DB.
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const byKey = new Map<string, CollectedJob>();
  for (const j of jobs) {
    const company_id = companyIds.get(j.companyName);
    if (!company_id) continue;
    const key = `${company_id}::${j.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byKey.set(`${company_id}::${j.externalId}`, j);
    rows.push({
      company_id,
      external_id: j.externalId,
      source: j.source,
      title: j.title,
      location: j.location ?? null,
      remote_type: j.remoteType ?? 'unknown',
      description: j.description ?? null,
      url: j.url,
      posted_at: j.postedAt ?? null,
    });
  }
  if (rows.length === 0) return [];

  // ON CONFLICT DO NOTHING → .select() returns only the inserted (new) rows.
  const { data, error } = await sb
    .from('jobs')
    .upsert(rows, { onConflict: 'company_id,external_id', ignoreDuplicates: true })
    .select('id, company_id, external_id');
  if (error) throw new Error(`[store] job insert: ${error.message}`);

  return (data ?? []).map((d) => {
    const src = byKey.get(`${d.company_id}::${d.external_id}`)!;
    return { ...src, id: d.id as string };
  });
}

// Records how many jobs each company returned this run (§16: catch a company that
// silently goes to zero). Best-effort — never let logging failure abort a run.
export async function logPoll(
  companyId: string,
  source: string,
  jobCount: number,
): Promise<void> {
  try {
    await getSupabase()
      .from('company_poll_log')
      .insert({ company_id: companyId, source, job_count: jobCount });
  } catch (err) {
    console.error('[store] poll log failed:', (err as Error).message);
  }
}
