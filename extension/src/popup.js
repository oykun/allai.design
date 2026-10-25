// The fallback window: used when the form can't be drawn inside the page
// itself (a PDF, a browser-internal page). Same form, same save path.
const api = globalThis.browser ?? globalThis.chrome;

(async () => {
  const { pending } = await api.storage.local.get("pending");
  if (!pending) {
    document.getElementById("empty").hidden = false;
    return;
  }
  await api.storage.local.remove("pending");
  const config = await api.runtime.sendMessage({ type: "allai:config" });
  globalThis.__allaiForm.show(pending, {
    inline: true,
    config,
    save: (data) => api.runtime.sendMessage({ type: "allai:save", payload: data }),
    fullPage: pending.tabId ? () => api.runtime.sendMessage({ type: "allai:whole-page", tabId: pending.tabId, windowId: pending.windowId }) : null,
    rememberWholePage: (on) => api.runtime.sendMessage({ type: "allai:set-whole-page", on }),
    onClose: () => window.close(),
  });
})();
