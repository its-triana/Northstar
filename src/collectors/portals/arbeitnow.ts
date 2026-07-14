import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://www.arbeitnow.com/api/job-board-api — public, page 1 is enough hourly.
interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  location?: string;
  created_at?: number; // epoch seconds
}

export async function fetchArbeitnow(): Promise<CollectedJob[]> {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api', {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`arbeitnow HTTP ${res.status}`);

  const data = (await res.json()) as { data?: ArbeitnowJob[] };
  return (data.data ?? []).map(
    (j): CollectedJob => ({
      externalId: j.slug,
      source: 'arbeitnow',
      companyName: j.company_name,
      title: j.title,
      location: j.location || undefined,
      remoteType: j.remote ? 'remote' : 'unknown',
      description: j.description ? stripHtml(j.description) : undefined,
      url: j.url,
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
    }),
  );
}
