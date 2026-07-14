// ATS discovery: given a company name (and optionally a domain), try each ATS's
// public endpoint against slugified name variants. First hit wins. This is what
// turns the seed CSV — which has no tokens — into directly-pollable companies,
// and later powers the Phase 4 discovery loop for portal-found companies.

export interface AtsMatch {
  atsType: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee' | 'smartrecruiters';
  token: string;
}

function slugVariants(name: string, domain?: string): string[] {
  const base = name.toLowerCase().trim();
  const variants = new Set<string>([
    base.replace(/[^a-z0-9]+/g, ''), // "Pine Labs" -> pinelabs
    base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), // -> pine-labs
    base.split(/\s+/)[0].replace(/[^a-z0-9]/g, ''), // -> pine
  ]);
  if (domain) variants.add(domain.split('.')[0].toLowerCase());
  return [...variants].filter((v) => v.length >= 2);
}

async function probe(url: string, validate: (body: string) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return validate(body);
  } catch {
    return false;
  }
}

const PROBES: {
  atsType: AtsMatch['atsType'];
  url: (t: string) => string;
  validate: (body: string) => boolean;
}[] = [
  {
    atsType: 'greenhouse',
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    validate: (b) => b.includes('"jobs"'),
  },
  {
    atsType: 'lever',
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    validate: (b) => b.trimStart().startsWith('['),
  },
  {
    atsType: 'ashby',
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    validate: (b) => b.includes('"jobs"'),
  },
  {
    atsType: 'workable',
    url: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}`,
    validate: (b) => b.includes('"jobs"') || b.includes('"name"'),
  },
  {
    atsType: 'recruitee',
    url: (t) => `https://${t}.recruitee.com/api/offers/`,
    validate: (b) => b.includes('"offers"'),
  },
  {
    atsType: 'smartrecruiters',
    url: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings`,
    validate: (b) => b.includes('"content"'),
  },
];

// Tries every ATS × every slug variant. Sequential per company (fast enough for a
// one-time seed and the weekly discovery loop) — callers parallelise across companies.
export async function discoverAts(name: string, domain?: string): Promise<AtsMatch | null> {
  for (const variant of slugVariants(name, domain)) {
    for (const p of PROBES) {
      if (await probe(p.url(variant), p.validate)) {
        return { atsType: p.atsType, token: variant };
      }
    }
  }
  return null;
}
