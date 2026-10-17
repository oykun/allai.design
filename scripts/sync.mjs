#!/usr/bin/env node
/**
 * Publishes the vault's allai items to the live site.
 *
 * Obsidian is the content queue: a note with the `allai` tag and `publish: true`
 * is an item. Vercel can't see the vault, so the site builds from a snapshot
 * committed to the repo (src/data/items.json). This script makes that snapshot:
 *
 *   1. reads every allai note in the vault (scripts/lib/vault.mjs)
 *   2. re-hosts media on R2 for published items that still lack it —
 *      X posts via the syndication endpoint, websites by recording the page —
 *      and writes `image` / `video` into the note's frontmatter
 *   3. writes src/data/items.json with the published items only
 *      (no projects, no unpublished notes — the repo is public)
 *   4. commits that file and pushes, which triggers the Vercel build
 *
 * Usage:
 *   npm run sync               everything above
 *   npm run sync -- --dry      report only: touches nothing, uploads nothing
 *   npm run sync -- --no-push  media + snapshot, but leave git alone
 *
 * Env (see .env.example): R2_*, optionally ALLAI_VAULT_DIRS.
 */

import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CATEGORIES, readItems, setFrontmatterKeys, slugify } from "./lib/vault.mjs";
import { isOnR2, uploadToR2 } from "./lib/r2.mjs";
import { tweetId, fetchTweet, pickMedia } from "./lib/x.mjs";
import { captureSite, hasFfmpeg } from "./lib/capture.mjs";

const run = promisify(execFile);

const DRY = process.argv.includes("--dry");
const NO_PUSH = process.argv.includes("--no-push");
const SNAPSHOT = "src/data/items.json";

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const warn = (items, label) => {
  if (!items.length) return;
  console.log(`  ! ${items.length} ${label}:`);
  for (const i of items) console.log(`      ${i.title}  (${i.fileName}.md)`);
  console.log();
};

// ---------------------------------------------------------------------------

async function hostMedia(item) {
  const key = `items/${item.id}`;
  const slug = slugify(item.title).slice(0, 60) || item.id;

  if (item.isX) {
    const tweet = await fetchTweet(tweetId(item.sourceUrl));
    let media = pickMedia(tweet);
    // X Articles (long-form posts) carry no media in the syndication payload,
    // but the clipper saved the article's own images — those are the real
    // thing, not a marketing card, so they're fine to use.
    if (!media) {
      const saved = [item.imageUrl, item.clippedImage].find((u) => /pbs\.twimg\.com/.test(u || ""));
      if (!saved) throw new Error("post has no image or video");
      media = { video: null, poster: saved };
    }
    const updates = {};
    if (media.video) {
      updates.video = (await uploadToR2(media.video, `${key}/${slug}.mp4`)).url;
    }
    if (media.poster) {
      const ext = /\.png/i.test(media.poster) ? "png" : "jpg";
      updates.image = (await uploadToR2(media.poster, `${key}/${slug}.${ext}`)).url;
    }
    return updates;
  }

  // Anything else is a web page: record it. Never fall back to og:image —
  // that's the site's marketing card, not its design.
  const still = !(await hasFfmpeg());
  if (still) console.log("    ffmpeg not found — still only (brew install ffmpeg for video)");
  const cap = await captureSite(item.sourceUrl, { still, log: (m) => console.log(`    ${m}`) });
  const updates = { image: (await uploadToR2(cap.stillPath, `${key}/${slug}.jpg`)).url };
  if (cap.videoPath) updates.video = (await uploadToR2(cap.videoPath, `${key}/${slug}.mp4`)).url;
  await cap.cleanup();
  return updates;
}

async function ensureMedia(items) {
  const needs = items.filter((i) => !isOnR2(i.imageUrl) && !isOnR2(i.videoUrl));
  if (!needs.length) return [];

  if (DRY) {
    warn(needs, "need media hosted on R2 — a real run captures these");
    return needs; // excluded from the dry count below
  }

  const failed = [];
  for (const item of needs) {
    console.log(`  → hosting media: ${item.title}`);
    try {
      const updates = await hostMedia(item);
      await setFrontmatterKeys(item.file, updates);
      Object.assign(item, { imageUrl: updates.image || item.imageUrl, videoUrl: updates.video || item.videoUrl });
      console.log(`    ${Object.keys(updates).join(" + ")} → R2`);
    } catch (err) {
      console.log(`    ✗ ${err.message}`);
      failed.push(item);
    }
  }
  console.log();
  return failed;
}

function toPublic(item) {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    category: item.category,
    style: item.style,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    videoUrl: item.videoUrl,
    curationNote: item.curationNote,
    publishedDate: item.created,
  };
}

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(SNAPSHOT, "utf8"));
  } catch {
    return [];
  }
}

async function commitAndPush(count, newTitles) {
  const { stdout: branch } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const { stdout: status } = await run("git", ["status", "--porcelain", "--", SNAPSHOT]);
  if (!status.trim()) {
    console.log("Snapshot unchanged — nothing to commit.\n");
    return;
  }

  const summary = newTitles.length
    ? `Publish ${newTitles.length} new item${newTitles.length === 1 ? "" : "s"}`
    : `Update published items`;
  const body = newTitles.map((t) => `- ${t}`).join("\n");
  await run("git", ["add", "--", SNAPSHOT]);
  await run("git", ["commit", "-q", "-m", `${summary} (${count} live)`, ...(body ? ["-m", body] : []), "--", SNAPSHOT]);
  console.log(`→ committed on ${branch.trim()}`);

  try {
    await run("git", ["push", "-q", "origin", "HEAD"]);
    console.log(`→ pushed. Vercel builds from main; it usually lands in under a minute.`);
    if (branch.trim() !== "main") {
      console.log(`  (you're on ${branch.trim()} — production only updates once this reaches main)`);
    }
  } catch (err) {
    console.log(`✗ push failed: ${err.stderr || err.message}`);
    console.log("  The commit is local — push it yourself when you're online.");
  }
  console.log();
}

// ---------------------------------------------------------------------------

const errors = [];
const all = await readItems({ onError: (file, err) => errors.push(`${file}: ${err.message}`) });
for (const e of errors) console.log(`  ! skipped ${e}`);

const published = all.filter((i) => i.publish);
const pending = all.filter((i) => !i.publish);

console.log(`\n${all.length} allai note(s) in the vault, ${published.length} marked publish.\n`);

// Problems the preflight should name before anything ships.
warn(published.filter((i) => !i.sourceUrl), "have no source URL — can't be published");
warn(published.filter((i) => !i.category), "have no category — hidden by every category filter");
warn(published.filter((i) => i.category && !CATEGORIES.includes(i.category)),
  `have a category outside the fixed list (${CATEGORIES.join(" / ")})`);
warn(published.filter((i) => !i.curationNote), "have no 'What I like' note — the card will have no take");

const publishable = published.filter((i) => i.sourceUrl);
const failed = await ensureMedia(publishable);
const hosted = publishable.filter((i) => !failed.includes(i) && (isOnR2(i.imageUrl) || isOnR2(i.videoUrl)));
if (!DRY) warn(failed, "could not get media — left off the site until fixed");

// Two notes clipped from the same page are one item; the first (newest) wins.
const seen = new Set();
const duplicates = [];
const live = hosted.filter((i) => (seen.has(i.id) ? (duplicates.push(i), false) : (seen.add(i.id), true)));
warn(duplicates, "duplicate another published note's source URL — only one is shown");

if (pending.length) {
  console.log(`  ${pending.length} note(s) not marked publish, so not included:`);
  for (const i of pending) console.log(`      ${i.title}`);
  console.log();
}

const before = await readSnapshot();
const beforeIds = new Set(before.map((i) => i.id));
const newTitles = live.filter((i) => !beforeIds.has(i.id)).map((i) => i.title);

console.log(`${live.length} item(s) go live${newTitles.length ? `, ${newTitles.length} new:` : "."}`);
for (const t of newTitles) console.log(`      + ${t}`);
console.log();

if (DRY) {
  console.log("Dry run — nothing written, uploaded, or deployed.\n");
  process.exit(0);
}
if (live.length === 0) die("Nothing is publishable — refusing to write an empty feed.");

await mkdir("src/data", { recursive: true });
await writeFile(SNAPSHOT, JSON.stringify(live.map(toPublic), null, 2) + "\n");
console.log(`→ wrote ${SNAPSHOT}`);

if (NO_PUSH) {
  console.log("--no-push: snapshot written, git untouched.\n");
} else {
  await commitAndPush(live.length, newTitles);
}
