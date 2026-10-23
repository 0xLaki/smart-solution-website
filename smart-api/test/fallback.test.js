const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("./helpers");
const { scriptedReply, topic, detectService } = require("../brain");
const { loadCatalog } = require("../catalog");

const catalog = loadCatalog();

test("the site's topics still work", () => {
  const q = (s) => " " + s.toLowerCase().replace(/ё/g, "е") + " ";
  assert.equal(topic(q("Сколько стоит сайт?")), "price");
  assert.equal(topic(q("Какие сроки?")), "time");
  assert.equal(topic(q("С кем вы работали?")), "work");
  assert.equal(topic(q("Нужен чат-бот в телеграм")), "bot");
  assert.equal(topic(q("Хочу интернет-магазин")), "site");
  assert.equal(topic(q("кто такие")), "");
});

test("the service is read from the visitor's words", () => {
  assert.equal(detectService("Нужен бот для записи клиентов", catalog), "ИИ-боты");
  assert.equal(detectService("хотим интернет-магазин с оплатой", catalog), "Интернет-магазины и каталоги");
  assert.equal(detectService("приложение для айфона", catalog), "Мобильные приложения");
  assert.equal(detectService("нужен сайт", catalog), "Сайты");
  assert.equal(detectService("работаем с ресторанами", catalog), "");
});

test("a scripted reply answers the question, then asks one script question", () => {
  const s = { messages: [] };
  const r = scriptedReply(s, "Сколько стоит сайт?", { hasContact: false, gotContact: false, name: "", userCount: 1, canHandoff: false });
  assert.match(r.text, /Цену Михаил назовёт/);
  assert.match(r.text, /Как вас зовут/);
  assert.ok(r.quick.length <= 3);
  // an answer to the script is not taken for a question about prices
  const r2 = scriptedReply(s, "Бюджет около 300 тысяч рублей", { hasContact: true, gotContact: false, name: "Иван", userCount: 2, canHandoff: false });
  assert.doesNotMatch(r2.text, /Цену/);
  assert.match(r2.text, /\?$/);
});

test("asking for a person before the threshold keeps the talk going", () => {
  const s = { messages: [] };
  const r = scriptedReply(s, "Хочу поговорить с живым человеком", { hasContact: true, gotContact: false, name: "", userCount: 3, canHandoff: false });
  assert.match(r.text, /Михаил подключится/);
  assert.match(r.text, /\?$/);
  const r2 = scriptedReply(s, "Позовите Михаила", { hasContact: true, gotContact: false, name: "", userCount: 36, canHandoff: true });
  assert.match(r2.text, /Можно звать Михаила/);
});

test("without GigaChat the API answers with the scripted brain and asks for the contact", async () => {
  const t = await start();
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Сколько стоит сайт?", via: "voice" });
    assert.equal(r.status, 200);
    assert.match(r.body.reply.text, /Цену Михаил назовёт/);
    assert.ok(Array.isArray(r.body.reply.quick) && r.body.reply.quick.length <= 3);
    assert.equal(r.body.service, "Сайты");
    assert.equal(r.body.askContact, true);
    assert.equal(r.body.userCount, 1);
    assert.equal(r.body.canHandoff, false);

    // the contact typed into the chat is picked up
    const r2 = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Иван, мой телеграм @ivan_petrov", via: "text" });
    assert.equal(r2.body.askContact, false);
    assert.match(r2.body.reply.text, /Спасибо, Иван/);
    const back = (await t.post("/api/smart/session", { sessionId: s.sessionId })).body;
    assert.deepEqual(back.contact, { telegram: "@ivan_petrov", name: "Иван" });
    assert.equal(back.messages[1].via, "voice");
  } finally {
    await t.close();
  }
});

test("long texts are refused, empty ones too", async () => {
  const t = await start();
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const long = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "а".repeat(1001) });
    assert.equal(long.status, 400);
    assert.equal(long.body.error, "too_long");
    const empty = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "   " });
    assert.equal(empty.status, 400);
  } finally {
    await t.close();
  }
});

test("too many messages a minute get 429", async () => {
  const t = await start({ SMART_RATE_PER_MIN: "3" });
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    for (let i = 0; i < 3; i++) assert.equal((await t.post("/api/smart/message", { sessionId: s.sessionId, text: "текст " + i })).status, 200);
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "ещё" });
    assert.equal(r.status, 429);
    assert.ok(r.body.retryIn > 0);
  } finally {
    await t.close();
  }
});

test("a session stops growing at its cap", async () => {
  const t = await start({ SMART_MAX_MESSAGES: "5" });
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/message", { sessionId: s.sessionId, text: "раз" });
    await t.post("/api/smart/message", { sessionId: s.sessionId, text: "два" });
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "три" });
    assert.match(r.body.reply.text, /Позовите Михаила/);
    const back = (await t.post("/api/smart/session", { sessionId: s.sessionId })).body;
    assert.equal(back.messages.length, 5);
  } finally {
    await t.close();
  }
});
