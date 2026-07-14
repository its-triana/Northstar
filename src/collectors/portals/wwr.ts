import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// We Work Remotely design category, via RSS (their only public feed).
// Item titles follow the convention "Company: Role".
const FEED = 'https://weworkremotely.com/categories/remote-design-jobs.rss';

export async function fetchWwr(): Promise<CollectedJob[]> {
  const res = await fetch(FEED, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!res.ok) throw new Error(`wwr HTTP ${res.status}`);
  const xml = await res.text();

  const jobs: CollectedJob[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const title = tag(item, 'title');
    const link = tag(item, 'link');
    const pubDate = tag(item, 'pubDate');
    const region = tag(item, 'region');
    const description = tag(item, 'description');
    if (!title || !link) continue;

    const sep = title.indexOf(':');
    const companyName = sep > 0 ? title.slice(0, sep).trim() : 'Unknown';
    const roleTitle = sep > 0 ? title.slice(sep + 1).trim() : title.trim();

    jobs.push({
      externalId: link.replace(/\/$/, '').split('/').pop() ?? link,
      source: 'wwr',
      companyName,
      title: roleTitle,
      location: region || undefined,
      remoteType: 'remote',
      description: description ? stripHtml(description) : undefined,
      url: link,
      postedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
    });
  }
  return jobs;
}

// Minimal RSS tag extractor — handles both plain and CDATA-wrapped values.
function tag(chunk: string, name: string): string | undefined {
  const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return undefined;
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}
