const api = globalThis.browser ?? globalThis.chrome;
const input = document.getElementById("receiver");
const status = document.getElementById("status");

function report(config) {
  status.textContent = config.online
    ? `Connected · ${config.receiver} · ${config.categories.length} categories`
    : `Nothing answering at ${config.receiver}. Start it with: npm run inbox`;
  status.className = config.online ? "ok" : "err";
}

(async () => {
  const config = await api.runtime.sendMessage({ type: "allai:config" });
  input.value = config.receiver;
  report(config);
})();

document.getElementById("save").addEventListener("click", async () => {
  status.textContent = "Testing…";
  status.className = "";
  report(await api.runtime.sendMessage({ type: "allai:set-receiver", receiver: input.value.trim() }));
});
