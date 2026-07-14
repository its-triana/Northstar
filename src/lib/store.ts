import { getSupabase } from './supabase.js';
import type { CollectedJob } from './types.js';
import type { PrefilterResult } from './prefilter.js';
import { normalizeCompany } from './normalize.js';
import type { RecentJobKey } from './dedup.js';

export interface SeedCompany {
  name: string;
  token?: string;
  tier?: number;
  atsType?: string;
  hqRegion?: string;
}

export interface ActiveCompany {
  id: string;
  name: string;
  tier: number;
  atsType: string;
  atsToken: string;
}

export type InsertedJob = CollectedJob & { id: string; prefilterPassed: boolean };

// Upsert seed companies by name → return name→id map. Overwrites tier/ats info,
// so it's for the seed script only — portal-found companies use ensureCandidates.
export async function ensureCompanies(companies: SeedCompany[]): Promise<Map<string, string>> {
  const sb = getSupabase();
  const rows = companies.map((c) => ({
    name: c.name,
    ats_type: c.atsType ?? null,
    ats_token: c.token ?? null,
    tier: c.tier ?? null,
    hq_region: c.hqRegion ?? null,
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

// Insert-if-missing for companies discovered via portals: never touches existing
// rows (so an 'active' or 'rejected' status is preserved), then returns the full
// name→id map for every requested name.
export async function ensureCandidateCompanies(names: string[]): Promise<Map<string, string>> {
  const sb = getSupabase();
  const unique = [...new Set(names)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const { error: insErr } = await sb
    .from('companies')
    .upsert(
      unique.map((name) => ({ name, status: 'candidate', discovered_via: 'portal' })),
      { onConflict: 'name', ignoreDuplicates: true },
    );
  if (insErr) throw new Error(`[store] candidate insert: ${insErr.message}`);

  const { data, error } = await sb.from('companies').select('id, name').in('name', unique);
  if (error) throw new Error(`[store] candidate select: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.name as string, r.id as string]));
}

// Companies to poll directly this run: active, with a discovered ATS, in the given tiers.
export async function getActiveCompanies(tiers: number[]): Promise<ActiveCompany[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select('id, name, tier, ats_type, ats_token')
    .eq('status', 'active')
    .in('tier', tiers)
    .not('ats_token', 'is', null)
    .not('ats_type', 'is', null);
  if (error) throw new Error(`[store] active companies: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    tier: (r.tier as number) ?? 3,
    atsType: r.ats_type as string,
    atsToken: r.ats_token as string,
  }));
}

// Normalised names of rejected companies, for prefilter rule 6.
export async function getRejectedCompanySet(): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select('name')
    .eq('status', 'rejected');
  if (error) throw new Error(`[store] rejected companies: ${error.message}`);
  return new Set((data ?? []).map((r) => normalizeCompany(r.name as string)));
}

// Company-name + title pairs seen in the last N days — feeds dedup pass 2.
export async function getRecentJobKeys(days = 14): Promise<RecentJobKey[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from('jobs')
    .select('title, companies(name)')
    .gte('first_seen_at', since);
  if (error) throw new Error(`[store] recent jobs: ${error.message}`);
  return (data ?? []).map((r) => ({
    title: r.title as string,
    companyName: ((r.companies as { name?: string } | null)?.name ?? '') as string,
  }));
}

// Write jobs WITH their prefilter verdicts. Kills are stored too (PRD §8: every
// kill is auditable, and stored kills make hourly re-runs no-ops via pass-1 dedup).
// Returns only newly-inserted rows.
export async function writeJobs(
  companyIds: Map<string, string>,
  jobs: { job: CollectedJob; verdict: PrefilterResult }[],
): Promise<InsertedJob[]> {
  if (jobs.length === 0) return [];
  const sb = getSupabase();

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const byKey = new Map<string, { job: CollectedJob; verdict: PrefilterResult }>();
  for (const item of jobs) {
    const company_id = companyIds.get(item.job.companyName);
    if (!company_id) continue;
    const key = `${company_id}::${item.job.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byKey.set(key, item);
    rows.push({
      company_id,
      external_id: item.job.externalId,
      source: item.job.source,
      title: item.job.title,
      location: item.job.location ?? null,
      remote_type: item.job.remoteType ?? 'unknown',
      // Kills keep no description — they exist for the audit trail, not for scoring.
      description: item.verdict.passed ? (item.job.description ?? null) : null,
      url: item.job.url,
      posted_at: item.job.postedAt ?? null,
      prefilter_passed: item.verdict.passed,
      prefilter_reason: item.verdict.reason,
    });
  }
  if (rows.length === 0) return [];

  const { data, error } = await sb
    .from('jobs')
    .upsert(rows, { onConflict: 'company_id,external_id', ignoreDuplicates: true })
    .select('id, company_id, external_id');
  if (error) throw new Error(`[store] job insert: ${error.message}`);

  return (data ?? []).map((d) => {
    const src = byKey.get(`${d.company_id}::${d.external_id}`)!;
    return { ...src.job, id: d.id as string, prefilterPassed: src.verdict.passed };
  });
}

// After posting to Discord: new → notified (PRD status flow).
export async function markNotified(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await getSupabase()
    .from('jobs')
    .update({ status: 'notified', last_touched_at: new Date().toISOString() })
    .in('id', jobIds);
  if (error) throw new Error(`[store] mark notified: ${error.message}`);
}

// Records how many jobs each company returned this run (§16: catch a company that
// silently goes to zero). Best-effort — never let logging failure abort a run.
export async function logPoll(companyId: string, source: string, jobCount: number): Promise<void> {
  try {
    await getSupabase()
      .from('company_poll_log')
      .insert({ company_id: companyId, source, job_count: jobCount });
  } catch (err) {
    console.error('[store] poll log failed:', (err as Error).message);
  }
}
