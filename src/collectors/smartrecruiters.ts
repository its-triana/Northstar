import type { CollectedJob } from '../lib/types.js';

// Public endpoint: https://api.smartrecruiters.com/v1/companies/{token}/postings
// The list endpoint has no description; fetching one per posting would be N+1
// requests, so description stays empty here. The Phase 3 scorer fetches the
// posting detail on demand for the handful of survivors.
interface SmartRecruitersPosting {
  id: string;
  uuid?: string;
  name: string; // title
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
}

export async function fetchSmartRecruiters(
  companyName: string,
  token: string,
): Promise<CollectedJob[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`smartrecruiters:${token} HTTP ${res.status}`);

  const data = (await res.json()) as { content?: SmartRecruitersPosting[] };
  return (data.content ?? []).map((p): CollectedJob => {
    const location = [p.location?.city, p.location?.region, p.location?.country]
      .filter(Boolean)
      .join(', ');
    return {
      externalId: p.id,
      source: 'smartrecruiters',
      companyName,
      title: p.name,
      location: location || undefined,
      remoteType: p.location?.remote ? 'remote' : location ? 'onsite' : 'unknown',
      description: undefined,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${p.id}`,
      postedAt: p.releasedDate,
    };
  });
}
