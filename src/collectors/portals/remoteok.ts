import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// https://remoteok.com/api — JSON array; element [0] is a legal notice, not a job.
// Wants a real-looking User-Agent or it sometimes 403s.
interface RemoteOkItem {
  id?: string | number;
  company?: string;
  position?: string;
  tags?: string[];
  location?: string;
  description?: string;
  date?: string;
  url?: string;
  apply_url?: string;
}

export async function fetchRemoteOk(): Promise<CollectedJob[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { accept: 'application/json', 'user-agent': 'job-track-os (personal job tracker)' },
  });
  if (!res.ok) throw new Error(`remoteok HTTP ${res.status}`);

  const items = (await res.json()) as RemoteOkItem[];
  return items
    .filter((i) => i && i.id && i.position && i.company)
    .map(
      (i): CollectedJob => ({
        externalId: String(i.id),
        source: 'remoteok',
        companyName: i.company!,
        title: i.position!,
        location: i.location || undefined,
        remoteType: 'remote', // the whole board is remote by definition
        description: i.description ? stripHtml(i.description) : undefined,
        url: i.url ?? i.apply_url ?? `https://remoteok.com/remote-jobs/${i.id}`,
        postedAt: i.date,
      }),
    );
}
