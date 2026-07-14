import type { CollectedJob } from '../lib/types.js';
import { guessRemoteType } from '../lib/normalize.js';

// Public endpoint: https://api.lever.co/v0/postings/{token}?mode=json
interface LeverPosting {
  id: string;
  text: string; // title
  hostedUrl: string;
  createdAt?: number; // ms epoch
  descriptionPlain?: string;
  workplaceType?: string; // remote | hybrid | on-site | unspecified
  categories?: { location?: string; team?: string; commitment?: string };
  country?: string;
}

export async function fetchLever(companyName: string, token: string): Promise<CollectedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`lever:${token} HTTP ${res.status}`);

  const postings = (await res.json()) as LeverPosting[];
  return postings.map((p): CollectedJob => {
    const location = p.categories?.location;
    const remoteType =
      p.workplaceType === 'remote'
        ? 'remote'
        : p.workplaceType === 'hybrid'
          ? 'hybrid'
          : p.workplaceType === 'on-site'
            ? 'onsite'
            : guessRemoteType(location, p.descriptionPlain);
    return {
      externalId: p.id,
      source: 'lever',
      companyName,
      title: p.text,
      location,
      remoteType,
      description: p.descriptionPlain,
      url: p.hostedUrl,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
    };
  });
}
