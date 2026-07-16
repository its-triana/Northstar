// Lists prefilter survivors awaiting judgment, plus each company's dossier
// freshness — the /score command's work queue. Output is JSON on stdout.
//
//   npm run score:pending

import { getSupabase } from '../lib/supabase.js';

const DOSSIER_TTL_DAYS = 60;

async function main(): Promise<void> {
  const sb = getSupabase();

  const { data: jobs, error } = await sb
    .from('jobs')
    .select('id, title, location, remote_type, description, url, posted_at, source, company_id, companies(id, name, tier, hq_region)')
    .eq('prefilter_passed', true)
    .eq('score_status', 'unscored')
    .order('first_seen_at', { ascending: false });
  if (error) throw new Error(error.message);

  const companyIds = [...new Set((jobs ?? []).map((j) => j.company_id as string))];
  const { data: intel, error: intelErr } = await sb
    .from('company_intel')
    .select('company_id, refreshed_at')
    .in('company_id', companyIds);
  if (intelErr) throw new Error(intelErr.message);

  const freshCutoff = Date.now() - DOSSIER_TTL_DAYS * 86_400_000;
  const freshness = new Map(
    (intel ?? []).map((r) => [
      r.company_id as string,
      Date.parse(r.refreshed_at as string) > freshCutoff,
    ]),
  );

  const companies = new Map<string, { id: string; name: string; tier: number | null; hq_region: string | null; dossier_fresh: boolean; job_count: number }>();
  for (const j of jobs ?? []) {
    const c = j.companies as unknown as { id: string; name: string; tier: number | null; hq_region: string | null } | null;
    if (!c) continue;
    const existing = companies.get(c.id);
    if (existing) existing.job_count++;
    else
      companies.set(c.id, {
        ...c,
        dossier_fresh: freshness.get(c.id) ?? false,
        job_count: 1,
      });
  }

  console.log(
    JSON.stringify(
      {
        unscored_count: jobs?.length ?? 0,
        companies: [...companies.values()],
        jobs: (jobs ?? []).map((j) => ({
          id: j.id,
          company: (j.companies as { name?: string } | null)?.name,
          company_id: j.company_id,
          title: j.title,
          location: j.location,
          remote_type: j.remote_type,
          url: j.url,
          posted_at: j.posted_at,
          source: j.source,
          description: (j.description as string | null)?.slice(0, 6000) ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
