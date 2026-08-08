---
name: sync-from-notion
description: Publish curated items from the Notion content queue to the live allai.design site. Use when Oykun says "sync allai", "publish the new items", "push allai live", "update the site from Notion", or after editing rows in the allai.design Notion database. Also covers why a published item is missing from the feed.
---

# Sync allai.design from Notion

## The one thing to understand

The site is a **static Astro build** (`output: 'static'`). `src/lib/notion.js`
queries Notion **once, at build time**, filtered to `Status = Published`.

Nothing polls Notion at runtime. **A Notion edit changes nothing until the site
rebuilds.** That is the whole reason this skill exists.

## Normal run

```bash
npm run sync
```

Preflights the database, fires the Vercel deploy hook, and — if `VERCEL_TOKEN`
is set — waits and reports the live URL. The build takes ~15 seconds.

To inspect without deploying:

```bash
npm run sync -- --dry
```

The rebuild runs on the **same commit**. No code change and no commit is needed
to publish content; pushing to `main` also rebuilds, but that is for code.

## What a row needs to appear

All three, or it silently won't show:

| Property | Requirement |
|---|---|
| `Status` | `Published` — anything else is excluded by the query |
| `Category` | one of the six options; blank means every category filter hides it |
| `Image URL` or `Video URL` | the grid is image-led; no media renders an empty card |

`Style` is optional but is the only remaining facet, so an item without it can't
be filtered to. The preflight in `npm run sync` reports each of these problems by
name before deploying — read its output rather than deploying and eyeballing.

## Media

**Never use a site's `og:image`.** That is the marketing card a site ships for
social previews — not its design. For a website link, always capture the real
page:

```bash
npm run capture <url> --notion <notion-page-id>
```

Records a 5-second clip (holds for entry animations, then eases down through two
viewports), takes a still at the top, uploads both to R2, and writes `Video URL`
and `Image URL` back to the row. The still doubles as the video's poster frame.
Add `--still` for a screenshot only. Omit `--notion` to capture without writing.

Requires `playwright` (a devDependency) and `ffmpeg` (`brew install ffmpeg`).
Consent banners are auto-dismissed, choosing reject over accept.

Capturing also sidesteps sites that rate-limit direct asset fetches — trynia.ai
returns 429 on its own og:image but records fine.

For media that is already an artefact rather than a page — an X post's image or
video — pull it from the source instead. X exposes it without scraping:

```
https://cdn.syndication.twimg.com/tweet-result?id=<tweetId>&token=a
```

Then re-host whatever you get, so the feed never depends on someone else's CDN:

```bash
npm run upload-media <sourceUrlOrLocalPath> items/<notion-page-id>/<filename>
```

It accepts a local file as well as a URL, and prints JSON with the permanent R2
URL. The preflight flags any published row whose media is not on `R2_PUBLIC_URL`.

## Schema notes

Two properties are **deliberately dead**: `Type` and `Tags`. Their values were
folded into `Style` when the filters collapsed to Category + Style. The columns
still exist but are empty and unread — don't start populating them again.

`Category` is a fixed list in `src/pages/index.astro`, not derived from the data,
so the nav order stays stable and empty categories stay visible. **Adding a
category means editing both** that array and the Notion select. When updating the
Notion select via the API, read the existing options and carry them over by id —
the API replaces the entire option set, so writing only the new one wipes the
rest and blanks every row's category.

## Where it deploys

Vercel project `allai-design` (`prj_lySdys4Xj5WyNgfELh5zuqanaOZh`), team
`team_fxa0TumJP3RcFPCnxuYekutZ`, building from `main` on
github.com/oykun/allai.design.

The deploy hook is named `allai-nightly` and lives in `VERCEL_DEPLOY_HOOK_URL`
in `.env`. **Keep it out of the repo — the repo is public, and the URL is enough
to trigger unlimited production deploys.**

## Troubleshooting

- **Published item missing from the feed** → run `npm run sync -- --dry` and read
  the warnings. It is nearly always missing media or a missing category.
- **Site looks stale** → the build is cached content, not live data. Re-run the
  sync.
- **`allai.design` doesn't resolve** → that is a domain problem, not a build
  problem. Check the registry delegation directly, which is ground truth:
  `dig +norecurse @a.nic.design. allai.design NS`. The `.vercel.app` URL working
  while the apex fails means DNS, never the build.
