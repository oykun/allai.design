/**
 * The feed's data. `src/data/items.json` is a snapshot of the vault's published
 * items, written by `npm run sync` and committed — Vercel builds from it, so a
 * vault edit changes nothing on the site until the next sync.
 */
import items from '../data/items.json';

export function getPublishedItems() {
  // Newest first by clip date; the sync already sorts, this just guarantees it.
  return [...items].sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
}

export function getUnique(items, key) {
  return [...new Set(items.map((i) => i[key]).filter(Boolean))].sort();
}

export function getUniqueMulti(items, key) {
  return [...new Set(items.flatMap((i) => i[key]))].filter(Boolean).sort();
}
