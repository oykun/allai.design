/**
 * Records a short clip of a live website, plus a still frame.
 *
 * We capture the real page rather than its og:image on purpose: og images are
 * marketing cards a site ships for social previews, not the design itself.
 *
 * The clip is deliberately not a static hold: most landing-page motion is
 * scroll-triggered, so a still hold records nothing moving. It waits for entry
 * animations, then eases down through the first couple of viewports.
 */

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

const VIEWPORT = { width: 1440, height: 900 };
const HOLD_MS = 1200; // let entry animations play before moving
const SCROLL_MS = 3800; // then ease down through the page
const CLIP_SECONDS = 5; // final length after the load period is trimmed off

// Consent banners cover a quarter of the frame and ruin the capture. Reject
// rather than accept wherever a site offers the choice.
const CONSENT_PATTERNS = [
  /^reject all$/i, /^reject$/i, /^decline all$/i, /^decline$/i,
  /^only essential/i, /^essential only/i, /^necessary only/i,
  /^deny$/i, /^refuse/i,
];

export async function hasFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function dismissConsent(page) {
  for (const pattern of CONSENT_PATTERNS) {
    const button = page.getByRole("button", { name: pattern }).first();
    try {
      if (await button.isVisible({ timeout: 400 })) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return pattern.source;
      }
    } catch {
      /* not present — try the next wording */
    }
  }
  return null;
}

async function transcode(webm, outPath, startAt) {
  // Recording begins when the context is created, so the file opens with a
  // blank frame and however long the page took to load. Seek past that to the
  // moment the page was actually painted, keeping a little lead-in so the tail
  // of any entry animation survives.
  const seek = Math.max(0, startAt - 0.6).toFixed(2);

  // H.264 in MP4: WebM/VP8 is unreliable in Safari and on iOS, and this feed
  // autoplays inline on phones. faststart puts the moov atom first so playback
  // can begin before the whole file arrives.
  await run("ffmpeg", [
    "-y", "-ss", seek, "-i", webm, "-t", String(CLIP_SECONDS),
    "-vcodec", "libx264",
    "-profile:v", "main",
    "-pix_fmt", "yuv420p",
    "-crf", "26",
    "-preset", "slow",
    "-movflags", "+faststart",
    "-an", // no audio track — the feed plays muted
    "-vf", "scale=1440:-2",
    outPath,
  ]);
}

/**
 * Returns local paths: { stillPath, videoPath|null, cleanup, dismissed }.
 * Call cleanup() once the files have been uploaded.
 */
export async function captureSite(url, { still = false, log = () => {} } = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "allai-capture-"));
  const browser = await chromium.launch();

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    // Some sites serve a degraded page to obvious automation.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...(still ? {} : { recordVideo: { dir: workDir, size: VIEWPORT } }),
  });

  const recordingStartedAt = Date.now();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {
    // networkidle never settles on pages with polling or long-running media;
    // the page is usually painted well before then, so carry on regardless.
  });

  const dismissed = await dismissConsent(page);
  if (dismissed) log(`dismissed consent banner (${dismissed})`);

  // Everything before this point is load and consent-dismissal, and gets
  // trimmed out of the final clip.
  const contentStartsAt = (Date.now() - recordingStartedAt) / 1000;

  await page.waitForTimeout(HOLD_MS);

  // Still is taken at the top, before scrolling — it doubles as the video poster.
  const stillPath = join(workDir, "still.jpg");
  await page.screenshot({ path: stillPath, type: "jpeg", quality: 90 });

  if (!still) {
    await page.evaluate(async (ms) => {
      const distance = Math.min(
        document.body.scrollHeight - window.innerHeight,
        window.innerHeight * 2,
      );
      if (distance <= 0) return;
      const start = performance.now();
      // easeInOutCubic keeps the pan from starting and stopping abruptly.
      const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
      await new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min((now - start) / ms, 1);
          window.scrollTo(0, distance * ease(t));
          t < 1 ? requestAnimationFrame(step) : resolve();
        };
        requestAnimationFrame(step);
      });
    }, SCROLL_MS);
    await page.waitForTimeout(400);
  }

  await context.close(); // flushes the video file
  await browser.close();

  let videoPath = null;
  if (!still) {
    const files = await readdir(workDir);
    const name = files.find((f) => f.endsWith(".webm"));
    if (!name) throw new Error("Playwright produced no video file");
    videoPath = join(workDir, "clip.mp4");
    await transcode(join(workDir, name), videoPath, contentStartsAt);
  }

  return {
    stillPath,
    videoPath,
    dismissed,
    cleanup: () => rm(workDir, { recursive: true, force: true }),
  };
}
