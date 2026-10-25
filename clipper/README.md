# The allai Web Clipper template

One template for the Obsidian Web Clipper (Safari and Chrome). Clip a page with
it and the note lands in the vault in the exact shape `npm run sync` and
`npm run moodboard` read.

## Install (once)

1. Open the Web Clipper extension → the cog (Settings) → any template → **Import**
   (top right), and pick `allai-clipper.json` from this folder. Or drag the file
   onto the template list.
2. Check the template's **Note location** says `Clippings` (change it if you'd
   rather keep allai clips in their own subfolder; the scripts read Clippings
   recursively).

## Daily use

1. On a page you like, open the clipper and pick **allai** from the template
   dropdown (it won't auto-select; most tweets aren't allai material).
2. Fill the properties that need you:
   - **category**: one of `Website Design` / `Product Design` /
     `Brand Design` / `Illustration` / `Tools` / `Reading`
   - **style**: anything useful (`Dark`, `Typographic`, `Bento`, …) — it becomes
     the Style filter on the site
   - **projects**: the client projects this is a reference for, as wikilinks:
     `[[crucial.design]]`, `[[multion]]`. They show as backlinks on that
     project's note in Obsidian.
   - **publish**: tick it when it should go on allai.design. Leave it unticked
     for private references.
3. Save. Then (in the popup or in Obsidian) write under **What I like** the
   specific thing worth keeping: the typography, how the animation is
   presented, the case-study structure. One to three lines. That note is the
   curation take on the site and the brief in every moodboard export.

Everything under `## Clipped` is the page content the clipper saved. Leave it;
the scripts only read what's above it.

## What the pipeline adds

`npm run sync` writes two keys back into a published note's frontmatter once
its media is on R2: `image` and `video`. That is the only thing the scripts
ever change in a note.
