const test = require("node:test");
const assert = require("node:assert/strict");
const { start, signedLogin } = require("./helpers");
const { verifyLogin, multipart } = require("../telegram");

const TOKEN = "123456:TEST-token";
const NOW = 1_790_000_000; // seconds

const fields = (extra) => Object.assign({ id: 777000, first_name: "Анна", username: "anna_k", photo_url: "https://t.me/i/userpic/320/a.jpg", auth_date: NOW - 60 }, extra);

test("a correctly signed login is accepted", () => {
  const u = verifyLogin(signedLogin(fields(), TOKEN), TOKEN, NOW);
  assert.deepEqual(u, { id: 777000, username: "anna_k", first_name: "Анна" });
});

test("a wrong hash, a changed field, an old date or another bot's token are refused", () => {
  const good = signedLogin(fields(), TOKEN);
  assert.equal(verifyLogin(Object.assign({}, good, { hash: "0".repeat(64) }), TOKEN, NOW), null);
  assert.equal(verifyLogin(Object.assign({}, good, { id: 1 }), TOKEN, NOW), null);
  assert.equal(verifyLogin(signedLogin(fields({ auth_date: NOW - 86401 }), TOKEN), TOKEN, NOW), null);
  assert.equal(verifyLogin(good, "999:other", NOW), null);
  assert.equal(verifyLogin(Object.assign({}, good, { hash: undefined }), TOKEN, NOW), null);
  assert.equal(verifyLogin(null, TOKEN, NOW), null);
});

test("multipart is built by hand with the file in it", () => {
  const m = multipart({ chat_id: "42", caption: "Разговор" }, { field: "document", name: "t.txt", type: "text/plain; charset=utf-8", data: "строка" });
  const text = m.body.toString("utf8");
  const boundary = m.type.split("boundary=")[1];
  assert.ok(text.startsWith("--" + boundary + "\r\n"));
  assert.ok(text.includes('name="chat_id"\r\n\r\n42\r\n'));
  assert.ok(text.includes('name="document"; filename="t.txt"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nстрока\r\n'));
  assert.ok(text.endsWith("--" + boundary + "--\r\n"));
});

test("Telegram login through the API counts as the contact and follows the person to another device", async () => {
  const t = await start({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: "smart_bot" }, undefined, { now: () => NOW * 1000 });
  try {
    // day one, the computer
    const a = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/message", { sessionId: a.sessionId, text: "Нужен бот для записи в салон" });
    const bad = await t.post("/api/smart/telegram-auth", { sessionId: a.sessionId, auth: Object.assign(signedLogin(fields(), TOKEN), { first_name: "Не Анна" }) });
    assert.equal(bad.status, 401);
    const ok = await t.post("/api/smart/telegram-auth", { sessionId: a.sessionId, auth: signedLogin(fields(), TOKEN) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.deepEqual(ok.body.user, { id: 777000, username: "anna_k", first_name: "Анна" });
    assert.equal(ok.body.sessionId, a.sessionId);
    const r = await t.post("/api/smart/message", { sessionId: a.sessionId, text: "Салон красоты в Казани" });
    assert.equal(r.body.askContact, false);

    // the phone: a fresh session, the same Telegram user → the first session comes back with everything
    const b = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/message", { sessionId: b.sessionId, text: "Это снова я" });
    const again = await t.post("/api/smart/telegram-auth", { sessionId: b.sessionId, auth: signedLogin(fields(), TOKEN) });
    assert.equal(again.status, 200);
    assert.equal(again.body.sessionId, a.sessionId);
    const texts = again.body.session.messages.map((m) => m.text);
    assert.ok(texts.includes("Нужен бот для записи в салон"));
    assert.ok(texts.includes("Это снова я"));
    assert.equal(again.body.session.userCount, 3);
    assert.equal(again.body.session.telegramUser.id, 777000);

    // the phone's old id now leads to the same conversation
    const viaOld = (await t.post("/api/smart/session", { sessionId: b.sessionId })).body;
    assert.equal(viaOld.sessionId, a.sessionId);
    const m = await t.post("/api/smart/message", { sessionId: b.sessionId, text: "Продолжим" });
    assert.equal(m.body.userCount, 4);
  } finally {
    await t.close();
  }
});

test("Telegram login is off without the bot token", async () => {
  const t = await start();
  try {
    const a = (await t.post("/api/smart/session", {})).body;
    const r = await t.post("/api/smart/telegram-auth", { sessionId: a.sessionId, auth: signedLogin(fields(), TOKEN) });
    assert.equal(r.status, 503);
  } finally {
    await t.close();
  }
});
