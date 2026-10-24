/**
 * Reads allai.design items out of the Obsidian vault.
 *
 * An item is any Markdown note carrying the `allai` tag (the Web Clipper
 * template in clipper/ adds it). The vault is the source of truth: Oykun
 * writes the note, the scripts only read it — except for two pipeline-owned
 * frontmatter keys, `image` and `video`, which `setFrontmatterKeys` writes
 * once media has been re-hosted on R2. Nothing else in a note is ever touched.
 *
 * Note anatomy (see clipper/README.md):
 *
 *   ---
 *   title, source, author, published, created, description, image   ← clipper
 *   tags: [allai, clippings]
 *   category: Website Design        one of CATEGORIES
 *   style: [Dark, Typographic]      free list, becomes the Style filter
 *   projects: ["[[crucial.design]]"] client projects this is a reference for
 *   publish: true                   tick to put it on allai.design
 *   ---
 *   ## What I like
 *   (Oykun's note — the reason it was kept)
 *   ## Clipped
 *   (the page content the clipper saved)
 */

import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

export const CATEGORIES = [
  "Website Design",
  "Product Design",
  "Illustration",
  "Reference Material",
  "Articles",
  "Products",
  "Skills",
];

// Legacy spellings are accepted so the first hand-tagged clips still count.
const ALLAI_TAGS = new Set(["allai", "allai.design", "allai-design"]);

// Which folders hold allai notes. Clippings is the Web Clipper's folder; _AI OS/allai
// holds the items migrated from Notion (Claude may only write inside _AI OS).
export function vaultDirs() {
  const raw = process.env.ALLAI_VAULT_DIRS || "~/Obsidian/Clippings,~/Obsidian/_AI OS/allai";
  return raw.split(",").map((d) => expandHome(d.trim())).filter(Boolean);
}

export function expandHome(p) {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // folder doesn't exist yet — fine, just empty
  }
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.name.endsWith(".md")) files.push(full);
  }
  return files;
}

export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text, raw: null };
  let frontmatter = {};
  try {
    frontmatter = parseYaml(m[1]) || {};
  } catch (err) {
    throw new Error(`bad frontmatter: ${err.message}`);
  }
  return { frontmatter, body: text.slice(m[0].length), raw: m[1] };
}

const asList = (v) =>
  v == null ? [] : Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim());

const asString = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(asString).join(", ");
  return String(v).trim();
};

const asBool = (v) => v === true || /^(true|yes|1)$/i.test(String(v ?? ""));

/** "[[crucial.design|Crucial]]" → "crucial.design" */
export function stripWikilink(s) {
  return String(s).trim().replace(/^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/, "$1").trim();
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasAllaiTag(tags) {
  return asList(tags).some((t) => {
    const tag = t.replace(/^#/, "").toLowerCase();
    return ALLAI_TAGS.has(tag) || tag.startsWith("allai/");
  });
}

/** Strips tracking noise so the same page always hashes to the same id. */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|fbclid|gclid|si$|s$|t$)/.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url).trim();
  }
}

export function idFor(url) {
  return createHash("sha1").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}

/** X titles arrive as `(2) Name on X: "…" / X`; nobody wants that on a card. */
export function cleanTitle(title) {
  return String(title)
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\/\s*X$/, "")
    .replace(/^[^:]+ on X:\s*/, "")
    .replace(/^"(.*)"$/, "$1")
    .replace(/\s+https?:\/\/t\.co\/\S+$/, "")
    .trim();
}

export function isXUrl(url) {
  return /^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(url);
}

/**
 * Oykun's own words live above the `## Clipped` heading. Notes clipped before
 * the template existed have no heading: there, the note is whatever text sits
 * above the first image or heading.
 */
export function extractNote(body) {
  const clippedAt = body.search(/^#{1,6}\s+clipped\b.*$/im);
  let note = clippedAt >= 0 ? body.slice(0, clippedAt) : "";
  if (clippedAt < 0) {
    const lines = [];
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*(!\[|#)/.test(line)) break;
      lines.push(line);
    }
    note = lines.join("\n");
  }

  // Wikilink-only lines are project tags from before `projects:` existed.
  const projectsFromBody = [];
  note = note
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (/^(\[\[[^\]]+\]\]\s*)+$/.test(t)) {
        for (const m of t.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) projectsFromBody.push(m[1]);
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/^#{1,6}\s+(what|why) i like.*$/gim, "") // the template's own heading
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  return { noteMarkdown: note, projectsFromBody };
}

/** Markdown → one paragraph of plain text for the card modal. */
export function notePlainText(md) {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/[*_`>]/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function firstImageIn(body) {
  const m = body.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  return m ? m[1] : "";
}

function displaySource(author, url) {
  const a = stripWikilink(asString(author).split(",")[0] || "");
  if (a) return a;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function readItem(file) {
  const text = await readFile(file, "utf8");
  const { frontmatter: fm, body } = splitFrontmatter(text);
  if (!hasAllaiTag(fm.tags)) return null;

  const sourceUrl = asString(fm.source || fm.url || fm.source_url);
  const { noteMarkdown, projectsFromBody } = extractNote(body);
  const projects = [...new Set([...asList(fm.projects), ...projectsFromBody].map(stripWikilink).filter((p) => p && p.toLowerCase() !== "moodboard"))];
  const created = asString(fm.created) || (await stat(file)).mtime.toISOString().slice(0, 10);

  return {
    file,
    fileName: basename(file, ".md"),
    id: asString(fm.id) || (sourceUrl ? idFor(sourceUrl) : idFor(file)),
    title: cleanTitle(asString(fm.title) || basename(file, ".md")),
    sourceUrl,
    source: displaySource(fm.author, sourceUrl),
    author: stripWikilink(asString(fm.author)),
    description: asString(fm.description),
    category: asString(fm.category),
    style: asList(fm.style).map((s) => s.trim()).filter(Boolean),
    projects,
    publish: asBool(fm.publish),
    created,
    imageUrl: asString(fm.image),
    videoUrl: asString(fm.video),
    clippedImage: firstImageIn(body),
    noteMarkdown,
    curationNote: notePlainText(noteMarkdown),
    isX: isXUrl(sourceUrl),
  };
}

/** Every allai note in the configured folders, newest clip first. */
export async function readItems({ onError } = {}) {
  const items = [];
  for (const dir of vaultDirs()) {
    for (const file of await walk(dir)) {
      try {
        const item = await readItem(file);
        if (item) items.push(item);
      } catch (err) {
        onError?.(file, err);
      }
    }
  }
  // "dark" and "Dark" are one style. Normalise here so the site's filter,
  // moodboards and annotations all see a single spelling. Notes are untouched.
  const canon = styleCanon(items);
  for (const item of items) item.style = [...new Set(item.style.map((s) => canon.get(s.toLowerCase()) || s))];
  return items.sort((a, b) => b.created.localeCompare(a.created) || a.title.localeCompare(b.title));
}

/**
 * One spelling per style, keyed by its lowercase form. A capitalised
 * spelling wins over an all-lowercase one (the site's tags are Title Case);
 * among several, the most used. An all-lowercase-only style gets Title Case.
 */
export function styleCanon(items) {
  const counts = new Map(); // lower -> Map(spelling -> count)
  for (const item of items) {
    for (const raw of item.style) {
      const s = raw.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!counts.has(key)) counts.set(key, new Map());
      counts.get(key).set(s, (counts.get(key).get(s) || 0) + 1);
    }
  }
  const canon = new Map();
  for (const [key, spellings] of counts) {
    const ranked = [...spellings].sort((a, b) => Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])) || b[1] - a[1]);
    const best = ranked[0][0];
    canon.set(key, /[A-Z]/.test(best) ? best : titleCase(best));
  }
  return canon;
}

/** Styles in use with how often, most used first, in their canonical spelling. */
export function styleVocabulary(items) {
  const counts = new Map();
  for (const item of items) for (const s of item.style) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

export function titleCase(s) {
  return String(s).replace(/(^|[\s-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Rewrites only the given frontmatter keys, line by line, so the rest of the
 * note stays byte-for-byte as Oykun wrote it. Values are written as quoted
 * strings; pass null to remove a key.
 */
export async function setFrontmatterKeys(file, updates) {
  const text = await readFile(file, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)(\r?\n)---(\r?\n|$)/);
  if (!m) throw new Error(`${file} has no frontmatter block`);
  const nl = m[2];
  let lines = m[1].split(/\r?\n/);

  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
    const line = value == null ? null : `${key}: ${JSON.stringify(String(value))}`;
    if (idx >= 0) {
      // Drop any indented continuation (a list value) under the key.
      let end = idx + 1;
      while (end < lines.length && /^\s+(- |\S)/.test(lines[end]) && lines[end].startsWith(" ")) end++;
      lines.splice(idx, end - idx, ...(line ? [line] : []));
    } else if (line) {
      lines.push(line);
    }
  }

  const next = `---${nl}${lines.join(nl)}${nl}---${m[3]}` + text.slice(m[0].length);
  if (next !== text) await writeFile(file, next, "utf8");
}
