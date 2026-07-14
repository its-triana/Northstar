import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://www.workingnomads.com/api/exposed_jobs/ — public JSON (all categories;
// we keep design/creative rows and let the prefilter do the fine judging).
interface WorkingNomadsJob {
  url: string;
  title: string;
  description?: string;
  company_name: string;
  category_name?: string;
  location?: string;
  pub_date?: string;
}

export async function fetchWorkingNomads(): Promise<CollectedJob[]> {
  const res = await fetch('https://www.workingnomads.com/api/exposed_jobs/', {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`workingnomads HTTP ${res.status}`);

  const items = (await res.json()) as WorkingNomadsJob[];
  return items
    .filter((j) => /design/i.test(j.category_name ?? '') || /design/i.test(j.title))
    .map(
      (j): CollectedJob => ({
        externalId: j.url.replace(/\/$/, '').split('/').pop() ?? j.url,
        source: 'workingnomads',
        companyName: j.company_name,
        title: j.title,
        location: j.location || undefined,
        remoteType: 'remote',
        description: j.description ? stripHtml(j.description) : undefined,
        url: j.url,
        postedAt: j.pub_date ? new Date(j.pub_date).toISOString() : undefined,
      }),
    );
}
