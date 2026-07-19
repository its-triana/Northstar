import type { CollectedJob } from '../../lib/types.js';
import { env, requireEnv } from '../../lib/config.js';
import { stripHtml } from '../../lib/normalize.js';

// JSearch (RapidAPI) — Google Jobs index, which sees Naukri, LinkedIn, Indeed
// and custom Indian career pages (Zomato/Zerodha/Flipkart-tier companies that
// expose no public ATS). This is the India breadth layer.
//
// BUDGET DISCIPLINE (free tier): exactly ONE request per call — a single query,
// one page. The scheduler calls this once daily, ~31 requests/month, far under
// the free quota. Never loop pages here.

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

export async function fetchJsearch(): Promise<CollectedJob[]> {
  const key = requireEnv('RAPIDAPI_KEY');
  // v5 API: the endpoint is /search-v2 (plain /search is v1 and now 404s),
  // and results nest under data.jobs. Single request — the budget rule.
  const params = new URLSearchParams({
    query: 'product designer or ux designer in India',
    country: 'in',
    date_posted: '3days', // daily cadence + small overlap; dedup absorbs repeats
  });
  const res = await fetch(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
    headers: {
      'x-rapidapi-key': key,
      'x-rapidapi-host': 'jsearch.p.rapidapi.com',
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`jsearch HTTP ${res.status}`);

  const data = (await res.json()) as { data?: { jobs?: JSearchJob[] } };
  return (data.data?.jobs ?? [])
    .filter((j) => j.job_id && j.job_title && j.employer_name)
    .map((j): CollectedJob => {
      const location = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ');
      return {
        externalId: j.job_id,
        source: 'jsearch',
        companyName: j.employer_name!,
        title: j.job_title!,
        location: location || undefined,
        remoteType: j.job_is_remote ? 'remote' : location ? 'onsite' : 'unknown',
        description: j.job_description ? stripHtml(j.job_description).slice(0, 8000) : undefined,
        url: j.job_apply_link ?? '',
        postedAt: j.job_posted_at_datetime_utc,
      };
    })
    .filter((j) => j.url);
}
