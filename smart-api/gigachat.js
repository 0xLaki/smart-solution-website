// GigaChat API client (developers.sber.ru/docs/ru/gigachat/api/reference/rest):
// an access token from the OAuth endpoint (valid 30 min, cached until a minute before it ends),
// then POST /chat/completions (and /files for voice recordings). Sber's hosts are signed by the Russian
// Trusted Root CA, which Node gets through NODE_EXTRA_CA_CERTS (see smart-api/Dockerfile); TLS checks
// are never turned off.
const crypto = require("crypto");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createGigaChat(cfg, { fetch = globalThis.fetch, now = Date.now, log = () => {} } = {}) {
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

  // One request to the API with the cached token. A 401 drops the token and the request goes once more
  // with a fresh one; a 429 waits a moment and the request goes once more. The body (JSON text or
  // FormData) can be sent twice.
  async function request(path, init, timeoutMs, retry = true) {
    const t = await getToken();
    const headers = Object.assign({ Accept: "application/json", Authorization: "Bearer " + t }, init.headers);
    const r = await fetch(cfg.apiUrl + path, Object.assign({}, init, { headers, signal: AbortSignal.timeout(timeoutMs) }));
    if (r.status === 401 && retry) {
      token = null;
      tokenUntil = 0;
      return request(path, init, timeoutMs, false);
    }
    if (r.status === 429 && retry) {
      await sleep(1500);
      return request(path, init, timeoutMs, false);
    }
    return r;
  }

  async function complete(body, timeoutMs) {
    const r = await request("/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
    if (!r.ok) throw new Error("gigachat chat " + r.status);
    const j = await r.json();
    const c = j && j.choices && j.choices[0];
    return { text: (c && c.message && typeof c.message.content === "string" && c.message.content) || "", finish: (c && c.finish_reason) || "" };
  }

  // messages: [{ role: "system" | "user" | "assistant", content }]
  async function chat(messages, opts = {}) {
    await acquire(opts.waitMs || 20000);
    try {
      const body = { model: cfg.model, messages, stream: false, max_tokens: opts.maxTokens || 400 };
      if (opts.temperature != null) body.temperature = opts.temperature;
      return await complete(body, opts.timeoutMs || 30000);
    } finally {
      release();
    }
  }

  // Speech to text (developers.sber.ru/docs/ru/gigachat/guides/working-with-files): the recording goes up
  // with POST /files, the model hears it as an attachment of the user's message, and the file is deleted
  // right after, whatever the answer was. All of it runs in one slot with the same key.
  // audio: a Buffer; name and mime: one of GigaChat's audio formats (voice.weba + audio/webm, …).
  // The timeouts keep the whole job well under the 90 s nginx and the server give a request.
  async function transcribe(audio, { name, mime }, opts = {}) {
    await acquire(opts.waitMs || 15000);
    try {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), name);
      form.append("purpose", "general");
      const up = await request("/files", { method: "POST", body: form }, opts.uploadTimeoutMs || 20000);
      if (!up.ok) throw new Error("gigachat upload " + up.status);
      const f = await up.json();
      const id = f && typeof f.id === "string" ? f.id : "";
      if (!id) throw new Error("gigachat upload: no file id in the answer");
      try {
        return await complete(
          {
            model: cfg.voiceModel || cfg.model,
            messages: [
              { role: "system", content: TRANSCRIBE_PROMPT },
              { role: "user", content: TRANSCRIBE_ASK, attachments: [id] },
            ],
            stream: false,
            max_tokens: 300,
            temperature: 0.1,
          },
          opts.timeoutMs || 25000
        );
      } finally {
        // best effort: a file left behind is only logged
        try {
          const d = await request("/files/" + encodeURIComponent(id) + "/delete", { method: "POST" }, 5000);
          if (!d.ok) log("gigachat: the uploaded recording was not deleted (" + d.status + ")");
        } catch (e) {
          log("gigachat: the uploaded recording was not deleted (" + e.message + ")");
        }
      }
    } finally {
      release();
    }
  }

  return { chat, transcribe };
}

// The model only writes down what it hears: it must not answer a question asked in the recording.
const TRANSCRIBE_PROMPT =
  "Ты распознаёшь речь. Верни дословно то, что сказано в аудио, на языке говорящего, с пунктуацией. " +
  "Без кавычек, пояснений и ответов на вопросы. Если речи нет, верни пустую строку.";
const TRANSCRIBE_ASK = "Запиши текстом, что сказано в аудио.";

module.exports = { createGigaChat, TRANSCRIBE_PROMPT };
