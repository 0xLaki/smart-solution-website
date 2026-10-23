const test = require("node:test");
const assert = require("node:assert/strict");
const { start, mockFetch, telegramOk } = require("./helpers");
const { parseReply, parseExtraction, history } = require("../ai");

const NAMES = ["ИИ-боты", "Интеграции", "Лендинги"];

test("the model's reply becomes plain text plus chips", () => {
  const r = parseReply("**Отлично!** Чем занимается ваша компания?\n\nПодсказки: Ресторан | «Магазин» | Сервис | Лишний");
  assert.deepEqual(r, { text: "Отлично! Чем занимается ваша компания?", quick: ["Ресторан", "Магазин", "Сервис"] });
  assert.deepEqual(parseReply("Смарт: - Понял вас.\n- Какой срок?"), { text: "Понял вас.\nКакой срок?", quick: [] });
});

test("the brief: good JSON, JSON in a code fence, and bad JSON", () => {
  assert.deepEqual(parseExtraction('{"service":"ИИ-боты","summary":"Кофейня, нужен бот.","missing":["бюджет","сроки"]}', NAMES), {
    service: "ИИ-боты",
    summary: "Кофейня, нужен бот.",
    missing: ["бюджет", "сроки"],
  });
  assert.deepEqual(parseExtraction('Вот:\n```json\n{"service":"интеграции с CRM","summary":"","missing":"бюджет; сроки"}\n```', NAMES), {
    service: "Интеграции",
    summary: "",
    missing: ["бюджет", "сроки"],
  });
  assert.equal(parseExtraction("Не могу ответить в JSON", NAMES), null);
  assert.equal(parseExtraction('{"service": "ИИ-боты", "summary": }', NAMES), null);
  assert.equal(parseExtraction("[1,2]", NAMES), null);
  assert.equal(parseExtraction('{"service":"не ясно","summary":"","missing":[]}', NAMES), null);
  assert.equal(parseExtraction(null, NAMES), null);
});

test("the history for the model starts with the visitor and never repeats a role", () => {
  const s = {
    messages: [
      { role: "bot", text: "Здравствуйте" },
      { role: "user", text: "a" },
      { role: "bot", text: "b" },
      { role: "bot", text: "c" },
      { role: "user", text: "d" },
    ],
  };
  assert.deepEqual(history(s), [
    { role: "user", content: "a" },
    { role: "assistant", content: "b\nc" },
    { role: "user", content: "d" },
  ]);
});

function gigaMock({ chat }) {
  return mockFetch([
    ["/api/v2/oauth", () => ({ json: { access_token: "tok-1", expires_at: Date.now() + 30 * 60000 } })],
    ["/chat/completions", chat],
    telegramOk,
  ]);
}

const sysOf = (init) => JSON.parse(init.body).messages[0].content;

test("GigaChat answers: one token for many calls, the right request, the brief every 5 messages (bad JSON is skipped)", async () => {
  let briefs = 0;
  const fetch = gigaMock({
    chat: (url, init) => {
      if (sysOf(init).startsWith("Ты читаешь разговор")) {
        briefs++;
        return { json: { choices: [{ message: { role: "assistant", content: briefs === 1 ? "извините, без JSON" : '{"service":"ИИ-боты","summary":"Кофейня в Казани, нужен бот для заказов.","missing":["бюджет"]}' }, finish_reason: "stop" }] } };
      }
      return { json: { choices: [{ message: { role: "assistant", content: "Понял! Чем занимается ваша компания?\nПодсказки: Кофейня | Магазин" }, finish_reason: "stop" }] } };
    },
  });
  const t = await start({ GIGACHAT_AUTH_KEY: "Basic c2VjcmV0", GIGACHAT_MODEL: "GigaChat-2-Max" }, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Нужен бот для кофейни", via: "voice" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.reply, { text: "Понял! Чем занимается ваша компания?", quick: ["Кофейня", "Магазин"] });
    assert.equal(r.body.service, "ИИ-боты");

    const oauth = fetch.calls.filter((c) => c.url.includes("/oauth"));
    assert.equal(oauth.length, 1);
    assert.equal(oauth[0].init.headers.Authorization, "Basic c2VjcmV0");
    assert.match(oauth[0].init.headers.RqUID, /^[0-9a-f-]{36}$/);
    assert.equal(oauth[0].init.body, "scope=GIGACHAT_API_PERS");

    const chat = fetch.calls.find((c) => c.url.endsWith("/chat/completions"));
    assert.ok(chat.url.startsWith("https://api.giga.chat/v1/"));
    assert.equal(chat.init.headers.Authorization, "Bearer tok-1");
    const body = JSON.parse(chat.init.body);
    assert.equal(body.model, "GigaChat-2-Max");
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /Интеграции/); // services from products.js
    assert.match(body.messages[0].content, /надиктовал голосом/);
    assert.deepEqual(body.messages.slice(1), [{ role: "user", content: "Нужен бот для кофейни" }]);

    for (let i = 0; i < 4; i++) await t.post("/api/smart/message", { sessionId: s.sessionId, text: "ответ " + i });
    await t.app.idle();
    assert.equal(briefs, 1);
    assert.equal(fetch.calls.filter((c) => c.url.includes("/oauth")).length, 1);

    for (let i = 0; i < 5; i++) await t.post("/api/smart/message", { sessionId: s.sessionId, text: "ещё " + i });
    await t.app.idle();
    assert.equal(briefs, 2);
    const last = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "и ещё" });
    assert.equal(last.body.service, "ИИ-боты");
    const lastSys = sysOf(fetch.calls.filter((c) => c.url.endsWith("/chat/completions")).pop().init);
    assert.match(lastSys, /Кофейня в Казани/);
  } finally {
    await t.close();
  }
});

test("when GigaChat fails or refuses, the scripted brain answers", async () => {
  let n = 0;
  const fetch = gigaMock({
    chat: () => {
      n++;
      if (n === 1) return { status: 500, json: { message: "oops" } };
      return { json: { choices: [{ message: { role: "assistant", content: "Не люблю менять тему разговора" }, finish_reason: "blacklist" }] } };
    },
  });
  const t = await start({ GIGACHAT_AUTH_KEY: "c2VjcmV0" }, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const a = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Сколько стоит бот?" });
    assert.equal(a.status, 200);
    assert.match(a.body.reply.text, /Цену Михаил назовёт/);
    const b = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Какие сроки?" });
    assert.match(b.body.reply.text, /Сроки Михаил назовёт/);
  } finally {
    await t.close();
  }
});

test("an expired token is fetched again after a 401", async () => {
  let tokens = 0;
  let chats = 0;
  const fetch = mockFetch([
    ["/api/v2/oauth", () => ({ json: { access_token: "tok-" + ++tokens, expires_at: Date.now() + 30 * 60000 } })],
    [
      "/chat/completions",
      (url, init) => {
        chats++;
        if (init.headers.Authorization === "Bearer tok-1") return { status: 401, json: {} };
        return { json: { choices: [{ message: { content: "Расскажите о бизнесе?" }, finish_reason: "stop" }] } };
      },
    ],
  ]);
  const t = await start({ GIGACHAT_AUTH_KEY: "c2VjcmV0" }, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Привет" });
    assert.equal(r.body.reply.text, "Расскажите о бизнесе?");
    assert.equal(tokens, 2);
    assert.equal(chats, 2);
  } finally {
    await t.close();
  }
});

test("the hand-off card carries the AI summary", async () => {
  const fetch = gigaMock({
    chat: (url, init) => {
      if (sysOf(init).startsWith("Ты читаешь разговор")) return { json: { choices: [{ message: { content: '{"service":"Лендинги","summary":"Школа танцев, нужен лендинг под рекламу.","missing":["бюджет"]}' } }] } };
      return { json: { choices: [{ message: { content: "Понял. Что ещё важно?" } }] } };
    },
  });
  const t = await start({ GIGACHAT_AUTH_KEY: "c2VjcmV0", SMART_HANDOFF_MIN: "3", TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_NOTIFY_CHAT_ID: "42" }, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/contact", { sessionId: s.sessionId, contact: { name: "Вера", telegram: "@vera_dance" } });
    for (let i = 0; i < 3; i++) await t.post("/api/smart/message", { sessionId: s.sessionId, text: "про школу " + i });
    const r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.equal(r.status, 200);
    const card = JSON.parse(fetch.calls.find((c) => c.url.endsWith("/sendMessage")).init.body).text;
    assert.match(card, /Услуга: Лендинги/);
    assert.match(card, /Суть: Школа танцев, нужен лендинг под рекламу\./);
    assert.match(card, /Не выяснено: бюджет/);
    assert.match(r.body.reply.text, /напишет вам в Telegram/);
  } finally {
    await t.close();
  }
});

test("a refused key is not asked again on every message", async () => {
  const fetch = mockFetch([["/api/v2/oauth", () => ({ status: 401, json: { message: "bad key" } })]]);
  const t = await start({ GIGACHAT_AUTH_KEY: "d3Jvbmc=" }, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    for (const text of ["Привет", "Нужен сайт", "Для кофейни"]) {
      const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text });
      assert.equal(r.status, 200);
      assert.ok(r.body.reply.text.length > 0);
    }
    assert.equal(fetch.calls.filter((c) => c.url.includes("/oauth")).length, 1);
  } finally {
    await t.close();
  }
});
