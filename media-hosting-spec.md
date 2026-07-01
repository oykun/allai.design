# Media self-hosting — handoff spec

## Why

Curated items currently store direct links to source CDNs (e.g. `video.twimg.com`,
`pbs.twimg.com`). These links can expire, rotate, or get rate-limited. recent.design
solves this by re-hosting media on their own CDN (`cdn.recent.design/items/...`).
We should do the same.

## What to build

A step in the curation pipeline (wherever items get added/queued into the
allai.design Notion database) that:

1. Downloads the source image/video from the URL being curated.
2. Uploads it to Cloudflare R2 (recommended — no egress fees, ~$0–2/month at
   our volume).
3. Writes the resulting permanent R2 URL back into the Notion page's
   **Image URL** and/or **Video URL** properties.

## Where this plugs in

- Notion database: `[DB] allai.design content queue`
  (`ae146257094c499bbd8a4cc2932920c0`)
- Relevant properties: `Image URL` (url), `Video URL` (url, already added)
- The Astro site (this repo) just reads whatever URL is in those fields at
  build time — it doesn't care where the file is hosted. No changes needed
  here once URLs are stable.

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
3. **Trigger point** — run this when an item's Status changes to "Queued" or
   "Published," before the Astro build picks it up. Could be:
   - A manual script run as part of the weekly curation batch, or
   - A Notion automation / webhook → serverless function, if curation becomes
     frequent enough to justify automating it.

## Cost estimate

At expected volume (curated feed, images + occasional short video clips,
maybe 50–200 items/month): well under R2's free tier (10GB storage, no
egress charges). Realistic cost: **$0–2/month**.

## Out of scope for this repo

This repo (allai.design Astro site) does not need any code changes for this.
It already reads `Image URL` / `Video URL` from Notion as-is — once those
fields point to stable R2 URLs instead of source CDN links, everything just
works.
