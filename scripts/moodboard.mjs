#!/usr/bin/env node
/**
 * Exports a project's references as one Markdown moodboard, images included,
 * ready to hand to an AI (or a human) at the start of a design project.
 *
 * Every allai note whose `projects` property names the project goes in —
 * published or not. Each entry is the visual plus the reason it was kept, which
 * is the whole point: "here's what I like, and why" beats a folder of images.
 *
 * Usage:
 *   npm run moodboard                       list projects and how many references each has
 *   npm run moodboard crucial.design        export → ~/Obsidian/_AI OS/moodboards/crucial-design/
 *   npm run moodboard crucial.design -- --out ./some/dir
 *   npm run moodboard -- --all              everything tagged allai, one board
 *
 * Output: <dir>/moodboard.md plus <dir>/images/. Re-running overwrites the
 * Markdown and only downloads images it doesn't have yet.
 */

import "dotenv/config";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { readItems, slugify, expandHome } from "./lib/vault.mjs";
import { fetchBuffer, EXT_BY_MIME } from "./lib/r2.mjs";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const outIdx = args.indexOf("--out");
const outArg = outIdx >= 0 ? args[outIdx + 1] : null;
const project = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1);

const DEFAULT_OUT = process.env.ALLAI_MOODBOARD_DIR || "~/Obsidian/_AI OS/moodboards";

const items = await readItems({ onError: (f, e) => console.log(`  ! skipped ${f}: ${e.message}`) });

// ---- list mode -------------------------------------------------------------

if (!project && !ALL) {
  const counts = new Map();
  for (const i of items) for (const p of i.projects) counts.set(p, (counts.get(p) || 0) + 1);
  if (!counts.size) {
    console.log("\nNo notes have a `projects` property yet. Add one (e.g. [[crucial.design]]) to any allai note.\n");
  } else {
    console.log("\nProjects:\n");
    for (const [p, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${p}`);
    }
    console.log(`\nExport one with: npm run moodboard <project>\n`);
  }
  process.exit(0);
}

// ---- export mode -----------------------------------------------------------

const slug = ALL ? "allai" : slugify(project);
const selected = ALL
  ? items
  : items.filter((i) => i.projects.some((p) => slugify(p) === slug || p.toLowerCase() === project.toLowerCase()));

if (!selected.length) {
  console.error(`✗ no notes name the project "${project}" — run \`npm run moodboard\` to see what exists`);
  process.exit(1);
}

const outDir = expandHome(outArg || join(DEFAULT_OUT, slug));
const imgDir = join(outDir, "images");
await mkdir(imgDir, { recursive: true });

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function saveImage(item) {
  // Prefer the still we captured ourselves, then what the clipper saved, then
  // the first image in the clipped content.
  const candidates = [item.imageUrl, item.clippedImage].filter(Boolean);
  for (const url of candidates) {
    try {
      const { buffer, contentType } = await fetchBuffer(url);
      if (!contentType.startsWith("image/")) continue;
      const ext = EXT_BY_MIME[contentType] || ".jpg";
      const name = `${slugify(item.title).slice(0, 60) || item.id}-${item.id.slice(0, 6)}${ext}`;
      const path = join(imgDir, name);
      if (!(await exists(path))) await writeFile(path, buffer);
      return `images/${name}`;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const today = new Date().toISOString().slice(0, 10);
const lines = [
  `# Moodboard: ${ALL ? "allai.design (everything)" : project}`,
  "",
  `Exported ${today} from Obsidian. ${selected.length} reference${selected.length === 1 ? "" : "s"}.`,
  "",
  "Each entry is a visual reference and the reason it was kept. Treat **What I like** as the brief: it names the specific decision worth taking from that reference, not the whole thing.",
  "",
];

let n = 0;
for (const item of selected) {
  n++;
  process.stdout.write(`  ${n}/${selected.length} ${item.title}`);
  const image = await saveImage(item);
  process.stdout.write(image ? "\n" : "  (no image)\n");

  const facets = [item.category, ...item.style].filter(Boolean).join(" · ");
  lines.push(`## ${n}. ${item.title}`, "");
  lines.push(`Source: ${item.sourceUrl}${item.source ? ` (${item.source})` : ""}`);
  if (facets) lines.push(`Tags: ${facets}`);
  if (item.videoUrl) lines.push(`Video: ${item.videoUrl}`);
  lines.push("");
  if (image) lines.push(`![${item.title}](${image})`, "");
  if (item.description) lines.push(`> ${item.description}`, "");
  lines.push("**What I like**", "", item.noteMarkdown || "_(no note yet)_", "");
}

const mdPath = join(outDir, "moodboard.md");
await writeFile(mdPath, lines.join("\n"));
console.log(`\n✓ ${mdPath}\n`);
