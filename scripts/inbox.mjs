#!/usr/bin/env node
/**
 * The allai inbox: a small local receiver for the browser extension in
 * extension/. It listens on localhost, takes one POST per capture, downloads
 * the image into the vault and writes a note in the exact shape the Web
 * Clipper template produces — so `npm run sync`, `npm run moodboard` and
 * `npm run annotate` read it like any other clip, unchanged.
 *
 * Where things land (all under the one folder Claude may write in):
 *
 *   ~/Obsidian/_AI OS/allai/inbox/<title>.md            the note
 *   ~/Obsidian/_AI OS/allai/inbox/<id>/<slug>.<ext>     the image (a gallery: <slug>.<ext>, <slug>-2.<ext>, …)
 *
 * `<id>` is the same twelve-character hash of the source URL that
 * scripts/lib/vault.mjs gives every item, so a capture and its note agree.
 * Nothing else in the vault is ever touched.
 *
 * Usage:
 *   npm run inbox                   run in this terminal (Ctrl-C stops it)
 *   npm run inbox -- --install      run at login via launchd (writes ~/Library/LaunchAgents/design.allai.inbox.plist)
 *   npm run inbox -- --uninstall    stop it and remove the launchd job
 *   npm run inbox -- --status       is it running, and where does it write
 *
 * Env (see .env.example):
 *   ALLAI_INBOX_PORT   default 7711 — change it here and in the extension's settings
 *   ALLAI_INBOX_DIR    default ~/Obsidian/_AI OS/allai/inbox — must sit inside ALLAI_VAULT_DIRS
 *   ALLAI_CLIENTS_DIR  default ~/Claude/projects/Crucial Design Operator/agency/clients — one folder
 *                      per client project; the active ones become the form's project chips
 *
 * The request/response shape is documented in extension/payload.md.
 */

import "dotenv/config";
import { createServer } from "node:http";
import { mkdir, writeFile, access, unlink, readdir } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stringify as toYaml } from "yaml";
import { CATEGORIES, idFor, slugify, vaultDirs, expandHome, cleanTitle, readItems, styleVocabulary, titleCase } from "./lib/vault.mjs";
import { EXT_BY_MIME } from "./lib/r2.mjs";
import { tweetId, fetchTweet } from "./lib/x.mjs";

const run = promisify(execFile);

const VERSION = "1.0.0";
const PORT = Number(process.env.ALLAI_INBOX_PORT) || 7711;
const INBOX_DIR = resolve(expandHome(process.env.ALLAI_INBOX_DIR || "~/Obsidian/_AI OS/allai/inbox"));
const MAX_BODY = 1024 * 1024; // a capture is text and URLs; images are fetched, not posted
const MAX_IMAGE = 50 * 1024 * 1024;
const MAX_VIDEO = 200 * 1024 * 1024;
// The extension waits 30 s for a save; videos get what's left after the pictures.
const VIDEO_BUDGET_MS = 20_000;

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SCRIPT), "..");
const LABEL = "design.allai.inbox";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG = join(homedir(), "Library", "Logs", "allai-inbox.log");

class BadRequest extends Error {}

const exists = (p) => access(p).then(() => true, () => false);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isHttp = (s) => /^https?:\/\/\S+$/i.test(s);
const asText = (v) => (v == null ? "" : String(v)).trim();
const asList = (v) =>
  (Array.isArray(v) ? v : asText(v).split(","))
    .map((s) => asText(s).replace(/^\[\[|\]\]$/g, "").trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Vocabulary: the styles and projects the form offers as chips

const CLIENTS_DIR = expandHome(process.env.ALLAI_CLIENTS_DIR || "~/Claude/projects/Crucial Design Operator/agency/clients");
const CLOSED_CLIENT = /-(paused|completed|cancelled|canceled|archived|lost)$/i;

let vocabCache = { at: 0, value: null };

/**
 * Styles already used in the vault (one spelling each, most used first) and
 * projects: every active client folder plus any project a note already names.
 * Where a note already spells a project ("crucial.design"), that spelling wins
 * over the folder's ("crucial-design") so Obsidian links stay one note.
 */
async function vocabulary() {
  if (vocabCache.value && Date.now() - vocabCache.at < 30_000) return vocabCache.value;
  let items = [];
  try {
    items = await readItems();
  } catch {}
  const styles = styleVocabulary(items);

  const used = new Map(); // slug -> { name, count }
  for (const item of items) {
    for (const p of item.projects) {
      const key = slugify(p);
      const entry = used.get(key) || { name: p, count: 0 };
      entry.count++;
      used.set(key, entry);
    }
  }
  let folders = [];
  try {
    folders = (await readdir(CLIENTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !/^[._]/.test(e.name) && !CLOSED_CLIENT.test(e.name))
      .map((e) => e.name);
  } catch {}
  const projects = new Map();
  for (const [key, { name, count }] of used) projects.set(key, { name, count, client: false });
  for (const folder of folders) {
    const key = slugify(folder);
    if (projects.has(key)) projects.get(key).client = true;
    else projects.set(key, { name: folder, count: 0, client: true });
  }
  const value = {
    styles,
    projects: [...projects.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
  vocabCache = { at: Date.now(), value };
  return value;
}

/** Typed styles in the vault's spelling: "dark" → "Dark" when "Dark" is in use; new lowercase ones get Title Case. */
function canonicalStyles(list, vocab) {
  const known = new Map(vocab.styles.map((s) => [s.name.toLowerCase(), s.name]));
  return [...new Set(list.map((s) => known.get(s.toLowerCase()) || (/[A-Z]/.test(s) ? s : titleCase(s))))];
}

/** Typed projects in an existing spelling when one matches by slug, so a slip in case or dots still lands on the same board. */
function canonicalProjects(list, vocab) {
  const known = new Map(vocab.projects.map((p) => [slugify(p.name), p.name]));
  return [...new Set(list.map((p) => known.get(slugify(p)) || p))];
}

// ---------------------------------------------------------------------------
// Writing a capture

/** Obsidian refuses these in a file name; keep it readable, not just legal. */
function noteFileName(title, fallback) {
  const name = title
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[\s.]+$/, "");
  return name || fallback;
}

async function uniquePath(dir, base, ext) {
  let candidate = join(dir, `${base}${ext}`);
  for (let n = 2; await exists(candidate); n++) candidate = join(dir, `${base} ${n}${ext}`);
  return candidate;
}

function imageExt(url, contentType) {
  const byType = EXT_BY_MIME[(contentType || "").split(";")[0].trim()];
  if (byType) return byType.replace(".jpeg", ".jpg");
  try {
    const u = new URL(url);
    const fmt = u.searchParams.get("format");
    if (fmt && /^(jpe?g|png|gif|webp|avif)$/i.test(fmt)) return `.${fmt.toLowerCase().replace("jpeg", "jpg")}`;
    const e = extname(u.pathname).toLowerCase();
    if (/^\.(jpe?g|png|gif|webp|avif)$/.test(e)) return e.replace("jpeg", "jpg");
  } catch {}
  return ".jpg";
}

async function downloadImage(url, dir, baseName, referer) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`source returned ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  if (contentType && !contentType.startsWith("image/")) throw new Error(`not an image (${contentType.split(";")[0]})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength) throw new Error("empty response");
  if (buffer.byteLength > MAX_IMAGE) throw new Error(`too large (${buffer.byteLength} bytes)`);
  await mkdir(dir, { recursive: true });
  const file = await uniquePath(dir, baseName, imageExt(url, contentType));
  await writeFile(file, buffer);
  return { file, bytes: buffer.byteLength };
}

/**
 * Every video or GIF in an X post, best mp4 of each, read from the same
 * syndication endpoint the sync uses. X's player hides the file from the page,
 * so the receiver fetches it here rather than the extension.
 */
async function xVideos(source) {
  const id = tweetId(source);
  if (!id) return [];
  const tweet = await fetchTweet(id);
  const out = [];
  for (const m of tweet.mediaDetails || []) {
    if (m.type !== "video" && m.type !== "animated_gif") continue;
    const best = (m.video_info?.variants || [])
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (best) out.push(best.url);
  }
  return out;
}

async function downloadVideo(url, dir, baseName, deadline) {
  const ms = deadline - Date.now();
  if (ms < 1000) throw new Error("out of time (the sync still hosts it when published)");
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`X returned ${res.status}`);
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_VIDEO) throw new Error(`too large (${Math.round(length / 1048576)} MB)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength) throw new Error("empty response");
  if (buffer.byteLength > MAX_VIDEO) throw new Error(`too large (${Math.round(buffer.byteLength / 1048576)} MB)`);
  await mkdir(dir, { recursive: true });
  const file = await uniquePath(dir, baseName, ".mp4");
  await writeFile(file, buffer);
  return { file, bytes: buffer.byteLength };
}

/** Validates a payload and turns it into the note's parts. Throws BadRequest on bad input. */
function normalize(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new BadRequest("body must be a JSON object");

  const why = asText(payload.why);
  if (!why) throw new BadRequest("'why' (What I like) is required — a capture without a reason is worth nothing to the pipeline");

  const source = asText(payload.source) || asText(payload.page);
  if (!isHttp(source)) throw new BadRequest("'source' must be an http(s) URL");
  const page = asText(payload.page) || source;

  const image = asText(payload.image);
  if (image && !isHttp(image)) throw new BadRequest("'image' must be an http(s) URL when present");
  // Every picture of the post, the cover first. One image is a gallery of one.
  const images = [];
  for (const u of [image, ...(Array.isArray(payload.images) ? payload.images : [])].map(asText)) {
    if (!u) continue;
    if (!isHttp(u)) throw new BadRequest("'images' must be http(s) URLs");
    if (!images.includes(u)) images.push(u);
  }
  if (images.length > 20) throw new BadRequest("'images': at most 20 per capture");

  const category = asText(payload.category);
  if (category && !CATEGORIES.includes(category)) {
    throw new BadRequest(`'category' must be one of: ${CATEGORIES.join(" / ")} (or empty)`);
  }

  const published = asText(payload.published).slice(0, 10);
  if (published && !/^\d{4}-\d{2}-\d{2}$/.test(published)) throw new BadRequest("'published' must be YYYY-MM-DD");

  const author = asText(payload.author);
  const authorName = asText(payload.authorName);
  const text = asText(payload.text);
  let title = cleanTitle(asText(payload.title));
  if (!title) {
    const firstLine = text.split("\n").find((l) => l.trim())?.trim();
    title = firstLine ? firstLine.slice(0, 80) : authorName || author || new URL(source).hostname.replace(/^www\./, "");
  }

  return {
    id: idFor(source),
    source,
    page,
    image: images[0] || "",
    images,
    imageAlt: asText(payload.imageAlt),
    title,
    why,
    author,
    authorName,
    text,
    published,
    category,
    style: asList(payload.style),
    projects: asList(payload.projects),
    publish: payload.publish === true || /^(true|yes|1)$/i.test(asText(payload.publish)),
    siteKind: asText(payload.siteKind) || (/(^|\/\/)(www\.)?(x|twitter)\.com\//i.test(source) ? "x" : "web"),
    client: payload.client && typeof payload.client === "object" ? payload.client : null,
  };
}

function renderNote(c, savedRels, videoRels = []) {
  const frontmatter = {
    title: c.title,
    source: c.source,
    author: c.author ? [`[[${c.author}]]`] : c.authorName ? [`[[${c.authorName}]]`] : [],
    published: c.published,
    created: today(),
    description: c.text.replace(/\s+/g, " ").trim().slice(0, 200),
    image: c.image,
    tags: ["allai", "extension"],
    category: c.category,
    style: c.style,
    projects: c.projects.map((p) => `[[${p}]]`),
    publish: c.publish,
  };

  const alt = (c.imageAlt || c.title).replace(/[\[\]]/g, "");
  // One line per picture: the downloaded copy when there is one, else the remote URL.
  const imageLinks = c.images.map((remote, i) => {
    const rel = savedRels[i];
    const label = c.images.length > 1 ? `${alt} ${i + 1}` : alt;
    return rel ? `![${label}](${encodeURI(rel).replace(/[()]/g, (ch) => (ch === "(" ? "%28" : "%29"))})` : `![${label}](${remote})`;
  });
  const where = c.page !== c.source ? ` from ${c.page}` : "";
  const via = c.client?.browser ? ` (${c.client.browser})` : "";

  // Local clips, embedded so Obsidian plays them. The `video` frontmatter key stays the
  // sync's: it points at the R2 copy once the item is published.
  const videoLinks = videoRels.map((rel, i) => `![${videoRels.length > 1 ? `Video ${i + 1}` : "Video"}](${encodeURI(rel).replace(/[()]/g, (ch) => (ch === "(" ? "%28" : "%29"))})`);
  const clipped = [c.text, imageLinks.join("\n\n"), videoLinks.join("\n\n"), `_Captured${where} with the allai extension${via} on ${today()}._`]
    .filter(Boolean)
    .join("\n\n");

  return `---\n${toYaml(frontmatter, { lineWidth: 0 })}---\n## What I like\n\n${c.why}\n\n## Clipped\n\n${clipped}\n`;
}

async function handleCapture(payload) {
  const c = normalize(payload);
  const warnings = [];
  const vocab = await vocabulary();
  c.style = canonicalStyles(c.style, vocab);
  c.projects = canonicalProjects(c.projects, vocab);
  const newProjects = c.projects.filter((p) => !vocab.projects.some((v) => slugify(v.name) === slugify(p)));
  if (newProjects.length) warnings.push(`new project ${newProjects.map((p) => `"${p}"`).join(", ")}: starts its own board`);

  await mkdir(INBOX_DIR, { recursive: true });

  // Download every picture into <id>/: <slug>.<ext>, <slug>-2.<ext>, … (the cover keeps the
  // plain name so a one-image capture looks exactly as before).
  const savedRels = [];
  let bytes = 0;
  const dir = join(INBOX_DIR, c.id);
  const base = slugify(c.title).slice(0, 60).replace(/-+$/, "") || "image";
  for (const [i, url] of c.images.entries()) {
    try {
      const saved = await downloadImage(url, dir, i ? `${base}-${i + 1}` : base, c.page);
      savedRels.push(`${c.id}/${saved.file.slice(dir.length + 1)}`);
      bytes += saved.bytes;
    } catch (err) {
      savedRels.push(null);
      warnings.push(`image${c.images.length > 1 ? ` ${i + 1}` : ""} not downloaded: ${err.message}; the note links the remote URL instead`);
    }
  }

  // An X post's videos: <slug>.mp4, <slug>-2.mp4, … beside the pictures.
  const videoRels = [];
  if (c.siteKind === "x") {
    const deadline = Date.now() + VIDEO_BUDGET_MS;
    let urls = [];
    try {
      urls = await xVideos(c.source);
    } catch (err) {
      if (/video/i.test(c.imageAlt || "")) warnings.push(`video not saved: ${err.message}`);
    }
    for (const [i, url] of urls.entries()) {
      try {
        const saved = await downloadVideo(url, dir, i ? `${base}-${i + 1}` : base, deadline);
        videoRels.push(`${c.id}/${saved.file.slice(dir.length + 1)}`);
        bytes += saved.bytes;
      } catch (err) {
        warnings.push(`video${urls.length > 1 ? ` ${i + 1}` : ""} not saved: ${err.message}`);
      }
    }
  }

  const notePath = await uniquePath(INBOX_DIR, noteFileName(c.title, c.id), ".md");
  if (!notePath.startsWith(INBOX_DIR + "/")) throw new Error("refusing to write outside the inbox"); // belt and braces
  await writeFile(notePath, renderNote(c, savedRels, videoRels), { flag: "wx" });
  vocabCache.at = 0; // the next form shows this capture's styles and projects

  const savedPaths = savedRels.map((rel) => (rel ? join(INBOX_DIR, rel) : null));
  return {
    ok: true,
    id: c.id,
    note: notePath,
    noteName: notePath.slice(INBOX_DIR.length + 1, -3),
    image: savedPaths[0] || null,
    images: savedPaths,
    videos: videoRels.map((rel) => join(INBOX_DIR, rel)),
    bytes,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// HTTP

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new BadRequest("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function health() {
  const { styles, projects } = await vocabulary();
  return { ok: true, name: "allai-inbox", version: VERSION, inbox: INBOX_DIR, port: PORT, categories: CATEGORIES, styles, projects };
}

async function route(req, res) {
  cors(res);
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return json(res, 200, await health());
  if (req.method === "POST" && url.pathname === "/capture") {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "null");
    } catch (err) {
      return json(res, 400, { ok: false, error: err instanceof BadRequest ? err.message : "body must be JSON" });
    }
    try {
      const result = await handleCapture(payload);
      const n = result.images.filter(Boolean).length;
      const kb = result.bytes ? `, ${[n && (n > 1 ? `${n} images` : "image"), result.videos.length && (result.videos.length > 1 ? `${result.videos.length} videos` : "video")].filter(Boolean).join(" + ")} ${Math.round(result.bytes / 1024)} KB` : "";
      console.log(`${stamp()} + ${result.noteName}${kb}${result.warnings.length ? `  ! ${result.warnings.join("; ")}` : ""}`);
      return json(res, 201, result);
    } catch (err) {
      if (err instanceof BadRequest) {
        console.log(`${stamp()} ✗ rejected: ${err.message}`);
        return json(res, 400, { ok: false, error: err.message });
      }
      console.error(`${stamp()} ✗ ${err.stack || err}`);
      return json(res, 500, { ok: false, error: err.message });
    }
  }
  return json(res, 404, { ok: false, error: "no such route — POST /capture or GET /health" });
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${today()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function serve() {
  const inVault = vaultDirs().some((d) => INBOX_DIR === resolve(d) || INBOX_DIR.startsWith(resolve(d) + "/"));
  const server = createServer((req, res) => route(req, res).catch((err) => json(res, 500, { ok: false, error: String(err) })));
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✗ port ${PORT} is taken. Another inbox running? Try: npm run inbox -- --status`);
    } else {
      console.error(`✗ ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`allai inbox ${VERSION} listening on http://127.0.0.1:${PORT}`);
    console.log(`  notes and images → ${INBOX_DIR}`);
    if (!inVault) {
      console.log(`  ! that folder is outside ALLAI_VAULT_DIRS (${vaultDirs().join(", ")}) — npm run sync won't see these notes`);
    }
  });
  const stop = () => {
    console.log("\nallai inbox stopped");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// ---------------------------------------------------------------------------
// launchd: run at login

function plist() {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const env = ["PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(SCRIPT)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${esc(REPO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env.map((kv) => `    <key>${kv.split("=")[0]}</key>\n    <string>${esc(kv.slice(kv.indexOf("=") + 1))}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(LOG)}</string>
</dict>
</plist>
`;
}

const domain = () => `gui/${process.getuid()}`;

async function launchctl(...args) {
  try {
    const { stdout } = await run("launchctl", args);
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stdout: err.stdout || "", stderr: err.stderr || err.message };
  }
}

async function waitForHealth(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function install() {
  await mkdir(dirname(PLIST), { recursive: true });
  await mkdir(dirname(LOG), { recursive: true });
  await launchctl("bootout", `${domain()}/${LABEL}`); // replace a previous install quietly
  await writeFile(PLIST, plist());
  const boot = await launchctl("bootstrap", domain(), PLIST);
  if (!boot.ok) {
    console.error(`✗ launchctl bootstrap failed: ${boot.stderr.trim()}`);
    process.exit(1);
  }
  console.log(`→ wrote ${PLIST}`);
  const h = await waitForHealth(5000);
  if (h) {
    console.log(`→ running at login from now on: http://127.0.0.1:${h.port} → ${h.inbox}`);
  } else {
    console.log(`! loaded, but nothing is answering on port ${PORT} yet. Check ${LOG}`);
  }
  console.log(`  log: ${LOG}`);
}

async function uninstall() {
  const out = await launchctl("bootout", `${domain()}/${LABEL}`);
  if (await exists(PLIST)) await unlink(PLIST);
  console.log(out.ok ? "→ stopped and removed the launchd job" : "→ no launchd job was running; plist removed if it existed");
}

async function status() {
  const h = await waitForHealth(600);
  const loaded = (await launchctl("print", `${domain()}/${LABEL}`)).ok;
  console.log(h ? `running — http://127.0.0.1:${h.port} → ${h.inbox}` : `not answering on port ${PORT}`);
  console.log(`launchd job: ${loaded ? `loaded (${PLIST})` : "not installed — npm run inbox -- --install"}`);
  console.log(`log: ${LOG}`);
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--install")) await install();
else if (args.includes("--uninstall")) await uninstall();
else if (args.includes("--status")) await status();
else if (args.includes("--help") || args.includes("-h")) {
  console.log("npm run inbox [-- --install | --uninstall | --status]  (see the header of scripts/inbox.mjs)");
} else serve();
