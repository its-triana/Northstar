// Shared shape every collector returns. Keeping this uniform is what lets the
// dedup/prefilter/scorer stages (Phase 2+) treat all sources identically.

export type RemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface CollectedJob {
  externalId: string; // stable id from the source (e.g. Greenhouse job id)
  source: string; // 'greenhouse' | 'lever' | 'remoteok' | ...
  companyName: string; // canonical company name we polled under
  title: string;
  location?: string;
  remoteType?: RemoteType;
  description?: string; // plain text (HTML stripped)
  url: string;
  postedAt?: string; // ISO 8601
}
