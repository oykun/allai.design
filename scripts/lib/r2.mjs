/**
 * Uploads a file (remote URL or local path) to Cloudflare R2 and returns its
 * permanent public URL. The feed must never depend on someone else's CDN.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MAX_BYTES = 100 * 1024 * 1024; // curated clips, not feature films

// Local files carry no content-type header, and serving a video as
// octet-stream stops it playing inline.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export const EXT_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

export function r2Host() {
  return (process.env.R2_PUBLIC_URL || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isOnR2(url) {
  const host = r2Host();
  return Boolean(host && url && url.includes(host));
}

export function requireR2Env() {
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")} — check .env`);
}

export async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (allai.design media fetcher)" },
  });
  if (!res.ok) throw new Error(`Source returned ${res.status} ${res.statusText}`);
  const contentType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0];
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

export async function uploadToR2(source, destKey) {
  requireR2Env();

  let buffer, contentType;
  if (/^https?:\/\//i.test(source)) {
    ({ buffer, contentType } = await fetchBuffer(source));
  } else {
    buffer = await readFile(source);
    contentType = MIME_BY_EXT[extname(source).toLowerCase()] || "application/octet-stream";
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`File too large: ${buffer.byteLength} bytes (cap is ${MAX_BYTES})`);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: destKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${destKey}`;
  return { url, contentType, bytes: buffer.byteLength };
}
