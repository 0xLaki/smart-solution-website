// GigaChat API client (developers.sber.ru/docs/ru/gigachat/api/reference/rest):
// an access token from the OAuth endpoint (valid 30 min, cached until a minute before it ends),
// then POST /chat/completions. Sber's hosts are signed by the Russian Trusted Root CA, which Node
// gets through NODE_EXTRA_CA_CERTS (see smart-api/Dockerfile); TLS checks are never turned off.
const crypto = require("crypto");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createGigaChat(cfg, { fetch = globalThis.fetch, now = Date.now } = {}) {
  let token = null;
  let tokenUntil = 0;
  let tokenJob = null;
  let failedUntil = 0; // after a refused key, wait a little instead of asking on every message

  async function getToken() {
    if (token && now() < tokenUntil - 60000) return token;
    if (now() < failedUntil) throw new Error("gigachat oauth: waiting after a failure");
    if (!tokenJob) {
      tokenJob = (async () => {
        const r = await fetch(cfg.oauthUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            RqUID: crypto.randomUUID(),
            Authorization: "Basic " + cfg.authKey,
          },
          body: "scope=" + encodeURIComponent(cfg.scope),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          failedUntil = now() + 30000;
          throw new Error("gigachat oauth " + r.status);
        }
        const j = await r.json();
        if (!j || !j.access_token) throw new Error("gigachat oauth: no token in the answer");
        // expires_at is unix time in milliseconds; seconds are accepted too
        let until = Number(j.expires_at) || 0;
        if (until && until < 1e12) until *= 1000;
        token = j.access_token;
        tokenUntil = until || now() + 25 * 60000;
        return token;
      })().finally(() => {
        tokenJob = null;
      });
    }
    return tokenJob;
  }

  // Personal keys generate in one stream at a time: calls wait for a free slot (or give up after waitMs).
  let active = 0;
  const queue = [];
  function release() {
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else active--;
  }
  function acquire(waitMs) {
    if (active < cfg.concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        reject(new Error("gigachat busy"));
      }, waitMs);
      queue.push(w);
    });
  }

  async function call(messages, opts, retry) {
    const t = await getToken();
    const body = { model: cfg.model, messages, stream: false, max_tokens: opts.maxTokens || 400 };
    if (opts.temperature != null) body.temperature = opts.temperature;
    const r = await fetch(cfg.apiUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 30000),
    });
    if (r.status === 401 && retry) {
      token = null;
      tokenUntil = 0;
      return call(messages, opts, false);
    }
    if (r.status === 429 && retry) {
      await sleep(1500);
      return call(messages, opts, false);
    }
    if (!r.ok) throw new Error("gigachat chat " + r.status);
    const j = await r.json();
    const c = j && j.choices && j.choices[0];
    return { text: (c && c.message && typeof c.message.content === "string" && c.message.content) || "", finish: (c && c.finish_reason) || "" };
  }

  // messages: [{ role: "system" | "user" | "assistant", content }]
  async function chat(messages, opts = {}) {
    await acquire(opts.waitMs || 20000);
    try {
      return await call(messages, opts, true);
    } finally {
      release();
    }
  }

  return { chat };
}

module.exports = { createGigaChat };
