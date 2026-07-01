#!/usr/bin/env node
/**
 * Downloads a source file (image or video) and uploads it to Cloudflare R2,
 * returning a stable, permanent CDN URL.
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs <sourceUrl> <destKey>
 *
 * Example:
 *   node scripts/upload-to-r2.mjs https://video.twimg.com/abc.mp4 items/1a2b3c/video.mp4
 *
 * Required env vars (see .env.example):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_PUBLIC_URL       e.g. https://cdn.allai.design (no trailing slash)
 *
 * Output (stdout): a single line of JSON.
 *   Success: {"ok":true,"url":"https://cdn.allai.design/items/.../video.mp4","contentType":"video/mp4","bytes":1234567}
 *   Failure: {"ok":false,"error":"message"}
 * Exit code 0 on success, 1 on failure — check this before trusting stdout.
 */

import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const MAX_BYTES = 100 * 1024 * 1024; // 100MB safety cap — these are curated social clips, not feature films

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

async function main() {
  const [sourceUrl, destKey] = process.argv.slice(2);
  if (!sourceUrl || !destKey) {
    fail("Usage: node scripts/upload-to-r2.mjs <sourceUrl> <destKey>");
  }

  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    fail(`Missing env vars: ${missing.join(", ")} — check .env`);
  }

  let res;
  try {
    res = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (allai.design media fetcher)" },
    });
  } catch (err) {
    fail(`Fetch failed: ${err.message}`);
  }

  if (!res.ok) {
    fail(`Source returned ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_BYTES) {
    fail(`File too large: ${contentLength} bytes (cap is ${MAX_BYTES})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > MAX_BYTES) {
    fail(`File too large: ${buffer.byteLength} bytes (cap is ${MAX_BYTES})`);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: destKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  } catch (err) {
    fail(`R2 upload failed: ${err.message}`);
  }

  const publicUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${destKey}`;
  console.log(
    JSON.stringify({ ok: true, url: publicUrl, contentType, bytes: buffer.byteLength })
  );
}

main();
