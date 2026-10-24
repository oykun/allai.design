# The allai browser extension

Right-click an image in the X feed, pick **Add to AllAI**, write one line on
what you like, press Enter. A note with the image lands in your Obsidian vault
in the exact shape the allai.design pipeline reads, so `npm run sync`,
`npm run moodboard` and `npm run annotate` pick it up unchanged.

The Web Clipper template in `clipper/` captures whole pages. This is for the
other 90% of curation: a single image in a feed, where the clipper can't reach.

```
right-click ───────▶ form (What I like, category, style, projects, publish)
                           │ POST http://127.0.0.1:7711/capture
                           ▼
                 npm run inbox  (a 300-line Node server on your Mac)
                           │ downloads the image, writes the note
                           ▼
          ~/Obsidian/_AI OS/allai/inbox/<title>.md  +  <id>/<image>.jpg
                           │
                           ▼
               npm run sync / moodboard / annotate, as before
```

Nothing leaves your machine. The extension talks only to the receiver on
localhost; the receiver writes only inside the one inbox folder.

Folder:

- `src/` — the extension itself (Manifest V3, plain JavaScript, no build step). Loads as-is in Chrome; wrapped for Safari.
- `safari/` — the Xcode project `safari-web-extension-converter` generated around `src/`. It references `src/` rather than copying it, so an edit in `src/` is in the next build.
- `build-safari.sh` — builds that project and opens the app once (which registers the extension with Safari).
- `payload.md` — what the extension sends and what the receiver writes. Read it before pointing the extension at anything other than the local receiver.

## 1. Start the receiver

In the allai.design folder:

```bash
npm run inbox
```

It prints where it listens and where it writes. Leave it running, or install
it as a login item once and forget it:

```bash
npm run inbox -- --install     # writes ~/Library/LaunchAgents/design.allai.inbox.plist and starts it
npm run inbox -- --status      # is it up, where does it write, where is the log
npm run inbox -- --uninstall
```

The launchd job runs the same script with the Node you installed it with,
working directory set to the repo (so `.env` is read), logging to
`~/Library/Logs/allai-inbox.log`, restarted if it ever dies. The plist it
writes looks like this (paths filled in for your machine):

```xml
<key>Label</key>            <string>design.allai.inbox</string>
<key>ProgramArguments</key> <array><string>/path/to/node</string><string>/path/to/allai.design/scripts/inbox.mjs</string></array>
<key>WorkingDirectory</key> <string>/path/to/allai.design</string>
<key>RunAtLoad</key>        <true/>
<key>KeepAlive</key>        <true/>
<key>StandardOutPath</key>  <string>~/Library/Logs/allai-inbox.log</string>
```

Settings, all optional, in the repo's `.env` (see `.env.example`):

| Variable | Default | |
|---|---|---|
| `ALLAI_INBOX_PORT` | `7711` | Change it here **and** in the extension's settings page. |
| `ALLAI_INBOX_DIR` | `~/Obsidian/_AI OS/allai/inbox` | Must sit inside `ALLAI_VAULT_DIRS`, or the sync won't see the notes. The receiver warns at start if it doesn't. |

## 2. Install in Safari

Safari only runs web extensions wrapped in a Mac app, so there is a build
step. You need Xcode (free, from the App Store) and an Apple ID. A **free**
Apple ID is enough: sign the build with its Personal Team and Safari keeps the
extension on across restarts. No paid developer membership needed for your
own Mac.

**Signed, for daily use (do this):**

1. Xcode → Settings → **Accounts** → **+** → Apple Account, and sign in. Your
   name appears with a team called "Your Name (Personal Team)".
2. Find that team's ten-character id. In Terminal:
   `defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier | grep -A2 teamID`
   (or pick the team once in the project's Signing & Capabilities and read
   `DEVELOPMENT_TEAM` from the project file).
3. Put it in the repo's `.env`: `ALLAI_APPLE_TEAM=ABCDE12345`.
4. `extension/build-safari.sh`. It prints `signing: ABCDE12345`, builds, and
   opens the `allai` app once, which registers the extension. Close the app's
   window.
5. Safari → Settings → **Extensions** → tick **allai**. On the first
   right-click on x.com choose **Always Allow on This Website**.

Check it worked: Safari → Settings → Developer → untick **Allow unsigned
extensions**. If allai stays in the Extensions list, it's signed. The
certificate Xcode creates lasts a year; rebuild after that.

**Unsigned, to try it quickly:** Safari → Settings → **Developer** → tick
**Allow unsigned extensions** (asks for your password) → **Add Temporary
Extension…** → pick `extension/src`. No Xcode needed. Safari forgets both the
switch and the extension every time it quits, so you redo those two steps
after each restart. (The unsigned *app* from `build-safari.sh` without a team
is not always picked up by Safari; the temporary route is more reliable.)

**Giving it to someone else:** Xcode → Product → Archive → Distribute App →
**Direct Distribution** signs with a Developer ID and notarizes, which does
need the paid Apple Developer Program. They move `allai.app` to Applications
and open it once.

After a rebuild, quit and reopen Safari once (Safari → Quit Safari, not just
closing the window): it keeps the previous build's menu item until then.

## 3. Install in Chrome

`chrome://extensions` → **Developer mode** (top right) → **Load unpacked** →
choose `extension/src`. That's it; no build. Chrome reloads it when you press
the reload icon on the card after editing a file.

## Daily use

There is one menu item, **Add to AllAI**, everywhere. It captures the image when you right-clicked one, otherwise the page (on X: the post you right-clicked).

- **On X:** right-click the image → **Add to AllAI**. The form knows the post: handle, name, text, permalink, the timestamp, and the original-resolution file (`name=orig`, not the feed's `small`).
- **A post with several pictures:** right-click any one of them → **Add to AllAI**. The whole gallery is one item: every picture is downloaded into the item's folder and linked in the note, the one you clicked is the cover (`image`), and the form says "· 4 images".
- **A video on X:** the player draws X's own menu, so right-click the post's *text* instead → **Add to AllAI**. The form knows which post you clicked, in the feed too; the note gets the video's poster frame as its image, and `npm run sync` fetches the video itself when you publish.
- **Anywhere else:** right-click an image → **Add to AllAI** sends the image with the page's title, description and author. Right-click the page (or click the toolbar icon) sends the page with no image; `npm run sync` records the page itself, as it does for clipper notes.
- **What I like** is the one required field. One to three lines on the specific thing worth keeping: not "nice", but "the pricing table uses one accent colour and it's on the number, not the button". That line becomes the card's note on the site, the file name of the image in every moodboard export, and the brief the AI annotator reads.
- **Category** is the fixed list (seven today). **Style** is free tags, comma-separated. **Projects** are client project names (`caura, crucial.design`); the last value you used is prefilled next time. **Publish** puts it on allai.design at the next sync.
- **Enter** saves, Shift+Enter makes a new line, **Esc** closes.

The form shows "Saved · <note name>" and closes. Open the note in Obsidian if
you want to say more; everything above `## Clipped` is yours.

If reading X's layout fails (they rename things), the capture still goes
through with the image URL and the page URL: the form shows the page title
instead of the post, and the note has what the pipeline needs most. Fix the
title in the form or in Obsidian.

## Settings

The extension's settings page (Safari: Settings → Extensions → allai →
Settings; Chrome: the card's **Details** → **Extension options**) has one
field, the receiver's address. Only change it if you changed
`ALLAI_INBOX_PORT`. **Save and test** tells you whether the receiver answers.

## Troubleshooting

- **"Can't reach the receiver"** in the form → it isn't running. `npm run inbox` in a terminal, or `npm run inbox -- --status` to see what the login item is doing (log at `~/Library/Logs/allai-inbox.log`).
- **Safari shows no "Add to AllAI" in the menu** → the extension is off (Settings → Extensions), or it's an unsigned build and Safari was restarted: Develop → Allow Unsigned Extensions again.
- **The note was written but there is no image file** → the form said so in brackets. The source refused the download (some CDNs do). The note links the remote image instead, and `npm run sync` hosts the media itself when you publish, so nothing is lost.
- **Two notes for the same post** → you captured it twice; the second is named `… 2.md`. The sync shows only one per source URL and tells you about the other.
- **`npm run sync -- --dry` doesn't list the note** → the inbox folder isn't under one of the vault folders the scripts read (`ALLAI_VAULT_DIRS`). The receiver prints a warning about this when it starts.

## Developing

Everything is in `src/`; there is nothing to compile.

- `background.js` — the one context-menu item, and the only code that calls the receiver.
- `content.js` — runs in the page; reads the post around the clicked image (on X) or the page's meta tags, and shows the form.
- `form.js` — the form itself, drawn in a shadow root so the page's styles and ours never touch. Also used by `popup.html`, the fallback window for pages where nothing can be injected (PDFs, browser pages).
- `options.html/js` — the settings page.

Chrome: edit, press reload on `chrome://extensions`. Safari: edit, run
`build-safari.sh` (or Run in Xcode), re-enable the extension if Safari asks.
For a non-X page the content script is injected on the click (`activeTab` +
`scripting`), so there is no "allow on all websites" prompt until you use it
there.

`globalThis.__allaiCapture(info, tab)` in the background script is the same
function the menu click runs. Automated browsers can't open native context
menus, so a test calls that directly.

## Where this is going

The receiver is the local stand-in for an API. When the Designer Mindset
platform accepts captures, the extension's settings page gets a second
address and `background.js` posts the same payload there. The shape in
`payload.md` is the contract; keep it clean.
