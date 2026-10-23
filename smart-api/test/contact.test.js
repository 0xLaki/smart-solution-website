const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("./helpers");
const { validateContact, sniffContact } = require("../contact");

test("contact validation: phone, Telegram handle or link, e-mail", () => {
  assert.deepEqual(validateContact({ name: "Иван", phone: "+7 (999) 123-45-67" }), { name: "Иван", phone: "+7 (999) 123-45-67" });
  assert.deepEqual(validateContact({ phone: "123456" }), { phone: "123456" });
  assert.deepEqual(validateContact({ telegram: "@ivan_petrov" }), { telegram: "@ivan_petrov" });
  assert.deepEqual(validateContact({ telegram: "https://t.me/ivan_petrov" }), { telegram: "@ivan_petrov" });
  assert.deepEqual(validateContact({ telegram: "ivan_petrov" }), { telegram: "@ivan_petrov" });
  assert.deepEqual(validateContact({ telegram: "Ivan@Mail.ru" }), { email: "ivan@mail.ru" });
  // a phone typed into the Telegram box is still a phone
  assert.deepEqual(validateContact({ telegram: "8 999 123 45 67" }), { phone: "8 999 123 45 67" });
});

test("contact validation refuses what cannot reach anyone", () => {
  assert.equal(validateContact(null), null);
  assert.equal(validateContact({ name: "Иван" }), null);
  assert.equal(validateContact({ phone: "12345" }), null);
  assert.equal(validateContact({ phone: "позвоните мне" }), null);
  assert.equal(validateContact({ telegram: "@abc" }), null);
  assert.equal(validateContact({ telegram: "not a handle!" }), null);
  assert.equal(validateContact({ phone: "+7 999 123 45 67", telegram: "???" }), null);
  assert.equal(validateContact({ phone: { x: 1 } }), null);
});

test("contact details are picked out of chat messages", () => {
  assert.deepEqual(sniffContact("Меня зовут Анна, телефон +7 916 000-11-22", false), { phone: "+7 916 000-11-22", name: "Анна" });
  assert.deepEqual(sniffContact("пишите на anna@example.com", false), { email: "anna@example.com" });
  assert.deepEqual(sniffContact("Олег", true), { name: "Олег" });
  assert.deepEqual(sniffContact("8 999 123-45-67", false), { phone: "8 999 123-45-67" });
  // budgets and questions are not contacts or names
  assert.deepEqual(sniffContact("Бюджет 800 000 – 1 000 000 рублей", false), {});
  assert.deepEqual(sniffContact("Сколько стоит сайт?", true), {});
  assert.deepEqual(sniffContact("Привет", true), {});
});

test("POST /contact stores a valid contact and refuses an invalid one", async () => {
  const t = await start();
  try {
    const s = (await t.post("/api/smart/session", {})).body;
    const bad = await t.post("/api/smart/contact", { sessionId: s.sessionId, contact: { name: "Иван", phone: "12" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "invalid_contact");
    const ok = await t.post("/api/smart/contact", { sessionId: s.sessionId, contact: { name: "Иван", telegram: "@ivan_petrov" } });
    assert.deepEqual(ok.body, { ok: true });
    const back = (await t.post("/api/smart/session", { sessionId: s.sessionId })).body;
    assert.deepEqual(back.contact, { name: "Иван", telegram: "@ivan_petrov" });
    const r = await t.post("/api/smart/message", { sessionId: s.sessionId, text: "Нужен лендинг" });
    assert.equal(r.body.askContact, false);
    const none = await t.post("/api/smart/contact", { sessionId: "AAAAAAAAAAAAAAAAAAAAAA", contact: { phone: "+79991234567" } });
    assert.equal(none.status, 404);
  } finally {
    await t.close();
  }
});
