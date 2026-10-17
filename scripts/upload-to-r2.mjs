#!/usr/bin/env node
/**
 * Uploads a source file (URL or local path) to Cloudflare R2.
 *
 * Usage:
 *   npm run upload-media <sourceUrlOrPath> <destKey>
 *   e.g. npm run upload-media https://video.twimg.com/abc.mp4 items/1a2b3c/video.mp4
 *
 * Output (stdout): one line of JSON.
 *   {"ok":true,"url":"https://…/items/…/video.mp4","contentType":"video/mp4","bytes":1234567}
 *   {"ok":false,"error":"message"}        (exit code 1)
 */

import "dotenv/config";
import { uploadToR2 } from "./lib/r2.mjs";

const [source, destKey] = process.argv.slice(2);
if (!source || !destKey) {
  console.log(JSON.stringify({ ok: false, error: "Usage: npm run upload-media <sourceUrlOrPath> <destKey>" }));
  process.exit(1);
}

try {
  const result = await uploadToR2(source, destKey);
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
