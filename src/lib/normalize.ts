import type { RemoteType } from './types.js';

// Cheap HTML → text. Good enough for job descriptions; we never render it.
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function guessRemoteType(location?: string, text?: string): RemoteType {
  const s = `${location ?? ''} ${text ?? ''}`.toLowerCase();
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\bremote\b|\bwork from home\b|\banywhere\b/.test(s)) return 'remote';
  if (location && location.trim()) return 'onsite';
  return 'unknown';
}

// Used by the Phase 2 dedup pass (normalised company + title, 14-day window).
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|technologies|technology|labs|india|pvt|private)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
