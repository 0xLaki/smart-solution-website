// Test helpers: the app on a random local port with its own data folder, and a fetch stand-in for
// GigaChat and Telegram (requests to the app itself use the real fetch).
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createApp } = require("../app");
const { loadConfig } = require("../config");

async function start(env = {}, fetchMock, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-api-"));
  const cfg = loadConfig(Object.assign({ SMART_DATA_DIR: dir, SMART_RATE_PER_MIN: "1000" }, env));
  const noNet = async (url) => {
    throw new Error("unexpected network call in a test: " + url);
  };
  const app = createApp({ config: cfg, fetch: fetchMock || noNet, log: opts.log || (() => {}), now: opts.now });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  async function call(method, p, body, headers) {
    const r = await fetch(base + p, {
      method,
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  async function close() {
    await app.idle();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { app, cfg, dir, close, post: (p, b, h) => call("POST", p, b, h), get: (p) => call("GET", p) };
}

// routes: [[urlPart, (url, init, calls) => ({ status?, json })], …]; every call is kept in .calls
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [part, handler] of routes) {
      if (!u.includes(part)) continue;
      const out = await handler(u, init, calls);
      return new Response(JSON.stringify(out.json === undefined ? {} : out.json), { status: out.status || 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("unexpected fetch " + u);
  };
  fn.calls = calls;
  return fn;
}

const telegramOk = ["api.telegram.org", () => ({ json: { ok: true, result: { message_id: 1 } } })];

// Telegram Login Widget data signed the way Telegram signs it
function signedLogin(fields, token) {
  const dataCheck = Object.keys(fields).sort().map((k) => k + "=" + fields[k]).join("\n");
  const secret = crypto.createHash("sha256").update(token).digest();
  return Object.assign({}, fields, { hash: crypto.createHmac("sha256", secret).update(dataCheck).digest("hex") });
}

module.exports = { start, mockFetch, telegramOk, signedLogin };
