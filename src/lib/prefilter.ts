import type { CollectedJob } from './types.js';
import { normalizeCompany } from './normalize.js';

// Deterministic prefilter — PRD §8. No LLM, free, kills ~90% before any scoring.
// Every kill carries a reason: the most dangerous failure mode of this system is
// a filter silently eating the perfect role, so kills must be auditable.
//
// Rule 5 (dedup) lives in dedup.ts; rule order here mirrors the PRD.

export interface PrefilterResult {
  passed: boolean;
  reason: string; // why it died — or why it survived
}

// PRD title pattern: product/UX/UI/interaction/experience designer, senior/staff/
// lead designer, design lead, product design.
const DESIGN_TITLE =
  /\b(product|ux|ui|interaction|experience)\s*[/&-]?\s*(ux|ui)?\s*design(er)?\b|\bdesign\s+lead\b|\b(senior|staff|lead|sr\.?)\s+(product\s+)?designer\b|\bproduct\s+design\b/i;

// Wrong seniority in title kills outright (manager+ and intern/junior tracks).
const WRONG_SENIORITY =
  /\b(intern|internship|trainee|junior|associate|graduate|principal|director|vp|vice\s+president|head\s+of|manager)\b/i;

// India location rule: Indian cities other than NCR/Bengaluru kill NON-remote roles.
// Global onsite is deliberately NOT killed here — eligibility is the scorer's job (PRD §10).
const ALLOWED_INDIA =
  /\b(gurgaon|gurugram|new\s*delhi|delhi|noida|ghaziabad|faridabad|ncr|bengaluru|bangalore)\b/i;
const OTHER_INDIA =
  /\b(mumbai|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|indore|kochi|cochin|coimbatore|chandigarh|lucknow|surat|vadodara|nagpur|bhopal|mysuru|mysore|thiruvananthapuram|trivandrum|goa)\b/i;

const MAX_AGE_DAYS = 14;

export function prefilter(
  job: CollectedJob,
  opts: { rejectedCompanies?: Set<string> } = {},
): PrefilterResult {
  // 1. Title must look like a design role we want.
  if (!DESIGN_TITLE.test(job.title)) {
    return { passed: false, reason: `title not a target design role: "${job.title}"` };
  }

  // 2. Wrong seniority in the title.
  const seniority = job.title.match(WRONG_SENIORITY);
  if (seniority) {
    return { passed: false, reason: `wrong seniority in title: "${seniority[0]}"` };
  }

  // 3. Indian city outside NCR/Bengaluru, and not remote.
  const loc = job.location ?? '';
  if (OTHER_INDIA.test(loc) && !ALLOWED_INDIA.test(loc) && job.remoteType !== 'remote') {
    return { passed: false, reason: `non-target Indian city, not remote: "${loc}"` };
  }

  // 4. Stale posting.
  if (job.postedAt) {
    const ageDays = (Date.now() - Date.parse(job.postedAt)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > MAX_AGE_DAYS) {
      return { passed: false, reason: `posted ${Math.floor(ageDays)}d ago (> ${MAX_AGE_DAYS}d)` };
    }
  }

  // 6. Company already rejected in the discovery loop.
  if (opts.rejectedCompanies?.has(normalizeCompany(job.companyName))) {
    return { passed: false, reason: `company "${job.companyName}" is status=rejected` };
  }

  return { passed: true, reason: 'clears all prefilter rules' };
}

// Small helper for run summaries: count kills by rule family.
export function killBreakdown(results: PrefilterResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.passed) continue;
    const family = r.reason.split(':')[0];
    out[family] = (out[family] ?? 0) + 1;
  }
  return out;
}
