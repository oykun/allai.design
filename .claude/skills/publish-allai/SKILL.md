---
name: publish-allai
description: Publish curated items from the Obsidian vault to the live allai.design site, export a project's references as a moodboard, or explain why a published item is missing from the feed. Use when Oykun says "sync allai", "publish the new items", "push allai live", "update the site from Obsidian", "moodboard for <project>", or after clipping and ticking publish on notes in the vault.
---

# Publish allai.design from Obsidian

## The one thing to understand

Obsidian is the content queue. A note is an item when it carries the `allai`
tag; it goes live when `publish` is ticked. The site is a **static Astro build**
that reads `src/data/items.json`, a snapshot **committed to the repo** — Vercel
cannot see the vault. So a vault edit changes nothing until `npm run sync`
writes the snapshot, commits and pushes.

Clips come from the Web Clipper template in `clipper/` (install notes in
`clipper/README.md`). The scripts read `~/Obsidian/Clippings` and
`~/Obsidian/_AI OS/allai` (the items migrated from Notion in Oct 2026).

## Normal run

```bash
npm run sync
```

In order: reads the vault, names every problem, re-hosts media on R2 for
published items that still lack it (X posts via the syndication endpoint,
websites by recording the page), writes `image`/`video` into those notes'
frontmatter, writes the snapshot, commits only that file, pushes. The Vercel
build takes about 15 seconds and runs from `main`.

```bash
npm run sync -- --dry       # report only — touches nothing, uploads nothing
npm run sync -- --no-push   # media + snapshot, leave git alone
```

Always read the output. The preflight is where mistakes surface.

## What a note needs to go live

| Property | Requirement |
|---|---|
| `tags` | includes `allai` |
| `publish` | ticked (`true`) |
| `source` | the page URL — the id and the media come from it |
| `category` | one of the six in `scripts/lib/vault.mjs` (`CATEGORIES`); blank is hidden by every category filter |
| media | the sync captures it; a note is left off the site until that succeeds |

`style` is optional but is the only other facet. The text under **What I like**
is the curation note on the card; a note without one is reported.

## The vault rule

Claude writes only inside `~/Obsidian/_AI OS/` and `~/Obsidian/Skills/`. The
sync's one sanctioned exception is the pipeline-owned `image` and `video`
frontmatter keys on a note Oykun marked `publish`, written line by line so
nothing else in the note changes. Never edit a clip's text, tags, category or
note. If something is wrong with a note, tell Oykun what to change.

## Media

**Never use a site's `og:image`.** That is the marketing card a site ships for
social previews, not its design. The sync records the real page instead. To
re-capture by hand (after a redesign, or before deciding to publish):

```bash
npm run capture <url>                              # record, upload, print URLs
npm run capture <url> --note "~/Obsidian/Clippings/<note>.md"   # ...and write them into the note
npm run capture <url> --still                      # screenshot only
```

Needs `playwright` (devDependency; run `npx playwright install chromium` once
per machine) and `ffmpeg` (`brew install ffmpeg`). Consent banners are
auto-dismissed, choosing reject over accept.

For a one-off file that is already an artefact:

```bash
npm run upload-media <sourceUrlOrLocalPath> items/<id>/<filename>
```

## Moodboards

```bash
npm run moodboard                      # projects and counts
npm run moodboard crucial.design       # → ~/Obsidian/_AI OS/moodboards/crucial-design/moodboard.md + images/
npm run moodboard -- --all             # the whole collection
```

Every allai note whose `projects` property names the project goes in,
published or not. The export is the visual plus **What I like** for each — the
brief to hand an AI at the start of a design project.

## Schema notes

`category` is a fixed list in `src/pages/index.astro` **and** `CATEGORIES` in
`scripts/lib/vault.mjs`; adding one means editing both. `style` and `projects`
are free lists. Projects are wikilinks (`[[crucial.design]]`) so each project
note shows its references as backlinks in Obsidian.

The snapshot carries only public fields: no `projects`, no unpublished notes.
The repo is public.

## Where it deploys

Vercel project `allai-design` (`prj_lySdys4Xj5WyNgfELh5zuqanaOZh`), team
`team_fxa0TumJP3RcFPCnxuYekutZ`, building from `main` on
github.com/oykun/allai.design. Pushing `main` is the deploy; the old deploy
hook is no longer needed.

## Troubleshooting

- **Published item missing from the feed** → `npm run sync -- --dry` and read
  the warnings: no category, no media, or `publish` not ticked.
- **Site looks stale** → the snapshot hasn't been pushed, or it went to a
  branch other than `main`. `git log -1 -- src/data/items.json`.
- **Capture fails on a site** → run `npm run capture <url>` by hand to see the
  error; some sites block headless browsers. Last resort is a manual
  screenshot uploaded with `upload-media`, never the og:image.
- **`allai.design` doesn't resolve** → DNS, never the build:
  `dig +norecurse @a.nic.design. allai.design NS`.
