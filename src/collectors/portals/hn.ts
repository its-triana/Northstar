import type { CollectedJob } from '../../lib/types.js';
import { stripHtml } from '../../lib/normalize.js';

// Hacker News "Ask HN: Who is hiring?" — monthly thread, high signal.
// Free Algolia API: find the latest thread, then pull design-matching comments.
// Comments follow a loose "Company | Role | Location | ..." convention.

interface AlgoliaHit {
  objectID: string;
  title?: string;
  comment_text?: string;
  created_at?: string;
  story_id?: number;
}

export async function fetchHn(): Promise<CollectedJob[]> {
  // 1. Latest "Who is hiring?" story by the whoishiring account.
  const storyRes = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?query=%22who%20is%20hiring%22&tags=story,author_whoishiring&hitsPerPage=1',
    { headers: { accept: 'application/json' } },
  );
  if (!storyRes.ok) throw new Error(`hn story lookup HTTP ${storyRes.status}`);
  const storyData = (await storyRes.json()) as { hits?: AlgoliaHit[] };
  const story = storyData.hits?.[0];
  if (!story) return [];

  // 2. Design-matching comments within that thread.
  const commentsRes = await fetch(
    `https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&query=designer&hitsPerPage=100`,
    { headers: { accept: 'application/json' } },
  );
  if (!commentsRes.ok) throw new Error(`hn comments HTTP ${commentsRes.status}`);
  const commentsData = (await commentsRes.json()) as { hits?: AlgoliaHit[] };

  const jobs: CollectedJob[] = [];
  for (const hit of commentsData.hits ?? []) {
    if (!hit.comment_text) continue;
    const text = stripHtml(hit.comment_text);
    const firstLine = text.split('\n')[0] ?? '';

    // Only accept posts following the thread's "Company | Role | Location | ..."
    // convention. Free-form posts have no reliable company/title and would leak
    // paragraph-length garbage into the pipeline — skip them; high signal only.
    const segments = firstLine.split('|').map((s) => s.trim());
    if (segments.length < 2) continue;
    const companyName = segments[0];
    if (!companyName || companyName.length > 60) continue;

    const roleSegment = segments.slice(1).find((s) => /design/i.test(s));
    if (!roleSegment || roleSegment.length > 120) continue;

    jobs.push({
      externalId: hit.objectID,
      source: 'hn',
      companyName,
      title: roleSegment,
      location: segments.find((s) => /remote|hybrid|onsite|india|europe|us|uk/i.test(s)),
      remoteType: /remote/i.test(firstLine) ? 'remote' : 'unknown',
      description: text.slice(0, 4000),
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      postedAt: hit.created_at,
    });
  }
  return jobs;
}
