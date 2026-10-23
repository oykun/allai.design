/**
 * allai — content script.
 *
 * Runs in the page. On X it is always there; elsewhere the background injects
 * it on demand. Its job: given the image that was right-clicked, read the
 * context around it (on X: the post's author, text and permalink; elsewhere:
 * the page's title and description) and show the capture form (form.js).
 *
 * Reading X's DOM is best effort. X renames its internals now and then; when
 * the read fails the capture still succeeds with the image URL and page URL,
 * which is what the pipeline needs most.
 */

(() => {
  if (globalThis.__allaiContent) return;
  globalThis.__allaiContent = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const isX = /(^|\.)(x|twitter)\.com$/i.test(location.hostname);

  // The element under the last right-click. X's video player swallows the browser menu, so
  // a video post is captured by right-clicking its text and picking "Add page to allai";
  // this is how that click still finds the post in the feed. preventDefault on X's side
  // stops the menu, not the event, so the listener always runs.
  let lastRightClick = null;
  document.addEventListener("contextmenu", (e) => { lastRightClick = { target: e.target, at: Date.now() }; }, true);

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "allai:collect") return false;
    try {
      const payload = collect(message);
      globalThis.__allaiForm.show(payload, {
        config: message.config,
        save: (data) => api.runtime.sendMessage({ type: "allai:save", payload: data }),
      });
      sendResponse({ shown: true });
    } catch (err) {
      console.warn("allai: could not show the form", err);
      sendResponse({ shown: false, error: String(err?.message || err) });
    }
    return false;
  });

  // -------------------------------------------------------------------------

  function collect(message) {
    const img = message.srcUrl ? findImage(message.srcUrl) : null;
    const payload = {
      source: stripHash(location.href),
      page: stripHash(location.href),
      title: document.title || "",
      image: message.menu === "image" ? message.srcUrl || "" : "",
      imageAlt: img?.alt || "",
      author: "",
      authorName: "",
      text: "",
      published: "",
      siteKind: "web",
    };

    if (isX) {
      payload.siteKind = "x";
      try {
        Object.assign(payload, fromX(img, message));
      } catch (err) {
        console.warn("allai: X read failed, falling back to URLs only", err);
      }
      payload.image = fullResX(payload.image);
    } else {
      Object.assign(payload, fromPage());
    }
    return payload;
  }

  /** The <img> the user right-clicked, matched by its resolved URL. */
  function findImage(srcUrl) {
    const want = new Set([srcUrl, safeDecode(srcUrl)]);
    for (const img of document.images) {
      if (want.has(img.currentSrc) || want.has(img.src)) return img;
    }
    // Same picture, different size variant (X serves ?name=small in the feed).
    const base = srcUrl.split("?")[0];
    for (const img of document.images) {
      if ((img.currentSrc || img.src).split("?")[0] === base) return img;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // X

  const STATUS_RE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i;

  function statusFromUrl(url) {
    const m = String(url || "").match(STATUS_RE);
    return m ? { source: `https://x.com/${m[1]}/status/${m[2]}`, handle: `@${m[1]}` } : null;
  }

  function fromX(img, message) {
    const out = {};
    const pageStatus = statusFromUrl(location.href);

    // The post around the clicked image, else the post that was right-clicked (any part of
    // it: text, author, the player), else, on a post's own page, the main post.
    let article = img?.closest("article") || null;
    if (!article && message.menu === "page" && lastRightClick && Date.now() - lastRightClick.at < 15000) {
      article = lastRightClick.target?.closest?.("article") || null;
    }
    if (!article && message.menu === "page" && pageStatus) {
      article = document.querySelector('article[data-testid="tweet"]');
    }
    if (!article && pageStatus) {
      // Clicked inside the photo viewer (/photo/1): no article around it, but
      // the post is open underneath.
      article = document.querySelector('article[data-testid="tweet"]');
    }

    let status = null;
    if (article) {
      // The timestamp link is the post's permalink. Any other /status/ link in
      // the article points at a quoted or linked post.
      const timeLink = article.querySelector("time")?.closest('a[href*="/status/"]');
      status = statusFromUrl(timeLink ? new URL(timeLink.getAttribute("href"), location.origin).href : "");
      if (!status) {
        for (const a of article.querySelectorAll('a[href*="/status/"]')) {
          status = statusFromUrl(new URL(a.getAttribute("href"), location.origin).href);
          if (status) break;
        }
      }
    }
    if (!status) status = pageStatus;
    if (status) {
      out.source = status.source;
      out.author = status.handle;
    }

    if (article) {
      const user = article.querySelector('[data-testid="User-Name"]');
      if (user) {
        const lines = user.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
        const handle = lines.find((l) => /^@[A-Za-z0-9_]+$/.test(l));
        if (handle && !out.author) out.author = handle;
        const name = lines.find((l) => l !== handle && !/^[·.]$/.test(l) && !/^\d+[smhd]$/.test(l));
        if (name) out.authorName = name;
      }
      const text = article.querySelector('[data-testid="tweetText"]');
      if (text) out.text = text.innerText.trim();
      const when = article.querySelector("time")?.getAttribute("datetime");
      if (when) out.published = when.slice(0, 10);
      // A video post, captured without an image: send the player's poster frame so the note
      // has a picture right away. The sync fetches the video itself when the item is published.
      const poster = article.querySelector("video[poster]")?.getAttribute("poster");
      if (poster && message.menu !== "image") {
        out.image = poster;
        out.imageAlt = "Video poster";
      }
      // Every picture of the post (a gallery is one item, not four): the clicked one first.
      // Avatars live under /profile_images/, post media under /media/.
      const gallery = [];
      for (const el of article.querySelectorAll('img[src*="pbs.twimg.com/media/"]')) {
        const full = fullResX(el.currentSrc || el.src);
        if (full && !gallery.includes(full)) gallery.push(full);
      }
      if (gallery.length) {
        const clicked = img ? fullResX(img.currentSrc || img.src) : "";
        out.images = clicked && gallery.includes(clicked) ? [clicked, ...gallery.filter((u) => u !== clicked)] : gallery;
        if (!out.image && message.menu !== "image") out.image = out.images[0];
      }
    }

    const who = out.authorName || out.author || "";
    const firstLine = (out.text || "").split("\n").find((l) => l.trim());
    out.title = firstLine ? truncate(firstLine.trim(), 80) : who ? `${who} on X` : document.title;
    return out;
  }

  /** The feed serves ?name=small; the original upload is ?name=orig. */
  function fullResX(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      if (/(^|\.)pbs\.twimg\.com$/.test(u.hostname) && u.pathname.startsWith("/media/")) {
        u.searchParams.set("name", "orig");
        if (!u.searchParams.get("format")) {
          const m = u.pathname.match(/\.(jpe?g|png|webp)$/i);
          if (m) {
            u.pathname = u.pathname.replace(/\.(jpe?g|png|webp)$/i, "");
            u.searchParams.set("format", m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase());
          }
        }
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  // -------------------------------------------------------------------------
  // Any other page

  function meta(...selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      const v = el?.getAttribute("content")?.trim();
      if (v) return v;
    }
    return "";
  }

  function fromPage() {
    const out = {};
    const description = meta('meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]');
    if (description) out.text = description;
    const author = meta('meta[name="author"]', 'meta[property="article:author"]');
    if (author) out.authorName = author;
    const published = meta('meta[property="article:published_time"]', 'meta[name="date"]');
    if (published) out.published = published.slice(0, 10);
    const ogTitle = meta('meta[property="og:title"]');
    if (ogTitle && ogTitle.length < (document.title || "").length) out.title = ogTitle;
    return out;
  }

  // -------------------------------------------------------------------------

  function stripHash(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString();
    } catch {
      return url;
    }
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  function truncate(s, n) {
    return s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
  }
})();
