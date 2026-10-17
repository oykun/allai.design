#!/usr/bin/env node
/**
 * One-off: turns an export of the old Notion content queue into allai notes.
 *
 * Input is a JSON array of rows with the Notion property names as keys
 * (Title, Source URL, Category, Style, Curation Note, Image URL, Video URL,
 * Published Date, Status, id, created). Output is one Markdown note per row in
 * the shape the Web Clipper template produces, so `npm run sync` treats them
 * exactly like fresh clips. Existing R2 media URLs are kept as they are.
 *
 * Usage:
 *   node scripts/migrate-notion-export.mjs <rows.json> <outDir>
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yaml } from "yaml";
import { cleanTitle, expandHome } from "./lib/vault.mjs";

const [input, outArg] = process.argv.slice(2);
if (!input || !outArg) {
  console.error("Usage: node scripts/migrate-notion-export.mjs <rows.json> <outDir>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(input, "utf8"));
const outDir = expandHome(outArg);
await mkdir(outDir, { recursive: true });

const safeName = (s) =>
  s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 120);

let written = 0;
for (const row of rows) {
  const title = cleanTitle(row.Title || "Untitled");
  const sourceUrl = row["Source URL"] || "";
  let author = "";
  const x = sourceUrl.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status/);
  if (x) author = `@${x[1]}`;

  const fm = {
    title,
    source: sourceUrl,
    author: author ? [author] : [],
    published: "",
    created: (row["Published Date"] || row.created || "").slice(0, 10),
    description: "",
    image: row["Image URL"] || "",
    video: row["Video URL"] || "",
    tags: ["allai", "clippings"],
    category: row.Category || "",
    style: row.Style || [],
    projects: [],
    publish: row.Status === "Published",
  };
  // No `id` key: like a fresh clip, the id is derived from the source URL.
  // (Notion page ids share long prefixes, so a truncated one collides.)
  // Empty keys are noise in the property panel; the clipper leaves them out too.
  for (const [k, v] of Object.entries(fm)) {
    if (v === "" || v === undefined || (Array.isArray(v) && !v.length && k !== "projects")) delete fm[k];
  }

  const body = [
    "## What I like",
    "",
    row["Curation Note"] || "",
    "",
    "## Clipped",
    "",
    fm.image ? `![${title}](${fm.image})` : "",
    "",
    "_Migrated from the Notion content queue on " + new Date().toISOString().slice(0, 10) + "._",
    "",
  ].join("\n");

  let file = join(outDir, `${safeName(title)}.md`);
  try {
    await access(file);
    file = join(outDir, `${safeName(title)} (${written}).md`);
  } catch {
    /* free */
  }
  await writeFile(file, `---\n${yaml(fm)}---\n${body}`);
  written++;
  console.log(`  ${fm.publish ? "●" : "○"} ${title}`);
}
console.log(`\n${written} note(s) written to ${outDir}\n`);
