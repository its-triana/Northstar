import type { CollectedJob } from '../lib/types.js';
import { stripHtml } from '../lib/normalize.js';

// Public endpoint: https://api.ashbyhq.com/posting-api/job-board/{token}
interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
}

export async function fetchAshby(companyName: string, token: string): Promise<CollectedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ashby:${token} HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: AshbyJob[] };
  return (data.jobs ?? []).map((j): CollectedJob => {
    return {
      externalId: j.id,
      source: 'ashby',
      companyName,
      title: j.title,
      location: j.location,
      remoteType: j.isRemote ? 'remote' : j.location ? 'onsite' : 'unknown',
      description: j.descriptionHtml ? stripHtml(j.descriptionHtml) : undefined,
      url: j.jobUrl ?? j.applyUrl ?? `https://jobs.ashbyhq.com/${token}/${j.id}`,
      postedAt: j.publishedAt,
    };
  });
}
