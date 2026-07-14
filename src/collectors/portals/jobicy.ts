import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia
// (their design category slug — plain "design" returns HTTP 400).
interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  pubDate?: string; // ISO 8601, e.g. "2026-07-14T14:00:04+00:00"
}

// Never let one malformed date sink the whole portal fetch.
function safeIso(value?: string): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value) || Date.parse(value.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : undefined;
}

export async function fetchJobicy(): Promise<CollectedJob[]> {
  const res = await fetch('https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia', {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`jobicy HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: JobicyJob[] };
  return (data.jobs ?? []).map((j): CollectedJob => {
    const desc = j.jobDescription ?? j.jobExcerpt;
    return {
      externalId: String(j.id),
      source: 'jobicy',
      companyName: j.companyName,
      title: j.jobTitle,
      location: j.jobGeo || undefined,
      remoteType: 'remote',
      description: desc ? stripHtml(desc) : undefined,
      url: j.url,
      postedAt: safeIso(j.pubDate),
    };
  });
}
