import type { CollectedJob } from '../lib/types.js';
import { stripHtml } from '../lib/normalize.js';

// Public endpoint: https://{token}.recruitee.com/api/offers/
interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string; // html
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  careers_url?: string;
  created_at?: string;
  published_at?: string;
}

export async function fetchRecruitee(companyName: string, token: string): Promise<CollectedJob[]> {
  const url = `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`recruitee:${token} HTTP ${res.status}`);

  const data = (await res.json()) as { offers?: RecruiteeOffer[] };
  return (data.offers ?? []).map((o): CollectedJob => {
    const location = o.location ?? [o.city, o.country].filter(Boolean).join(', ') ?? undefined;
    return {
      externalId: String(o.id),
      source: 'recruitee',
      companyName,
      title: o.title,
      location: location || undefined,
      remoteType: o.remote ? 'remote' : location ? 'onsite' : 'unknown',
      description: o.description ? stripHtml(o.description) : undefined,
      url: o.careers_url ?? `https://${token}.recruitee.com/o/${o.id}`,
      postedAt: o.published_at ?? o.created_at,
    };
  });
}
