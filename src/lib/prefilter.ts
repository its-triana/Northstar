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

// Wrong seniority kills outright: everything ABOVE her targets (staff+, leads-of-leads,
// managers) and everything below (intern/junior tracks). Targets: Senior PD, PD II, PD III.
// (Preference update 2026-07-24: staff/sr-staff/group-lead added to the kill list.)
const WRONG_SENIORITY =
  /\b(intern|internship|trainee|junior|fresher|freshers|associate|graduate|staff|principal|group\s+(design\s+)?lead|director|vp|vice\s+president|head\s+of|manager)\b/i;

// India location rule: Indian cities other than NCR/Bengaluru/Mumbai kill NON-remote roles.
// (Mumbai added 2026-07-24.)
const ALLOWED_INDIA =
  /\b(gurgaon|gurugram|new\s*delhi|delhi|noida|ghaziabad|faridabad|ncr|bengaluru|bangalore|mumbai)\b/i;
const OTHER_INDIA =
  /\b(pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|indore|kochi|cochin|coimbatore|chandigarh|lucknow|surat|vadodara|nagpur|bhopal|mysuru|mysore|thiruvananthapuram|trivandrum|goa)\b/i;

// Global onsite: DROPPED per preferences (2026-07-24). A non-remote role located
// outside India is killed at the door — no more US-onsite cards. Global REMOTE
// still passes (the scorer judges IST/geo restrictions).
const INDIA_HINT =
  /\bindia\b|\b(gurgaon|gurugram|new\s*delhi|delhi|noida|ghaziabad|faridabad|ncr|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|kolkata)\b|,\s*in\b/i;
const DEFINITELY_NOT_INDIA = /\bunited states\b|\busa\b|\bu\.s\./i;

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

  // 3. Indian city outside NCR/Bengaluru/Mumbai, and not remote.
  const loc = job.location ?? '';
  if (OTHER_INDIA.test(loc) && !ALLOWED_INDIA.test(loc) && job.remoteType !== 'remote') {
    return { passed: false, reason: `non-target Indian city, not remote: "${loc}"` };
  }

  // 3b. Global onsite — dropped per preferences (2026-07-24). If it has a location,
  // that location shows no India signal, and the role isn't remote: kill it.
  if (
    loc &&
    job.remoteType !== 'remote' &&
    (DEFINITELY_NOT_INDIA.test(loc) || !INDIA_HINT.test(loc))
  ) {
    return { passed: false, reason: `global onsite (dropped per preferences): "${loc}"` };
  }

  // 3c. US-restricted remote: her global-remote rule already excludes listings
  // restricted to countries that exclude India. "Remote · United States" is the
  // overwhelmingly common case — kill it at the door instead of scoring it.
  if (loc && job.remoteType === 'remote' && DEFINITELY_NOT_INDIA.test(loc)) {
    return { passed: false, reason: `US-restricted remote (excludes India): "${loc}"` };
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
