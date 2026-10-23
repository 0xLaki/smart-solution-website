const test = require("node:test");
const assert = require("node:assert/strict");
const { start, mockFetch, telegramOk } = require("./helpers");

const ENV = { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_NOTIFY_CHAT_ID: "5550001" };

async function talk(t, id, n, from = 0) {
  for (let i = from; i < from + n; i++) {
    const r = await t.post("/api/smart/message", { sessionId: id, text: "Сообщение номер " + (i + 1) + " про нашу кофейню", via: i % 2 ? "voice" : "text" });
    assert.equal(r.status, 200);
  }
}

test("hand-off: 409 before 35 messages and without a contact, then the card and the full transcript go to Misha", async () => {
  const fetch = mockFetch([telegramOk]);
  const t = await start(ENV, fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    await talk(t, s.sessionId, 34);

    let r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { ok: false, need: 1, needContact: true });

    await t.post("/api/smart/contact", { sessionId: s.sessionId, contact: { name: "Олег", phone: "+7 999 000-11-22" } });
    r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.deepEqual(r.body, { ok: false, need: 1, needContact: false });
    assert.equal(fetch.calls.length, 0);

    const last = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Ну что, зовите Михаила" });
    assert.equal(last.body.userCount, 35);
    assert.equal(last.body.canHandoff, true);

    r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.reply.text, /Передал наш разговор Михаилу/);

    assert.equal(fetch.calls.length, 2);
    const [card, doc] = fetch.calls;
    assert.ok(card.url.endsWith("/bot123:abc/sendMessage"));
    const cardBody = JSON.parse(card.init.body);
    assert.equal(cardBody.chat_id, "5550001");
    assert.match(cardBody.text, /Имя: Олег/);
    assert.match(cardBody.text, /Связь: \+7 999 000-11-22/);
    assert.match(cardBody.text, /Сообщений клиента: 35/);

    assert.ok(doc.url.endsWith("/sendDocument"));
    assert.match(doc.init.headers["Content-Type"], /^multipart\/form-data; boundary=/);
    const file = Buffer.from(doc.init.body).toString("utf8");
    assert.match(file, /filename="smart-\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]{6}\.txt"/);
    for (let i = 1; i <= 34; i++) assert.ok(file.includes("Сообщение номер " + i + " про нашу кофейню"), "message " + i + " is in the transcript");
    assert.ok(file.includes("Клиент (голосом): Сообщение номер 2"));
    assert.ok(file.includes("Смарт: Здравствуйте!"));

    const back = (await t.post("/api/smart/session", { sessionId: s.sessionId })).body;
    assert.equal(back.handedOff, true);
    assert.equal(back.canHandoff, false);

    // a second press does not send it again
    r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.deepEqual(r.body, { ok: true, already: true });
    assert.equal(fetch.calls.length, 2);

    // what the visitor writes after the hand-off reaches Misha too
    await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Забыл сказать: у нас две точки" });
    await t.app.idle();
    assert.equal(fetch.calls.length, 3);
    const fwd = JSON.parse(fetch.calls[2].init.body);
    assert.match(fwd.text, /продолжение: Олег/);
    assert.match(fwd.text, /Клиент: Забыл сказать: у нас две точки/);
  } finally {
    await t.close();
  }
});

test("hand-off without the Telegram settings says so, and a Telegram failure leaves it undone", async () => {
  const off = await start({ SMART_HANDOFF_MIN: "2" });
  try {
    const s = (await off.post("/api/smart/session", {})).body;
    await off.post("/api/smart/contact", { sessionId: s.sessionId, contact: { telegram: "@oleg_k" } });
    await talk(off, s.sessionId, 2);
    const r = await off.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.equal(r.status, 503);
  } finally {
    await off.close();
  }

  const fetch = mockFetch([["api.telegram.org", () => ({ status: 502, json: { ok: false, description: "Bad Gateway" } })]]);
  const t = await start(Object.assign({ SMART_HANDOFF_MIN: "2" }, ENV), fetch);
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/contact", { sessionId: s.sessionId, contact: { telegram: "@oleg_k" } });
    await talk(t, s.sessionId, 2);
    const r = await t.post("/api/smart/handoff", { sessionId: s.sessionId });
    assert.equal(r.status, 502);
    const back = (await t.post("/api/smart/session", { sessionId: s.sessionId })).body;
    assert.equal(back.handedOff, false);
    assert.equal(back.canHandoff, true);
  } finally {
    await t.close();
  }
});
