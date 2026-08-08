#!/usr/bin/env node
/**
 * Publishes the current state of the Notion database to the live site.
 *
 * The site is a static Astro build that queries Notion at build time, so a
 * Notion edit changes nothing until the site rebuilds. This fires the Vercel
 * deploy hook, which rebuilds on the same commit — no code change, no commit.
 *
 * Usage:
 *   npm run sync           preflight, then deploy
 *   npm run sync -- --dry  preflight only, no deploy
 *
 * Required env (see .env.example):
 *   NOTION_TOKEN, NOTION_DATABASE_ID   read the queue for the preflight
 *   VERCEL_DEPLOY_HOOK_URL             the deploy hook to fire
 *
 * Optional env — without these the script fires and exits without waiting:
 *   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID   poll until the build lands
 */

import "dotenv/config";
import { Client } from "@notionhq/client";

const DRY = process.argv.includes("--dry");
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_EVERY_MS = 4000;

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * An item only reaches the feed if it is Published AND has media — the grid is
 * image-led, so a row missing both URLs renders as an empty placeholder card.
 * Surfacing that here is the point: it's the mistake that silently costs you a
 * deploy cycle.
 */
async function preflight() {
  const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    die("Missing NOTION_TOKEN or NOTION_DATABASE_ID — check .env");
  }

  const notion = new Client({ auth: NOTION_TOKEN });
  const res = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: 100,
  });

  // Compare against the bucket actually in use rather than a hardcoded host —
  // R2_PUBLIC_URL is the r2.dev address until a custom domain is attached.
  const r2Host = (process.env.R2_PUBLIC_URL || "").replace(/^https?:\/\//, "");

  const rows = res.results.map((page) => {
    const p = page.properties;
    const media = p["Image URL"]?.url || p["Video URL"]?.url || "";
    return {
      title: p["Title"]?.title?.[0]?.plain_text ?? "(untitled)",
      status: p["Status"]?.select?.name ?? "",
      category: p["Category"]?.select?.name ?? "",
      hasMedia: Boolean(media),
      selfHosted: Boolean(r2Host) && media.includes(r2Host),
    };
  });

  const published = rows.filter((r) => r.status === "Published");
  const pending = rows.filter((r) => r.status !== "Published");

  console.log(`\n${published.length} item(s) will be published.\n`);

  const noMedia = published.filter((r) => !r.hasMedia);
  const noCategory = published.filter((r) => !r.category);
  const hotlinked = published.filter((r) => r.hasMedia && !r.selfHosted);

  for (const [label, list] of [
    ["no image or video — will render an empty card", noMedia],
    ["no category — hidden by every category filter", noCategory],
    ["media still hotlinked, not on R2 — link may rot", hotlinked],
  ]) {
    if (!list.length) continue;
    console.log(`  ! ${list.length} ${label}:`);
    for (const r of list) console.log(`      ${r.title}`);
    console.log();
  }

  if (pending.length) {
    console.log(`  ${pending.length} row(s) not published, so not included:`);
    for (const r of pending) {
      console.log(`      ${r.title}${r.status ? ` (${r.status})` : ""}`);
    }
    console.log();
  }

  return published.length;
}

async function deploy() {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) die("Missing VERCEL_DEPLOY_HOOK_URL — check .env");

  const res = await fetch(hook, { method: "POST" });
  if (!res.ok) die(`Deploy hook returned ${res.status} ${res.statusText}`);

  const body = await res.json().catch(() => ({}));
  console.log(`→ build triggered${body?.job?.id ? ` (job ${body.job.id})` : ""}`);
  return body?.job?.id ?? null;
}

async function waitForDeployment() {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    console.log(
      "\nNot waiting for the build — set VERCEL_TOKEN and VERCEL_PROJECT_ID in .env to poll.\n" +
        "It usually lands in under a minute.\n",
    );
    return;
  }

  const url =
    `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=1` +
    (VERCEL_TEAM_ID ? `&teamId=${VERCEL_TEAM_ID}` : "");

  const startedAt = Date.now();
  let lastState = "";

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });
    if (!res.ok) {
      console.log(`  (couldn't read deployment status: ${res.status})`);
      return;
    }

    const { deployments = [] } = await res.json();
    const d = deployments[0];
    if (!d) continue;

    if (d.state !== lastState) {
      lastState = d.state;
      console.log(`  ${d.state.toLowerCase()}…`);
    }

    if (d.state === "READY") {
      console.log(`\n✓ live — https://${d.url}\n`);
      return;
    }
    if (["ERROR", "CANCELED"].includes(d.state)) {
      die(`Deployment ${d.state.toLowerCase()}: https://vercel.com/${d.inspectorUrl ?? ""}`);
    }
  }

  console.log("\nStill building after 5 minutes — check the Vercel dashboard.\n");
}

const count = await preflight();

if (DRY) {
  console.log("Dry run — nothing deployed.\n");
  process.exit(0);
}

if (count === 0) {
  die("Nothing is published — refusing to deploy an empty feed.");
}

await deploy();
await waitForDeployment();
