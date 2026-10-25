/**
 * allai — the capture form.
 *
 * One function, `__allaiForm.show(payload, options)`, renders the form either
 * as an overlay inside the current page (in a shadow root, so neither side's
 * styles leak) or inline in the fallback window (popup.html). The one required
 * field is "What I like": a capture without a reason is worth nothing to the
 * pipeline, which treats that line as the brief.
 *
 * Keys: Enter saves (Shift+Enter for a new line), Esc closes.
 */

(() => {
  if (globalThis.__allaiForm) return;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 8vh 16px 16px; background: rgba(0, 0, 0, 0.45);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #ececec; -webkit-font-smoothing: antialiased;
    }
    .backdrop.inline { position: static; padding: 0; background: none; display: block; }
    .card {
      width: 420px; max-width: 100%; background: #141414; border: 1px solid #2a2a2a;
      border-radius: 14px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); padding: 16px;
    }
    .inline .card { width: 100%; border: 0; border-radius: 0; box-shadow: none; }
    .head { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
    .thumb {
      width: 56px; height: 56px; flex: 0 0 56px; border-radius: 8px; background: #1e1e1e;
      object-fit: cover; display: block; border: 1px solid #2a2a2a;
    }
    .thumb.empty { display: flex; align-items: center; justify-content: center; color: #555; font-size: 11px; }
    .meta { min-width: 0; flex: 1; }
    .from { color: #8a8a8a; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .from b { color: #c8c8c8; font-weight: 600; }
    input, textarea, select {
      width: 100%; font: inherit; color: #ececec; background: #1c1c1c; border: 1px solid #2c2c2c;
      border-radius: 8px; padding: 7px 9px; outline: none; margin: 0;
    }
    input:focus, textarea:focus, select:focus { border-color: #6b6b6b; }
    input.title { margin-top: 4px; font-weight: 600; padding: 5px 8px; }
    textarea { resize: vertical; min-height: 64px; }
    label { display: block; font-size: 11px; color: #8a8a8a; margin: 10px 0 4px; letter-spacing: 0.02em; text-transform: uppercase; }
    label .req { color: #ff7a59; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .row label { margin-top: 10px; }
    select { appearance: none; -webkit-appearance: none; background-image: linear-gradient(45deg, transparent 50%, #8a8a8a 50%), linear-gradient(135deg, #8a8a8a 50%, transparent 50%); background-position: calc(100% - 16px) 15px, calc(100% - 11px) 15px; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 28px; }
    .check { display: flex; align-items: center; gap: 8px; height: 34px; margin: 0; color: #c8c8c8; cursor: pointer; font-size: 13px; text-transform: none; letter-spacing: 0; }
    .check input { width: 16px; height: 16px; margin: 0; accent-color: #ececec; }
    .actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
    .status { flex: 1; font-size: 12px; color: #8a8a8a; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status.ok { color: #7fd48a; }
    .status.err { color: #ff7a59; white-space: normal; }
    button {
      font: inherit; font-weight: 600; border-radius: 8px; padding: 7px 14px; cursor: pointer;
      border: 1px solid #2c2c2c; background: #1c1c1c; color: #c8c8c8;
    }
    button.primary { background: #ececec; color: #111; border-color: #ececec; }
    button:disabled { opacity: 0.5; cursor: default; }
    kbd { font: 11px ui-monospace, Menlo, monospace; opacity: 0.6; margin-left: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip { font: inherit; font-size: 12px; font-weight: 500; line-height: 1.2; padding: 4px 10px; border-radius: 999px;
            border: 1px solid #2c2c2c; background: #1c1c1c; color: #c8c8c8; cursor: pointer; }
    .chip:hover { border-color: #6b6b6b; }
    .chip.on { background: #ececec; color: #111; border-color: #ececec; }
    input.more { padding: 5px 9px; font-size: 12px; }
    label .hint { text-transform: none; letter-spacing: 0; color: #5f5f5f; }
    .check.publish { margin-top: 12px; }
    .check.shot { height: auto; margin-top: 6px; font-size: 12px; color: #8a8a8a; }
    .check.shot input { width: 14px; height: 14px; }
  `;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  function splitList(s) {
    return String(s || "")
      .split(/[,\n]/)
      .map((x) => x.trim().replace(/^\[\[|\]\]$/g, "").trim())
      .filter(Boolean);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  /** Chips that toggle names in a comma-separated input, matched without case or punctuation. */
  function chipRow(input, names) {
    const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const row = el("div", { class: "chips" });
    if (!names.length) row.hidden = true;
    const chips = names.map((name) =>
      el("button", {
        type: "button",
        class: "chip",
        text: name,
        onclick: () => {
          const list = splitList(input.value);
          const i = list.findIndex((x) => key(x) === key(name));
          if (i >= 0) list.splice(i, 1);
          else list.push(name);
          input.value = list.join(", ");
          sync();
        },
      }),
    );
    function sync() {
      const on = new Set(splitList(input.value).map(key));
      for (const c of chips) c.classList.toggle("on", on.has(key(c.textContent)));
    }
    input.addEventListener("input", sync);
    row.append(...chips);
    return row;
  }

  /**
   * @param payload  what the content script read: source, page, title, image, screenshot, author, authorName, text, published, siteKind
   * @param options  { config: {categories, styles, projects, online, wholePage}, save: (data) => Promise<reply>,
   *                   fullPage?: () => Promise<{shots, total, width} | {error}>, rememberWholePage?: (on) => void, inline?: boolean, onClose?: () => void }
   */
  function show(payload, options) {
    const { config = {}, save, fullPage, rememberWholePage, inline = false, onClose } = options;
    const categories = config.categories || [];

    // Only one form at a time.
    document.getElementById("allai-capture-host")?.remove();

    const host = el("div", { id: "allai-capture-host" });
    const root = host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(el("style", { text: CSS }));
    }

    const fromLine = payload.siteKind === "x"
      ? [payload.author && el("b", { text: payload.author }), payload.authorName && payload.authorName !== payload.author ? ` · ${payload.authorName}` : "", " · X", payload.images?.length > 1 ? ` · ${payload.images.length} images` : ""]
      : [el("b", { text: hostOf(payload.source) }), payload.authorName ? ` · ${payload.authorName}` : ""];

    const title = el("input", { class: "title", type: "text", value: payload.title || "", placeholder: "Title", "aria-label": "Title" });
    const why = el("textarea", { rows: 3, placeholder: "The specific thing worth keeping — the type, the motion, how the case study is structured…", "aria-label": "What I like" });
    // Category: one click picks a chip, a second click on it clears it. Left
    // empty, the sync picks one before the capture goes on the site.
    let categoryValue = "";
    const categoryChips = el("div", { class: "chips", role: "radiogroup", "aria-label": "Category" },
      categories.map((name) => {
        const chip = el("button", {
          type: "button",
          class: "chip",
          text: name,
          onclick: () => {
            categoryValue = categoryValue === name ? "" : name;
            for (const c of categoryChips.children) c.classList.toggle("on", c.textContent === categoryValue);
          },
        });
        return chip;
      }),
    );
    const publish = el("input", { type: "checkbox", checked: true }); // on by default: most captures are for the site
    // Style and Projects: one click on a chip adds or removes it; the small
    // field under the chips is only for a new one. Chips come from the
    // receiver: styles already used in the vault, active client folders.
    const style = el("input", { type: "text", class: "more", placeholder: "New style, comma-separated", "aria-label": "Style" });
    const projects = el("input", { type: "text", class: "more", placeholder: "New project", "aria-label": "Projects" });
    const styleChips = chipRow(style, (config.styles || []).slice(0, 14).map((s) => s.name));
    const projectChips = chipRow(projects, (config.projects || []).map((p) => p.name));
    const status = el("div", { class: "status", text: config.online === false ? "Receiver not running — start it with: npm run inbox" : "" });
    if (config.online === false) status.classList.add("err");
    const saveBtn = el("button", { class: "primary", type: "submit" }, ["Save", el("kbd", { text: "↵" })]);
    const cancelBtn = el("button", { type: "button", text: "Cancel", onclick: () => close() });

    // A page capture can trade the visible screenshot for the whole page, taken on save
    // (the form steps aside while the page scrolls). The choice sticks between captures.
    const wholePage = el("input", { type: "checkbox", checked: Boolean(config.wholePage), onchange: () => rememberWholePage?.(wholePage.checked) });
    const shotToggle = payload.screenshot && fullPage ? el("label", { class: "check shot" }, [wholePage, "Whole page"]) : null;

    const thumb = payload.image || payload.screenshot
      ? el("img", { class: "thumb", src: payload.image || payload.screenshot, alt: "" })
      : el("div", { class: "thumb empty", text: "page" });

    const form = el("form", { class: "card", novalidate: true }, [
      el("div", { class: "head" }, [
        thumb,
        el("div", { class: "meta" }, [el("div", { class: "from" }, fromLine), title, shotToggle]),
      ]),
      el("label", {}, ["What I like ", el("span", { class: "req", text: "*" })]),
      why,
      el("label", {}, ["Category ", el("span", { class: "hint", text: "· skip it and the sync picks one" })]),
      categoryChips,
      el("label", { class: "check publish" }, [publish, "Publish on allai.design"]),
      el("label", { text: "Style" }),
      styleChips,
      style,
      el("label", { text: "Projects" }),
      projectChips,
      projects,
      el("div", { class: "actions" }, [status, cancelBtn, saveBtn]),
    ]);

    const backdrop = el("div", { class: `backdrop${inline ? " inline" : ""}` }, [form]);
    root.append(backdrop);

    // Keys typed in the form must not reach the page (X has single-key shortcuts: l likes a post).
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (e) => e.stopPropagation());
    host.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop && !why.value.trim()) close();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });

    let busy = false;
    async function submit() {
      if (busy) return;
      const reason = why.value.trim();
      if (!reason) {
        setStatus("Say what you like about it — that line is the whole point.", "err");
        why.focus();
        return;
      }
      busy = true;
      saveBtn.disabled = true;
      let screenshot = payload.screenshot;
      const notes = [];
      if (shotToggle && wholePage.checked) {
        setStatus("Capturing the whole page…");
        host.style.visibility = "hidden";
        try {
          const reply = await fullPage();
          if (reply?.error) throw new Error(reply.error);
          if (reply?.shots?.length > 1) screenshot = await stitch(reply);
        } catch (err) {
          notes.push(`whole page failed (${err?.message || err}), kept the visible part`);
        } finally {
          host.style.visibility = "";
        }
      }
      setStatus("Saving…");
      const data = {
        ...payload,
        screenshot,
        title: title.value.trim() || payload.title,
        why: reason,
        category: categoryValue,
        style: splitList(style.value),
        projects: splitList(projects.value),
        publish: publish.checked,
      };
      let reply;
      try {
        reply = await save(data);
      } catch (err) {
        reply = { ok: false, error: String(err?.message || err) };
      }
      if (reply?.ok) {
        const warnings = [...notes, ...(reply.warnings || [])];
        const warn = warnings.length ? ` (${warnings.join("; ")})` : "";
        setStatus(`Saved · ${reply.noteName || "note written"}${warn}`, "ok");
        setTimeout(close, warnings.length ? 2600 : 900);
      } else {
        busy = false;
        saveBtn.disabled = false;
        setStatus(reply?.error || "Save failed", "err");
      }
    }

    function setStatus(text, kind = "") {
      status.textContent = text;
      status.className = `status${kind ? ` ${kind}` : ""}`;
    }

    function close() {
      host.remove();
      onClose?.();
    }

    (inline ? document.body : document.documentElement).append(host);
    why.focus();
    return { close };
  }

  // Whole page: the background scrolled the tab a screen at a time and took one
  // screenshot per stop. Each lands at its scroll offset; the last one overlaps.
  const MAX_AREA = 16e6; // output pixels, under Safari's canvas limit
  const MAX_SIDE = 32000;

  async function stitch({ shots, total, width }) {
    const images = await Promise.all(shots.map((s) => loadImage(s.url)));
    const k = images[0].naturalWidth / width; // device pixels per CSS pixel
    const fullW = images[0].naturalWidth;
    const fullH = Math.round(total * k);
    const scale = Math.min(1, Math.sqrt(MAX_AREA / (fullW * fullH)), MAX_SIDE / fullH);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(fullW * scale);
    canvas.height = Math.round(fullH * scale);
    const ctx = canvas.getContext("2d");
    images.forEach((img, i) => {
      ctx.drawImage(img, 0, Math.round(shots[i].y * k * scale), canvas.width, Math.round(img.naturalHeight * scale));
    });
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not read a screenshot"));
      img.src = src;
    });
  }

  globalThis.__allaiForm = { show, splitList };
})();
