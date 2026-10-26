const test = require("node:test");
const assert = require("node:assert/strict");
const { start, mockFetch } = require("./helpers");
const { createGigaChat, TRANSCRIBE_PROMPT } = require("../gigachat");
const { cleanTranscript } = require("../ai");
const { loadConfig } = require("../config");

const KEY = { GIGACHAT_AUTH_KEY: "c2VjcmV0" };
const AUDIO = Buffer.from("OggS test-only bytes standing in for an opus recording");
const B64 = AUDIO.toString("base64");
const WEBM = { name: "voice.weba", mime: "audio/webm" };

const answer = (content, finish = "stop") => ({ json: { choices: [{ message: { role: "assistant", content }, finish_reason: finish }] } });

// GigaChat with its file store; every route can be swapped. Tokens are tok-1, tok-2, …
function gigaFiles({ upload, chat, del } = {}) {
  let tokens = 0;
  const fetch = mockFetch([
    ["/api/v2/oauth", () => ({ json: { access_token: "tok-" + ++tokens, expires_at: Date.now() + 30 * 60000 } })],
    ["/delete", del || (() => ({ json: { id: "file-1", deleted: true } }))],
    ["/files", upload || (() => ({ json: { id: "file-1", object: "file", purpose: "general" } }))],
    ["/chat/completions", chat || (() => answer("Нужен бот для кофейни."))],
  ]);
  fetch.tokens = () => tokens;
  return fetch;
}

const uploads = (fetch) => fetch.calls.filter((c) => c.url.endsWith("/files"));
const chats = (fetch) => fetch.calls.filter((c) => c.url.endsWith("/chat/completions"));
const deletes = (fetch) => fetch.calls.filter((c) => c.url.endsWith("/delete"));
const pathsOf = (fetch) => fetch.calls.map((c) => new URL(c.url).pathname);

// ---------- the GigaChat client ----------

test("transcribe: a multipart upload, the model hears it as an attachment, then the file is deleted", async () => {
  const cfg = loadConfig(Object.assign({ GIGACHAT_VOICE_MODEL: "GigaChat-2-Max" }, KEY)).gigachat;
  const fetch = gigaFiles();
  const giga = createGigaChat(cfg, { fetch });
  const r = await giga.transcribe(AUDIO, WEBM);
  assert.deepEqual(r, { text: "Нужен бот для кофейни.", finish: "stop" });
  assert.deepEqual(pathsOf(fetch), ["/api/v2/oauth", "/v1/files", "/v1/chat/completions", "/v1/files/file-1/delete"]);

  const [up] = uploads(fetch);
  assert.equal(up.url, "https://api.giga.chat/v1/files");
  assert.equal(up.init.method, "POST");
  assert.equal(up.init.headers.Authorization, "Bearer tok-1");
  assert.equal(up.init.headers["Content-Type"], undefined); // fetch writes the multipart boundary itself
  assert.ok(up.init.body instanceof FormData);
  assert.equal(up.init.body.get("purpose"), "general");
  const file = up.init.body.get("file");
  assert.equal(file.name, "voice.weba");
  assert.equal(file.type, "audio/webm");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), AUDIO);
  const wire = await new Response(up.init.body).text();
  assert.match(wire, /name="file"; filename="voice\.weba"\r\nContent-Type: audio\/webm/);
  assert.match(wire, /name="purpose"\r\n\r\ngeneral\r\n/);

  const [chat] = chats(fetch);
  assert.equal(chat.init.headers.Authorization, "Bearer tok-1");
  const body = JSON.parse(chat.init.body);
  assert.equal(body.model, "GigaChat-2-Max");
  assert.equal(body.max_tokens, 300);
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.messages[0], { role: "system", content: TRANSCRIBE_PROMPT });
  assert.match(TRANSCRIBE_PROMPT, /дословно/);
  assert.equal(body.messages[1].role, "user");
  assert.deepEqual(body.messages[1].attachments, ["file-1"]);

  const [del] = deletes(fetch);
  assert.equal(del.url, "https://api.giga.chat/v1/files/file-1/delete");
  assert.equal(del.init.method, "POST");
  assert.equal(del.init.headers.Authorization, "Bearer tok-1");
  assert.equal(fetch.tokens(), 1);
});

test("transcribe: the file is deleted even when the model fails; a failed delete never throws", async () => {
  const cfg = loadConfig(KEY).gigachat;
  const failing = gigaFiles({ chat: () => ({ status: 500, json: { message: "oops" } }) });
  await assert.rejects(createGigaChat(cfg, { fetch: failing }).transcribe(AUDIO, WEBM), /gigachat chat 500/);
  assert.equal(deletes(failing).length, 1);
  assert.match(deletes(failing)[0].url, /\/files\/file-1\/delete$/);

  // a refused upload: nothing to ask the model about, nothing to delete
  const refused = gigaFiles({ upload: () => ({ status: 413, json: {} }) });
  await assert.rejects(createGigaChat(cfg, { fetch: refused }).transcribe(AUDIO, WEBM), /gigachat upload 413/);
  assert.equal(chats(refused).length, 0);
  assert.equal(deletes(refused).length, 0);

  // the delete itself failing (an error status or a dead connection) is only logged
  const lines = [];
  const broken = gigaFiles({
    del: () => {
      throw new Error("socket hang up");
    },
  });
  assert.equal((await createGigaChat(cfg, { fetch: broken, log: (l) => lines.push(l) }).transcribe(AUDIO, WEBM)).text, "Нужен бот для кофейни.");
  const status = gigaFiles({ del: () => ({ status: 500, json: {} }) });
  assert.equal((await createGigaChat(cfg, { fetch: status, log: (l) => lines.push(l) }).transcribe(AUDIO, WEBM)).text, "Нужен бот для кофейни.");
  assert.deepEqual(lines, ["gigachat: the uploaded recording was not deleted (socket hang up)", "gigachat: the uploaded recording was not deleted (500)"]);
});

test("transcribe: an expired token is fetched again after a 401, on the upload and on the model's call", async () => {
  const cfg = loadConfig(KEY).gigachat;
  const onUpload = gigaFiles({
    upload: (url, init) => (init.headers.Authorization === "Bearer tok-1" ? { status: 401, json: {} } : { json: { id: "file-2" } }),
  });
  assert.equal((await createGigaChat(cfg, { fetch: onUpload }).transcribe(AUDIO, WEBM)).text, "Нужен бот для кофейни.");
  assert.equal(onUpload.tokens(), 2);
  assert.deepEqual(uploads(onUpload).map((c) => c.init.headers.Authorization), ["Bearer tok-1", "Bearer tok-2"]);
  // the same form goes again, file and all
  assert.match(await new Response(uploads(onUpload)[1].init.body).text(), /filename="voice\.weba"/);
  assert.deepEqual(JSON.parse(chats(onUpload)[0].init.body).messages[1].attachments, ["file-2"]);
  assert.equal(chats(onUpload)[0].init.headers.Authorization, "Bearer tok-2");
  assert.match(deletes(onUpload)[0].url, /\/files\/file-2\/delete$/);

  const onChat = gigaFiles({ chat: (url, init) => (init.headers.Authorization === "Bearer tok-1" ? { status: 401, json: {} } : answer("Привет")) });
  assert.equal((await createGigaChat(cfg, { fetch: onChat }).transcribe(AUDIO, WEBM)).text, "Привет");
  assert.equal(onChat.tokens(), 2);
  assert.equal(uploads(onChat).length, 1);
  assert.equal(chats(onChat).length, 2);
  assert.deepEqual(JSON.parse(chats(onChat)[1].init.body).messages[1].attachments, ["file-1"]);
  assert.equal(deletes(onChat)[0].init.headers.Authorization, "Bearer tok-2");
});

test("transcribe holds the one GigaChat slot: a reply waits until the recording is written down and deleted", async () => {
  let letGo;
  const gate = new Promise((r) => (letGo = r));
  const fetch = gigaFiles({
    chat: async (url, init) => {
      if (JSON.parse(init.body).messages.some((m) => m.attachments)) {
        await gate;
        return answer("раз");
      }
      return answer("два");
    },
  });
  const giga = createGigaChat(loadConfig(KEY).gigachat, { fetch });
  const voice = giga.transcribe(AUDIO, WEBM);
  const reply = giga.chat([{ role: "user", content: "привет" }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chats(fetch).length, 1);
  letGo();
  assert.deepEqual([(await voice).text, (await reply).text], ["раз", "два"]);
  assert.deepEqual(pathsOf(fetch), ["/api/v2/oauth", "/v1/files", "/v1/chat/completions", "/v1/files/file-1/delete", "/v1/chat/completions"]);
});

test("the transcript is cleaned: quotes, labels and stage notes go, the length is capped", () => {
  assert.equal(cleanTranscript("  «Нужен бот для кофейни.»  "), "Нужен бот для кофейни.");
  assert.equal(cleanTranscript('"«Привет»"'), "Привет");
  assert.equal(cleanTranscript("Текст: Сколько стоит сайт?"), "Сколько стоит сайт?");
  assert.equal(cleanTranscript("раз,\nдва\tтри"), "раз, два три");
  assert.equal(cleanTranscript('"а" и "б"'), '"а" и "б"');
  assert.equal(cleanTranscript('«"а" и "б"»'), '"а" и "б"');
  for (const nothing of ['""', "«»", "", "(тишина)", "[музыка]", "Речи нет.", null]) assert.equal(cleanTranscript(nothing), "");
  const long = cleanTranscript("слово ".repeat(300), 1000);
  assert.ok(long.length <= 1000);
  assert.match(long, /слово$/);
});

// ---------- POST /api/smart/voice ----------

test("POST /voice: the recording comes back as text, and only its size gets into the log", async () => {
  const lines = [];
  const fetch = gigaFiles({ chat: () => answer("«Нужен бот для кофейни.»") });
  const t = await start(KEY, fetch, { log: (l) => lines.push(l) });
  try {
    const r = await t.post("/api/smart/voice", { sessionId: "AAAAAAAAAAAAAAAAAAAAAA", type: "audio/webm;codecs=opus", audio: B64 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, text: "Нужен бот для кофейни." });
    assert.equal(JSON.parse(chats(fetch)[0].init.body).model, "GigaChat-2-Pro"); // no GIGACHAT_VOICE_MODEL: the chat model
    assert.equal(deletes(fetch).length, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp("^POST /api/smart/voice 200 \\d+ms " + AUDIO.length + " B$"));
  } finally {
    await t.close();
  }
});

test("POST /voice: each recorder type goes up under the name and type GigaChat knows", async () => {
  const fetch = gigaFiles();
  const t = await start(KEY, fetch);
  try {
    const cases = [
      ["audio/webm;codecs=opus", "voice.weba", "audio/webm"],
      ["audio/ogg; codecs=opus", "voice.ogg", "audio/x-ogg"],
      ["audio/mp4;codecs=mp4a.40.2", "voice.mp4", "audio/mp4"],
      ["Audio/MPEG", "voice.mp3", "audio/mp3"],
      ["audio/wav", "voice.wav", "audio/wav"],
    ];
    for (const [type, name, mime] of cases) {
      const r = await t.post("/api/smart/voice", { type, audio: B64 });
      assert.equal(r.status, 200, type);
      const file = uploads(fetch).pop().init.body.get("file");
      assert.deepEqual([file.name, file.type], [name, mime], type);
    }
  } finally {
    await t.close();
  }
});

test("POST /voice: bad audio and unsupported types get 400 without a call to GigaChat", async () => {
  const fetch = gigaFiles();
  const t = await start(KEY, fetch);
  try {
    const bad = [
      { type: "video/webm", audio: B64 },
      { type: "audio/flac", audio: B64 },
      { type: "audio/constructor", audio: B64 },
      { type: ["audio/webm"], audio: B64 },
      { audio: B64 },
      { type: "audio/webm" },
      { type: "audio/webm", audio: "" },
      { type: "audio/webm", audio: "data:audio/webm;base64," + B64 },
      { type: "audio/webm", audio: "это не base64!" },
      { type: "audio/webm", audio: "QUJD-RA_" },
      { type: "audio/webm", audio: "QUJDR" },
      { type: "audio/webm", audio: 12345 },
    ];
    for (const body of bad) {
      const r = await t.post("/api/smart/voice", body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.deepEqual(r.body, { ok: false, error: "bad_audio" });
    }
    assert.equal(fetch.calls.length, 0);
  } finally {
    await t.close();
  }
});

test("POST /voice: over 1 MB of audio is too big; every other route keeps its 16 KB limit", async () => {
  const fetch = gigaFiles();
  const t = await start(KEY, fetch);
  try {
    const mb = await t.post("/api/smart/voice", { type: "audio/ogg", audio: Buffer.alloc(1024 * 1024, 7).toString("base64") });
    assert.equal(mb.status, 200);
    const over = await t.post("/api/smart/voice", { type: "audio/ogg", audio: Buffer.alloc(1024 * 1024 + 1, 7).toString("base64") });
    assert.equal(over.status, 413);
    assert.deepEqual(over.body, { ok: false, error: "too_big" });
    const huge = await t.post("/api/smart/voice", { type: "audio/ogg", audio: "A".repeat(1600 * 1024) });
    assert.equal(huge.status, 413);
    assert.deepEqual(huge.body, { ok: false, error: "too_big" });
    assert.equal(uploads(fetch).length, 1);

    const s = (await t.post("/api/smart/session", {})).body;
    const pad = "a".repeat(17 * 1024);
    for (const [p, body] of [
      ["/api/smart/message", { sessionId: s.sessionId, text: pad }],
      ["/api/smart/session", { pad }],
      ["/api/smart/contact", { sessionId: s.sessionId, contact: { name: pad } }],
      ["/api/smart/handoff", { sessionId: s.sessionId, pad }],
    ]) {
      const r = await t.post(p, body);
      assert.equal(r.status, 413, p);
      assert.deepEqual(r.body, { ok: false, error: "too_big" });
    }
  } finally {
    await t.close();
  }
});

test("POST /voice without GigaChat: 503 voice_off, and the config says voice: false", async () => {
  const t = await start();
  try {
    const r = await t.post("/api/smart/voice", { type: "audio/webm", audio: B64 });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, error: "voice_off" });
    assert.equal((await t.get("/api/smart/config")).body.voice, false);
  } finally {
    await t.close();
  }
});

test("POST /voice: more than 8 recordings a minute from one address get 429", async () => {
  const fetch = gigaFiles();
  const t = await start(KEY, fetch);
  try {
    for (let i = 0; i < 8; i++) assert.equal((await t.post("/api/smart/voice", { type: "audio/webm", audio: B64 })).status, 200);
    const r = await t.post("/api/smart/voice", { type: "audio/webm", audio: B64 });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, "rate");
    assert.ok(r.body.retryIn > 0);
    assert.equal(uploads(fetch).length, 8);
  } finally {
    await t.close();
  }
});

test("POST /voice: GigaChat failing gives 502 voice_failed; the uploaded file is still deleted", async () => {
  const lines = [];
  const fetch = gigaFiles({ chat: () => ({ status: 500, json: { message: "oops" } }) });
  const t = await start(KEY, fetch, { log: (l) => lines.push(l) });
  try {
    const r = await t.post("/api/smart/voice", { type: "audio/webm", audio: B64 });
    assert.equal(r.status, 502);
    assert.deepEqual(r.body, { ok: false, error: "voice_failed" });
    assert.equal(deletes(fetch).length, 1);
    assert.equal(lines[0], "voice: " + AUDIO.length + " B not written down: gigachat chat 500");
  } finally {
    await t.close();
  }

  // a refused key fails the same way
  const refused = await start(KEY, mockFetch([["/api/v2/oauth", () => ({ status: 401, json: {} })]]));
  try {
    const r = await refused.post("/api/smart/voice", { type: "audio/webm", audio: B64 });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "voice_failed");
  } finally {
    await refused.close();
  }
});

test("POST /voice: silence comes back as empty text, and so does GigaChat's refusal", async () => {
  let n = 0;
  const fetch = gigaFiles({ chat: () => (++n === 1 ? answer('""') : answer("Не люблю менять тему разговора", "blacklist")) });
  const t = await start(KEY, fetch);
  try {
    for (let i = 0; i < 2; i++) {
      const r = await t.post("/api/smart/voice", { type: "audio/webm", audio: B64 });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true, text: "" });
    }
  } finally {
    await t.close();
  }
});
