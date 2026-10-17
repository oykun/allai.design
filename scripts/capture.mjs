#!/usr/bin/env node
/**
 * Records a clip + still of a live website, puts both on R2, and optionally
 * writes the URLs into an Obsidian note's frontmatter.
 *
 * `npm run sync` does this automatically for every published item that still
 * lacks R2 media, so this is for one-offs: re-capturing a site after a redesign,
 * or capturing before deciding whether to publish.
 *
 * Usage:
 *   npm run capture <url>                          record, upload, print URLs
 *   npm run capture <url> --note "<path/to/note.md>" ...and write image/video into the note
 *   npm run capture <url> --still                  still only, no video
 */

import "dotenv/config";
import { captureSite, hasFfmpeg } from "./lib/capture.mjs";
import { uploadToR2 } from "./lib/r2.mjs";
import { idFor } from "./lib/vault.mjs";
import { setFrontmatterKeys } from "./lib/vault.mjs";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const still = args.includes("--still");
const noteIdx = args.indexOf("--note");
const note = noteIdx >= 0 ? args[noteIdx + 1] : null;

if (!url) fail('Usage: npm run capture <url> [--note "<path>"] [--still]');
if (noteIdx >= 0 && (!note || note.startsWith("--"))) fail("--note needs a path");
if (!still && !(await hasFfmpeg())) fail("ffmpeg not found — install it (brew install ffmpeg) or pass --still");

console.log(`\nCapturing ${url}`);
const cap = await captureSite(url, { still, log: (m) => console.log(`  ${m}`) });

const slug = new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
const key = `items/${idFor(url)}`;

const image = await uploadToR2(cap.stillPath, `${key}/${slug}.jpg`);
console.log(`  still  ${Math.round(image.bytes / 1024)}kb  ${image.url}`);

let video = null;
if (cap.videoPath) {
  video = await uploadToR2(cap.videoPath, `${key}/${slug}.mp4`);
  console.log(`  video  ${Math.round(video.bytes / 1024)}kb  ${video.url}`);
}

if (note) {
  await setFrontmatterKeys(note, { image: image.url, ...(video ? { video: video.url } : {}) });
  console.log(`  → written to ${note}`);
}

await cap.cleanup();
console.log("done.\n");
