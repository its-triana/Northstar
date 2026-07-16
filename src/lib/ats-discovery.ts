// ATS discovery: given a company name (and optionally a domain), try each ATS's
// public endpoint against slugified name variants. First hit wins. This is what
// turns the seed CSV — which has no tokens — into directly-pollable companies,
// and later powers the Phase 4 discovery loop for portal-found companies.
//
// Validation note: Greenhouse/Lever/Ashby/Recruitee 404 unknown tokens, so a
// 200 with the right shape is a trustworthy match (even an empty board = a real
// company between postings, worth polling). Workable and SmartRecruiters instead
// return a friendly {name, jobs:[]} / {content:[], totalFound:0} for ANY reserved
// token — so for those two we require at least one live posting to avoid matching
// placeholder accounts (e.g. workable "amazon"/"visa" are empty squatters).

export interface AtsMatch {
  // 'workday' is never probe-discovered (tokens are tenant|host|site triples,
  // unguessable from a name) — it only enters via hand-verified OVERRIDES pins.
  atsType: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee' | 'smartrecruiters' | 'workday';
  token: string;
}

// Generic one-word company names collide with whoever registered that slug first.
// These are confirmed wrong-company matches (verified by inspecting the postings),
// so we force them to "not found" rather than attribute a stranger's jobs to Ana's
// target. Add a right-hand value to pin a known-correct token instead of skipping.
const OVERRIDES: Record<string, AtsMatch | null> = {
  'pine labs': null, // greenhouse:pine → a residential-mortgage company
  'fi money': null, // lever:fi → unrelated (paid-search/marketing roles)
  navi: null, // ashby:navi → a hardware startup
  slice: null, // greenhouse:slice → US pizza-tech, not the Indian card
  zeta: null, // lever:zeta → Zeta Global (US adtech), not the Indian bank-infra co
  salesforce: null, // recruitee:salesforce → a Recruitee demo account ("(Sample)")
  // Hand-verified pins (found by reading the careers pages, not slug guessing).
  // 'workday' tokens are tenant|host|site — see collectors/workday.ts.
  razorpay: { atsType: 'greenhouse', token: 'razorpaysoftwareprivatelimited' },
  paypal: { atsType: 'workday', token: 'paypal|paypal.wd1.myworkdayjobs.com|jobs' },
  adobe: { atsType: 'workday', token: 'adobe|adobe.wd5.myworkdayjobs.com|external_experienced' },
  mastercard: { atsType: 'workday', token: 'mastercard|mastercard.wd1.myworkdayjobs.com|CorporateCareers' },
  'target india': { atsType: 'workday', token: 'target|target.wd5.myworkdayjobs.com|targetcareers' },
};

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

async function probe(url: string, validate: (json: unknown) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = JSON.parse(await res.text());
    return validate(json);
  } catch {
    return false; // network error, timeout, or non-JSON body → not a match
  }
}

type Json = Record<string, unknown> & { jobs?: unknown[]; offers?: unknown[]; content?: unknown[]; totalFound?: number };

const PROBES: {
  atsType: AtsMatch['atsType'];
  url: (t: string) => string;
  validate: (j: unknown) => boolean;
}[] = [
  {
    atsType: 'greenhouse',
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    validate: (j) => Array.isArray((j as Json).jobs),
  },
  {
    atsType: 'lever',
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    validate: (j) => Array.isArray(j),
  },
  {
    atsType: 'ashby',
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    validate: (j) => Array.isArray((j as Json).jobs),
  },
  {
    // Leaky: returns {name, jobs:[]} for any token — require a live posting.
    atsType: 'workable',
    url: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`,
    validate: (j) => Array.isArray((j as Json).jobs) && (j as Json).jobs!.length > 0,
  },
  {
    atsType: 'recruitee',
    url: (t) => `https://${t}.recruitee.com/api/offers/`,
    validate: (j) => Array.isArray((j as Json).offers),
  },
  {
    // Leaky: returns {content:[], totalFound:0} for reserved tokens — require postings.
    atsType: 'smartrecruiters',
    url: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=1`,
    validate: (j) => ((j as Json).totalFound ?? 0) > 0 || ((j as Json).content?.length ?? 0) > 0,
  },
];

// Tries every ATS × every slug variant. Sequential per company (fast enough for a
// one-time seed and the weekly discovery loop) — callers parallelise across companies.
export async function discoverAts(name: string, domain?: string): Promise<AtsMatch | null> {
  const override = OVERRIDES[name.toLowerCase().trim()];
  if (override !== undefined) return override; // null = force-skip a known bad slug

  for (const variant of slugVariants(name, domain)) {
    for (const p of PROBES) {
      if (await probe(p.url(variant), p.validate)) {
        return { atsType: p.atsType, token: variant };
      }
    }
  }
  return null;
}
