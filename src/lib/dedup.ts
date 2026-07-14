import type { CollectedJob } from './types.js';
import { normalizeCompany, normalizeTitle } from './normalize.js';

// Dedup pass 2 (PRD §6): the same role often arrives from multiple channels with
// different external ids — an ATS board and RemoteOK, say. Pass 1 is the DB's
// (company_id, external_id) unique key; this pass catches cross-source repeats by
// normalised company + title within a 14-day window.

export interface RecentJobKey {
  companyName: string;
  title: string;
}

export function dedupKey(companyName: string, title: string): string {
  return `${normalizeCompany(companyName)}::${normalizeTitle(title)}`;
}

// Returns { unique, duplicates } — duplicates keep their reason for the kill log.
export function dedupPass2(
  incoming: CollectedJob[],
  recentlySeen: RecentJobKey[],
): { unique: CollectedJob[]; duplicates: { job: CollectedJob; reason: string }[] } {
  const seen = new Set(recentlySeen.map((r) => dedupKey(r.companyName, r.title)));
  const unique: CollectedJob[] = [];
  const duplicates: { job: CollectedJob; reason: string }[] = [];

  for (const job of incoming) {
    const key = dedupKey(job.companyName, job.title);
    if (seen.has(key)) {
      duplicates.push({
        job,
        reason: `dedup: same company+title already seen within 14 days (${job.source})`,
      });
    } else {
      seen.add(key); // also dedups within this batch, across sources
      unique.push(job);
    }
  }
  return { unique, duplicates };
}
