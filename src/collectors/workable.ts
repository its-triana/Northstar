import type { CollectedJob } from '../lib/types.js';
import { stripHtml, guessRemoteType } from '../lib/normalize.js';

// Public widget endpoint: https://apply.workable.com/api/v1/widget/accounts/{token}?details=true
interface WorkableJob {
  shortcode: string;
  title: string;
  city?: string;
  state?: string;
  country?: string;
  url?: string;
  application_url?: string;
  published_on?: string; // YYYY-MM-DD
  description?: string; // html, present with details=true
  telecommuting?: boolean;
}

export async function fetchWorkable(companyName: string, token: string): Promise<CollectedJob[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`workable:${token} HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: WorkableJob[] };
  return (data.jobs ?? []).map((j): CollectedJob => {
    const location = [j.city, j.state, j.country].filter(Boolean).join(', ') || undefined;
    const description = j.description ? stripHtml(j.description) : undefined;
    return {
      externalId: j.shortcode,
      source: 'workable',
      companyName,
      title: j.title,
      location,
      remoteType: j.telecommuting ? 'remote' : guessRemoteType(location, description),
      description,
      url: j.url ?? j.application_url ?? `https://apply.workable.com/${token}/j/${j.shortcode}/`,
      postedAt: j.published_on ? new Date(j.published_on).toISOString() : undefined,
    };
  });
}
