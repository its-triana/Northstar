import type { CollectedJob } from '../lib/types.js';
import { guessRemoteType } from '../lib/normalize.js';

// Workday CXS — the public JSON API behind *.myworkdayjobs.com career sites.
// Used by the global-india-team giants (PayPal, Adobe, Mastercard, Target...).
// Token format in companies.ats_token:  "tenant|host|site"
//   e.g.  paypal|paypal.wd1.myworkdayjobs.com|jobs
// We search server-side for "designer" (cuts thousands of reqs to ~1-3 pages);
// the deterministic prefilter does the fine judging as usual.

interface WorkdayPosting {
  title: string;
  externalPath: string; // "/job/Location/Title_JR-12345"
  locationsText?: string;
  postedOn?: string; // fuzzy: "Posted Today" | "Posted 2 Days Ago" | "Posted 30+ Days Ago"
  bulletFields?: string[];
}

const PAGE = 20;
const MAX_PAGES = 3;

export async function fetchWorkday(companyName: string, token: string): Promise<CollectedJob[]> {
  const [tenant, host, site] = token.split('|');
  if (!tenant || !host || !site) throw new Error(`workday:${companyName} bad token (want tenant|host|site)`);

  const jobs: CollectedJob[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ limit: PAGE, offset: page * PAGE, searchText: 'designer', appliedFacets: {} }),
    });
    if (!res.ok) throw new Error(`workday:${tenant} HTTP ${res.status}`);
    const data = (await res.json()) as { total?: number; jobPostings?: WorkdayPosting[] };
    const postings = data.jobPostings ?? [];

    for (const p of postings) {
      if (!p.externalPath || !p.title) continue;
      jobs.push({
        externalId: p.externalPath,
        source: 'workday',
        companyName,
        title: p.title,
        location: p.locationsText,
        remoteType: guessRemoteType(p.locationsText, p.title),
        description: undefined, // detail is a per-job request; scorer fetches on demand
        url: `https://${host}/en-US/${site}${p.externalPath}`,
        postedAt: parsePostedOn(p.postedOn),
      });
    }
    if (postings.length < PAGE || (data.total !== undefined && (page + 1) * PAGE >= data.total)) break;
  }
  return jobs;
}

// "Posted Today" → now · "Posted 2 Days Ago" → now-2d · "Posted 30+ Days Ago" → now-31d
// (fuzzy is fine: the prefilter only needs day-level resolution for its 14-day rule)
function parsePostedOn(text?: string): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (t.includes('today')) return new Date().toISOString();
  if (t.includes('yesterday')) return new Date(Date.now() - 86_400_000).toISOString();
  const plus = t.match(/(\d+)\+\s*days/);
  if (plus) return new Date(Date.now() - (Number(plus[1]) + 1) * 86_400_000).toISOString();
  const days = t.match(/(\d+)\s*days?/);
  if (days) return new Date(Date.now() - Number(days[1]) * 86_400_000).toISOString();
  return undefined;
}
