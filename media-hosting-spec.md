# Media self-hosting — handoff spec

## Why

Curated items currently store direct links to source CDNs (e.g. `video.twimg.com`,
`pbs.twimg.com`). These links can expire, rotate, or get rate-limited. recent.design
solves this by re-hosting media on their own CDN (`cdn.recent.design/items/...`).
We should do the same.

## What to build

A step in the curation pipeline (wherever items get added/queued into the
allai.design content queue) that:

1. Downloads the source image/video from the URL being curated.
2. Uploads it to Cloudflare R2 (recommended — no egress fees, ~$0–2/month at
   our volume).
3. Writes the resulting permanent R2 URL back into the item's
   `image` and/or `video` fields.

## Where this plugs in

**Status (Oct 2026): built.** `npm run sync` does all of this automatically
for every published note, and the content queue is the Obsidian vault, not
Notion (see `.claude/skills/publish-allai/SKILL.md`). The rest of this file is
the original spec, kept for the reasoning.

- Content queue: allai notes in the Obsidian vault
- Relevant frontmatter keys: `image`, `video` (written by the sync)
- The Astro site (this repo) just reads whatever URL is in those fields at
  build time — it doesn't care where the file is hosted.

## Suggested setup

1. **Cloudflare R2 bucket** — create one (e.g. `allai-design-media`), enable
   public access or a custom domain (`cdn.allai.design`) via a Worker or R2's
   public bucket feature.
2. **Upload script** — Node script using `@aws-sdk/client-s3` (R2 is
   S3-compatible) or Cloudflare's R2 SDK:
   - fetch(sourceUrl) → buffer
   - derive a stable key, e.g. `items/{notion-page-id}/{filename}`
   - PUT to R2
   - return the public URL (`https://cdn.allai.design/items/...`)
3. **Trigger point** — run this when an item is marked publish, before the
   Astro build picks it up. Could be:
   - A manual script run as part of the weekly curation batch, or
   - The nightly scheduled task, once curation is frequent enough.

## Cost estimate

At expected volume (curated feed, images + occasional short video clips,
maybe 50–200 items/month): well under R2's free tier (10GB storage, no
egress charges). Realistic cost: **$0–2/month**.

## Out of scope for this repo

The Astro pages need no changes for this. They read `imageUrl` / `videoUrl`
from the snapshot as-is — once those point to stable R2 URLs instead of source
CDN links, everything just works.
