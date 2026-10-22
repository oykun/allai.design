# The capture payload

One JSON object per capture, `POST`ed by the extension's background script to
the receiver (`npm run inbox`, `http://127.0.0.1:7711/capture`). The same
object is what the Designer Mindset platform's API will take later; nothing in
it is specific to the local receiver.

```json
{
  "version": 1,
  "source": "https://x.com/faydkr/status/2110033788541554743",
  "page": "https://x.com/home",
  "title": "Everyone at Mintlify builds with agents now. We built Mentha…",
  "image": "https://pbs.twimg.com/media/HUci8QWXoAAq7WC?format=jpg&name=orig",
  "imageAlt": "Image",
  "author": "@faydkr",
  "authorName": "Fayd",
  "text": "Everyone at Mintlify builds with agents now. …",
  "published": "2026-10-13",
  "siteKind": "x",

  "why": "Component sheet that reads as a product, not a spec: one accent, lots of air.",
  "category": "Reference Material",
  "style": ["Design System", "Light"],
  "projects": ["crucial.design"],
  "publish": false,

  "capturedAt": "2026-10-22T07:25:09.000Z",
  "client": { "name": "allai-extension", "version": "1.0.0", "browser": "chrome" }
}
```

## Fields

What the page gave us (read by `content.js`, best effort):

| Field | Required | Meaning |
|---|---|---|
| `source` | yes | The thing being kept. On X the post's permalink (`/user/status/id`), elsewhere the page URL. The item's twelve-character `id` is a hash of this, exactly as `scripts/lib/vault.mjs` computes it, so one source is one item. |
| `page` | no | Where the capture happened (the feed, a search page). Equals `source` on a plain page. |
| `title` | no | Prefilled from the post's first line or the page title; the person can edit it in the form. Becomes the note's file name. |
| `image` | no | Full-resolution URL of the clicked image (`name=orig` on X). Empty for "Add page to allai". |
| `imageAlt` | no | The image's alt text, used as the Markdown alt. |
| `author` | no | `@handle` on X; empty elsewhere. |
| `authorName` | no | Display name on X; `<meta name="author">` elsewhere. |
| `text` | no | The post's text on X; the page's meta description elsewhere. |
| `published` | no | `YYYY-MM-DD` from the post's timestamp or the page's `article:published_time`. |
| `siteKind` | no | `x` or `web`. Tells the receiver which reading rules applied. |

What the person typed:

| Field | Required | Meaning |
|---|---|---|
| `why` | **yes** | "What I like": one to three lines on the specific thing worth keeping. The receiver rejects a capture without it (HTTP 400). This line is the curation note on the site and the brief in every moodboard export. |
| `category` | no | One of the values in `CATEGORIES` (`scripts/lib/vault.mjs`). Anything else is rejected. Empty is allowed but hides the item from every category filter. |
| `style` | no | Free tags; the Style filter on the site. |
| `projects` | no | Client projects this is a reference for, plain names. The receiver writes them as wikilinks (`[[caura]]`). |
| `publish` | no | `true` to put it on allai.design on the next `npm run sync`. Default `false`. |

Envelope, added by the background script:

| Field | Meaning |
|---|---|
| `version` | Payload version, `1`. |
| `capturedAt` | ISO timestamp of the save. |
| `client` | `{ name, version, browser }` of whatever sent it. |

## Responses

`201 Created`

```json
{
  "ok": true,
  "id": "4e8596a29abe",
  "note": "/Users/you/Obsidian/_AI OS/allai/inbox/Everyone at Mintlify builds with agents now.md",
  "noteName": "Everyone at Mintlify builds with agents now",
  "image": "/Users/you/Obsidian/_AI OS/allai/inbox/4e8596a29abe/everyone-at-mintlify-builds-with-agents-now.jpg",
  "bytes": 92786,
  "warnings": []
}
```

`warnings` is non-empty when the note was written but something was not
perfect, most often `image not downloaded: …` (the note then links the remote
URL, and `npm run sync` still hosts the media itself).

`400 Bad Request` with `{ "ok": false, "error": "…" }` when a required field is
missing or a value is out of range. The form shows the error and keeps what
was typed. `500` for anything else (disk full, folder not writable).

`GET /health` answers `{ ok, name, version, inbox, port, categories }`; the
extension reads `categories` from it so the dropdown never drifts from the
scripts.

## What the receiver writes

A note in the shape of the Web Clipper template (`clipper/`), in
`~/Obsidian/_AI OS/allai/inbox/`:

```markdown
---
title: Everyone at Mintlify builds with agents now. We built Mentha…
source: https://x.com/faydkr/status/2110033788541554743
author:
  - "[[@faydkr]]"
published: 2026-10-13
created: 2026-10-22
description: Everyone at Mintlify builds with agents now. …
image: https://pbs.twimg.com/media/HUci8QWXoAAq7WC?format=jpg&name=orig
tags:
  - allai
  - extension
category: Reference Material
style:
  - Design System
  - Light
projects:
  - "[[crucial.design]]"
publish: false
---
## What I like

Component sheet that reads as a product, not a spec: one accent, lots of air.

## Clipped

Everyone at Mintlify builds with agents now. …

![Image](4e8596a29abe/everyone-at-mintlify-builds-with-agents-now.jpg)

_Captured from https://x.com/home with the allai extension (chrome) on 2026-10-22._
```

`image` in the frontmatter stays the remote URL on purpose: `npm run sync`
replaces it with the R2 copy once the item is published, and
`npm run moodboard` fetches it over HTTP. The downloaded file beside the note
is the offline copy, linked relatively so Obsidian shows it inline.
