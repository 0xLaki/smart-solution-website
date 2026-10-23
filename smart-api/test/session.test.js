const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { start } = require("./helpers");

test("config without keys: scripted brain, no Telegram login", async () => {
  const t = await start();
  try {
    const r = await t.get("/api/smart/config");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ai: false, telegramBot: null, handoffMin: 35 });
  } finally {
    await t.close();
  }
});

test("config with keys", async () => {
  const t = await start({ GIGACHAT_AUTH_KEY: "a2V5", TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_BOT_USERNAME: "@smart_bot", SMART_HANDOFF_MIN: "12" });
  try {
    const r = await t.get("/api/smart/config");
    assert.deepEqual(r.body, { ai: true, telegramBot: "smart_bot", handoffMin: 12 });
  } finally {
    await t.close();
  }
});

test("a new session starts with the greeting and is saved", async () => {
  const t = await start();
  try {
    const r = await t.post("/api/smart/session", {});
    assert.equal(r.status, 200);
    const s = r.body;
    assert.match(s.sessionId, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].role, "bot");
    assert.match(s.messages[0].text, /Смарт/);
    assert.ok(!Number.isNaN(Date.parse(s.messages[0].at)));
    assert.equal(s.contact, null);
    assert.equal(s.telegramUser, null);
    assert.equal(s.userCount, 0);
    assert.equal(s.canHandoff, false);
    assert.equal(s.handedOff, false);
    assert.ok(s.quick.length > 0 && s.quick.length <= 3);
    assert.ok(fs.existsSync(path.join(t.dir, "sessions", s.sessionId + ".json")));
  } finally {
    await t.close();
  }
});

test("a session resumes with its messages; unknown or broken ids get a new one", async () => {
  const t = await start();
  try {
    const a = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/message", { sessionId: a.sessionId, text: "Нужен сайт для ресторана", via: "text" });
    const b = (await t.post("/api/smart/session", { sessionId: a.sessionId })).body;
    assert.equal(b.sessionId, a.sessionId);
    assert.equal(b.userCount, 1);
    assert.equal(b.messages.length, 3);
    assert.equal(b.messages[1].role, "user");
    assert.equal(b.messages[1].via, "text");

    const c = (await t.post("/api/smart/session", { sessionId: "AAAAAAAAAAAAAAAAAAAAAA" })).body;
    assert.notEqual(c.sessionId, a.sessionId);
    const d = (await t.post("/api/smart/session", { sessionId: "../../etc/passwd" })).body;
    assert.match(d.sessionId, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(d.userCount, 0);
  } finally {
    await t.close();
  }
});

test("a visitor back after a long pause is welcomed back once", async () => {
  let clock = Date.parse("2026-10-23T09:00:00Z");
  const t = await start({}, undefined, { now: () => clock });
  try {
    const a = (await t.post("/api/smart/session", {})).body;
    await t.post("/api/smart/message", { sessionId: a.sessionId, text: "Меня зовут Анна", via: "text" });
    clock += 2 * 24 * 3600e3;
    const b = (await t.post("/api/smart/session", { sessionId: a.sessionId })).body;
    assert.match(b.messages[b.messages.length - 1].text, /С возвращением, Анна/);
    const c = (await t.post("/api/smart/session", { sessionId: a.sessionId })).body;
    assert.equal(c.messages.length, b.messages.length);
  } finally {
    await t.close();
  }
});

test("bad requests: unknown route, wrong method, bad JSON, unknown session", async () => {
  const t = await start();
  try {
    assert.equal((await t.get("/api/smart/nope")).status, 404);
    assert.equal((await t.get("/api/smart/message")).status, 405);
    assert.equal((await t.post("/api/smart/session", "{oops")).status, 400);
    const r = await t.post("/api/smart/message", { sessionId: "AAAAAAAAAAAAAAAAAAAAAA", text: "привет" });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "no_session");
  } finally {
    await t.close();
  }
});
