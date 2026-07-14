import type { CollectedJob } from '../lib/types.js';
import { stripHtml, guessRemoteType } from '../lib/normalize.js';

// Public, unauthenticated JSON endpoint. Companies post here before syndication.
// Pattern: https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string; // HTML-encoded, only present with content=true
}

export async function fetchGreenhouse(companyName: string, token: string): Promise<CollectedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`greenhouse:${token} HTTP ${res.status}`);

  const data = (await res.json()) as { jobs?: GreenhouseJob[] };
  const jobs = data.jobs ?? [];

  return jobs.map((j): CollectedJob => {
    const description = j.content ? stripHtml(j.content) : undefined;
    return {
      externalId: String(j.id),
      source: 'greenhouse',
      companyName,
      title: j.title,
      location: j.location?.name,
      remoteType: guessRemoteType(j.location?.name, description),
      description,
      url: j.absolute_url,
      postedAt: j.updated_at,
    };
  });
}
