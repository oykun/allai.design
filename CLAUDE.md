# allai.design

Curated AI × design, by Oykun. Static Astro site on Vercel; the content queue
is the Obsidian vault. Read `allai-design-project-instructions.md` for the
editorial brief and voice.

## How content flows

1. Clip a page with the Obsidian Web Clipper **allai** template (`clipper/`).
   The note lands in `~/Obsidian/Clippings/` with the `allai` tag.
2. Oykun writes **What I like** in the note, sets `category`, `style`,
   `projects` (wikilinks to client projects), and ticks `publish`.
3. `npm run sync` captures media to R2, writes `image`/`video` into the note,
   writes `src/data/items.json`, commits that file and pushes. Vercel builds.
4. `npm run moodboard <project>` exports a project's references with notes to
   `~/Obsidian/_AI OS/moodboards/<project>/`.

Full detail, rules and troubleshooting: `.claude/skills/publish-allai/SKILL.md`.

## Rules

- The vault is Oykun's. Scripts read it; the only writes are `image`/`video`
  (and `gallery`) on a note he marked `publish`, and `category` (plus `style`
  when empty) on a published note saved without one, picked by `claude -p`
  during the sync. Claude never edits a clip by hand unless Oykun asks.
- Never use a site's og:image as the item's visual. Capture the real page.
- The repo is public: the snapshot carries no `projects` and no unpublished
  notes. Keep secrets in `.env`.
- Item shape stays generic (stable `id`, plain fields): the data may move into
  the Designer Mindset platform later, when members get access.
