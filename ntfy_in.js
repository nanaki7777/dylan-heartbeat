require("dotenv").config({ quiet: true });
const fs = require("fs");
const { runtimeFile } = require("./runtime_paths");
const { formatDateTimeInTimeZone, resolveTimeZone } = require("./time_utils");

const TIME_ZONE = resolveTimeZone();
const PORT = Number(process.env.PORT) || 3000;
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const EVENT_URL = `${GATEWAY_BASE_URL}/internal/wake-event`;
const SERVER_URL = (process.env.NTFY_SERVER_URL || "https://ntfy.sh").replace(/\/+$/, "");
const TOPIC = String(process.env.NTFY_TOPIC || "").trim();
const TOKEN = String(process.env.NTFY_TOKEN || "").trim();
const POLL_MS = 15000;
const STATE_FILE = runtimeFile("ntfy_in_state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); }
  catch { return { since: Math.floor(Date.now() / 1000), seen: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8");
}

async function pushEvent(text) {
  const content = `（${formatDateTimeInTimeZone(new Date(), TIME_ZONE)} 用户在 ntfy 回复：${text}）`;
  const r = await fetch(EVENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) console.error("写入时间线失败:", r.status, await r.text());
  else console.log("已写入时间线:", text.slice(0, 40));
}

async function pollOnce(state) {
  const headers = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const url = `${SERVER_URL}/${encodeURIComponent(TOPIC)}/json?poll=1&since=${state.since}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.error("ntfy 轮询失败:", r.status); return; }
  const text = await r.text();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.event !== "message") continue;
    if (ev.title) continue;                 // 我们发出去的推送带 title，跳过
    if (state.seen.includes(ev.id)) continue;
    const message = String(ev.message || "").trim();
    if (!message) continue;
    state.seen = [...state.seen.slice(-200), ev.id];
    state.since = Math.max(state.since, ev.time || state.since);
    await pushEvent(message.slice(0, 500));
    saveState(state);
  }
}

async function main() {
  if (!TOPIC || (process.env.PUSH_PROVIDER || "").toLowerCase() !== "ntfy") {
    console.log("ntfy_in: 未启用（需要 PUSH_PROVIDER=ntfy 且 NTFY_TOPIC 已配置）");
    return;
  }
  const state = loadState();
  saveState(state);
  console.log("ntfy_in: 开始监听 topic", TOPIC);
  while (true) {
    try { await pollOnce(state); } catch (e) { console.error("ntfy_in 异常:", e.message); }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
main();
