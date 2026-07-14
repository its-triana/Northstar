import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://remotive.com/api/remote-jobs?category=design — server-side design filter.
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  publication_date?: string;
  candidate_required_location?: string;
  description?: string;
}

export async function fetchRemotive(): Promise<CollectedJob[]> {
  const res = await fetch('https://remotive.com/api/remote-jobs?category=design', {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`remotive HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: RemotiveJob[] };
  return (data.jobs ?? []).map(
    (j): CollectedJob => ({
      externalId: String(j.id),
      source: 'remotive',
      companyName: j.company_name,
      title: j.title,
      location: j.candidate_required_location || undefined,
      remoteType: 'remote',
      description: j.description ? stripHtml(j.description) : undefined,
      url: j.url,
      postedAt: j.publication_date,
    }),
  );
}
