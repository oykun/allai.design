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
 *   ~/Obsidian/_AI OS/allai/inbox/<id>/<slug>.<ext>     the image
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
 *
 * The request/response shape is documented in extension/payload.md.
 */

import "dotenv/config";
import { createServer } from "node:http";
import { mkdir, writeFile, access, unlink } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stringify as toYaml } from "yaml";
import { CATEGORIES, idFor, slugify, vaultDirs, expandHome, cleanTitle } from "./lib/vault.mjs";
import { EXT_BY_MIME } from "./lib/r2.mjs";

const run = promisify(execFile);

const VERSION = "1.0.0";
const PORT = Number(process.env.ALLAI_INBOX_PORT) || 7711;
const INBOX_DIR = resolve(expandHome(process.env.ALLAI_INBOX_DIR || "~/Obsidian/_AI OS/allai/inbox"));
const MAX_BODY = 1024 * 1024; // a capture is text and URLs; images are fetched, not posted
const MAX_IMAGE = 50 * 1024 * 1024;

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
    image,
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

function renderNote(c, savedRel) {
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
  const imageLink = savedRel
    ? `![${alt}](${encodeURI(savedRel).replace(/[()]/g, (ch) => (ch === "(" ? "%28" : "%29"))})`
    : c.image
      ? `![${alt}](${c.image})`
      : "";
  const where = c.page !== c.source ? ` from ${c.page}` : "";
  const via = c.client?.browser ? ` (${c.client.browser})` : "";

  const clipped = [c.text, imageLink, `_Captured${where} with the allai extension${via} on ${today()}._`]
    .filter(Boolean)
    .join("\n\n");

  return `---\n${toYaml(frontmatter, { lineWidth: 0 })}---\n## What I like\n\n${c.why}\n\n## Clipped\n\n${clipped}\n`;
}

async function handleCapture(payload) {
  const c = normalize(payload);
  const warnings = [];

  await mkdir(INBOX_DIR, { recursive: true });

  let savedRel = null;
  let bytes = 0;
  if (c.image) {
    const dir = join(INBOX_DIR, c.id);
    const base = slugify(c.title).slice(0, 60).replace(/-+$/, "") || "image";
    try {
      const saved = await downloadImage(c.image, dir, base, c.page);
      savedRel = `${c.id}/${saved.file.slice(dir.length + 1)}`;
      bytes = saved.bytes;
    } catch (err) {
      warnings.push(`image not downloaded: ${err.message}; the note links the remote URL instead`);
    }
  }

  const notePath = await uniquePath(INBOX_DIR, noteFileName(c.title, c.id), ".md");
  if (!notePath.startsWith(INBOX_DIR + "/")) throw new Error("refusing to write outside the inbox"); // belt and braces
  await writeFile(notePath, renderNote(c, savedRel), { flag: "wx" });

  return {
    ok: true,
    id: c.id,
    note: notePath,
    noteName: notePath.slice(INBOX_DIR.length + 1, -3),
    image: savedRel ? join(INBOX_DIR, savedRel) : null,
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

function health() {
  return { ok: true, name: "allai-inbox", version: VERSION, inbox: INBOX_DIR, port: PORT, categories: CATEGORIES };
}

async function route(req, res) {
  cors(res);
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return json(res, 200, health());
  if (req.method === "POST" && url.pathname === "/capture") {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "null");
    } catch (err) {
      return json(res, 400, { ok: false, error: err instanceof BadRequest ? err.message : "body must be JSON" });
    }
    try {
      const result = await handleCapture(payload);
      const kb = result.bytes ? `, image ${Math.round(result.bytes / 1024)} KB` : "";
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
