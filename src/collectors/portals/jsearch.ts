import type { CollectedJob } from '../../lib/types.js';
import { env, requireEnv } from '../../lib/config.js';
import { stripHtml } from '../../lib/normalize.js';

// JSearch (RapidAPI) — Google Jobs index, which sees Naukri, LinkedIn, Indeed
// and custom Indian career pages (Zomato/Zerodha/Flipkart-tier companies that
// expose no public ATS). This is the India breadth layer.
//
// BUDGET DISCIPLINE (free tier, 200 req/mo HARD limit): exactly TWO requests
// per call — two complementary queries, one page each. The scheduler calls
// this once daily → ~62 requests/month, leaving ~135 headroom (future salary
// lookups). Never loop pages here.

interface JSearchJob {
  job_id: string;
  employer_name?: string;
  job_title?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_apply_link?: string;
  job_description?: string;
}

export function jsearchConfigured(): boolean {
  return !!env('RAPIDAPI_KEY');
}

// Two complementary daily sweeps: broad all-India, then a senior/target-city/
// remote-weighted pass. Google ranks ~10 results per query, so two angles
// roughly double the daily sample of the bowl.
const QUERIES = [
  'product designer or ux designer in India',
  'senior product designer in Gurgaon or Bengaluru or remote India',
];

export async function fetchJsearch(): Promise<CollectedJob[]> {
  const key = requireEnv('RAPIDAPI_KEY');
  const byId = new Map<string, CollectedJob>();

  for (const query of QUERIES) {
    // v5 API: the endpoint is /search-v2 (plain /search is v1 and now 404s),
    // and results nest under data.jobs.
    const params = new URLSearchParams({
      query,
      country: 'in',
      date_posted: '3days', // daily cadence + small overlap; dedup absorbs repeats
    });
    try {
      const res = await fetch(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
        headers: {
          'x-rapidapi-key': key,
          'x-rapidapi-host': 'jsearch.p.rapidapi.com',
          accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data?: { jobs?: JSearchJob[] } };

      for (const j of data.data?.jobs ?? []) {
        if (!j.job_id || !j.job_title || !j.employer_name || !j.job_apply_link) continue;
        if (byId.has(j.job_id)) continue; // same role from both queries
        const location = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ');
        byId.set(j.job_id, {
          externalId: j.job_id,
          source: 'jsearch',
          companyName: j.employer_name,
          title: j.job_title,
          location: location || undefined,
          remoteType: j.job_is_remote ? 'remote' : location ? 'onsite' : 'unknown',
          description: j.job_description ? stripHtml(j.job_description).slice(0, 8000) : undefined,
          url: j.job_apply_link,
          postedAt: j.job_posted_at_datetime_utc,
        });
      }
    } catch (err) {
      // One query failing must not kill the other (§16 isolation).
      console.error(`[jsearch] query "${query.slice(0, 40)}…" failed: ${(err as Error).message}`);
    }
  }
  return [...byId.values()];
}
