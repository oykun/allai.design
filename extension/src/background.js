/**
 * allai — background script (a service worker in Chrome, the same in Safari).
 *
 * Owns the two context-menu items, asks the page for the context around the
 * clicked image, and is the only part of the extension that talks to the
 * receiver (`npm run inbox` in the allai.design repo). Pages never call the
 * receiver themselves: X's content-security policy would block it, and keeping
 * one caller makes the later switch to the platform API a one-line change.
 */

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_RECEIVER = "http://127.0.0.1:7711";

// Mirrors CATEGORIES in scripts/lib/vault.mjs. The receiver's /health reports
// the live list; this copy only matters when the receiver is unreachable.
const FALLBACK_CATEGORIES = [
  "Website Design",
  "Product Design",
  "Illustration",
  "Reference Material",
  "Articles",
  "Products",
  "Skills",
];

const MENU_IMAGE = "allai-image";
const MENU_PAGE = "allai-page";

// ---------------------------------------------------------------------------
// Menus

async function installMenus() {
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: MENU_IMAGE, title: "Add to allai", contexts: ["image"] });
  api.contextMenus.create({
    id: MENU_PAGE,
    title: "Add page to allai",
    contexts: ["page", "frame", "selection", "link"],
  });
}

// Chrome keeps menus between service-worker restarts; Safari does not, so
// they are (re)created every time the background script starts. Idempotent.
installMenus().catch(console.error);
api.runtime.onInstalled.addListener(() => installMenus().catch(console.error));

api.contextMenus.onClicked.addListener((info, tab) => capture(info, tab).catch(console.error));
api.action?.onClicked.addListener((tab) =>
  capture({ menuItemId: MENU_PAGE, pageUrl: tab?.url || "", frameId: 0 }, tab).catch(console.error),
);

// ---------------------------------------------------------------------------
// Settings and receiver

async function settings() {
  return api.storage.local.get({ receiver: DEFAULT_RECEIVER, lastProjects: "", categories: null });
}

function receiverUrl(s) {
  return String(s.receiver || DEFAULT_RECEIVER).replace(/\/+$/, "");
}

/** What the form needs to render: categories (live if possible) and defaults. */
async function config() {
  const s = await settings();
  const receiver = receiverUrl(s);
  let categories = s.categories || FALLBACK_CATEGORIES;
  let online = false;
  try {
    const res = await fetch(`${receiver}/health`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const health = await res.json();
      if (Array.isArray(health.categories) && health.categories.length) {
        categories = health.categories;
        await api.storage.local.set({ categories });
      }
      online = true;
    }
  } catch {
    // Not running — the form still opens; the save explains what to start.
  }
  return { receiver, categories, lastProjects: s.lastProjects || "", online };
}

function browserName() {
  const ua = navigator.userAgent;
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "safari";
  if (/Firefox\//.test(ua)) return "firefox";
  return "chrome";
}

/** POSTs a capture to the receiver. Resolves to the receiver's JSON reply. */
async function save(payload) {
  const s = await settings();
  const receiver = receiverUrl(s);
  const body = {
    ...payload,
    version: 1,
    capturedAt: new Date().toISOString(),
    client: { name: "allai-extension", version: api.runtime.getManifest().version, browser: browserName() },
  };
  let res;
  try {
    res = await fetch(`${receiver}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Can't reach the receiver at ${receiver}. Start it with \`npm run inbox\` in the allai.design folder (or \`npm run inbox -- --install\` once, to run it at login).`,
    };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `Receiver answered ${res.status} with no JSON body` };
  }
  if (data.ok && Array.isArray(payload.projects) && payload.projects.length) {
    await api.storage.local.set({ lastProjects: payload.projects.join(", ") });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Capture flow

function sendToTab(tabId, message, frameId) {
  return api.tabs.sendMessage(tabId, message, { frameId: frameId || 0 });
}

/**
 * Asks the page to read the context around the click and show the form.
 * On X the content script is already there. Elsewhere it is injected on
 * demand (activeTab + scripting). If neither works — a PDF, a browser page —
 * the form opens in a small window with just the URL and title.
 */
async function capture(info, tab) {
  if (!tab?.id) {
    const [active] = await api.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  const request = {
    type: "allai:collect",
    menu: info.menuItemId === MENU_IMAGE ? "image" : "page",
    srcUrl: info.srcUrl || "",
    pageUrl: info.pageUrl || tab?.url || "",
    title: tab?.title || "",
    config: await config(),
  };
  const frameId = info.frameId || 0;

  try {
    const reply = await sendToTab(tab.id, request, frameId);
    if (reply?.shown) return;
  } catch {
    // No content script in this tab yet.
  }

  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ["form.js", "content.js"],
    });
    const reply = await sendToTab(tab.id, request, frameId);
    if (reply?.shown) return;
    console.warn("allai: page could not show the form", reply?.error);
  } catch (err) {
    console.warn("allai: could not run in this page, opening a window instead", err);
  }

  await openWindow({
    source: request.pageUrl,
    page: request.pageUrl,
    title: request.title,
    image: request.menu === "image" ? request.srcUrl : "",
    author: "",
    authorName: "",
    text: "",
    published: "",
    siteKind: "web",
  });
}

async function openWindow(payload) {
  await api.storage.local.set({ pending: payload });
  const url = api.runtime.getURL("popup.html");
  try {
    await api.windows.create({ url, type: "popup", width: 440, height: 620 });
  } catch {
    await api.tabs.create({ url });
  }
}

// Test hook: lets an automated browser trigger a capture without a real
// right-click (native context menus can't be scripted). Harmless otherwise.
globalThis.__allaiCapture = capture;

// ---------------------------------------------------------------------------
// Messages from the form (in-page overlay or the fallback window)

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;
  const handlers = {
    "allai:config": () => config(),
    "allai:save": () => save(message.payload || {}),
    "allai:set-receiver": async () => {
      const receiver = String(message.receiver || DEFAULT_RECEIVER).trim() || DEFAULT_RECEIVER;
      await api.storage.local.set({ receiver, categories: null });
      return config();
    },
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler().then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // async reply
});
