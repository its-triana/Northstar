import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://himalayas.app/jobs/api — public JSON feed of remote jobs.
interface HimalayasJob {
  guid?: string;
  title?: string;
  companyName?: string;
  description?: string;
  excerpt?: string;
  applicationLink?: string;
  pubDate?: number; // epoch seconds
  locationRestrictions?: string[];
  categories?: string[];
}

export async function fetchHimalayas(): Promise<CollectedJob[]> {
  const res = await fetch('https://himalayas.app/jobs/api?limit=100', {
    headers: { accept: 'application/json', 'user-agent': 'job-track-os (personal job tracker)' },
  });
  if (!res.ok) throw new Error(`himalayas HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: HimalayasJob[] };
  return (data.jobs ?? [])
    .filter((j) => j.title && j.companyName)
    .map((j): CollectedJob => {
      const desc = j.description ?? j.excerpt;
      return {
        externalId: j.guid ?? `${j.companyName}-${j.title}-${j.pubDate ?? ''}`,
        source: 'himalayas',
        companyName: j.companyName!,
        title: j.title!,
        location: j.locationRestrictions?.join(', ') || undefined,
        remoteType: 'remote',
        description: desc ? stripHtml(desc) : undefined,
        url: j.applicationLink ?? j.guid ?? 'https://himalayas.app/jobs',
        postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : undefined,
      };
    });
}
