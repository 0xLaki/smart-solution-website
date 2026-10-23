// The admin's data: leads from the session files, take / close / reopen, projects and their stages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { start } = require("./helpers");
const { NOW, adminEnv, H, loginTelegram } = require("./admin-helpers");

const A = "/api/smart/admin/";
const ID = (c) => c.repeat(22); // a valid session id made of one letter
const iso = (min) => new Date(NOW * 1000 + min * 60e3).toISOString();
const msg = (role, text, min, extra) => Object.assign({ role, text, at: iso(min) }, extra || {});

function writeSession(dir, s) {
  fs.writeFileSync(path.join(dir, "sessions", s.id + ".json"), JSON.stringify(s));
}

function base(id, min, extra) {
  return Object.assign(
    {
      id,
      createdAt: iso(min - 10),
      updatedAt: iso(min),
      messages: [msg("bot", "Здравствуйте! Я Смарт.", min - 10, { kind: "greeting" })],
      contact: null,
      telegramUser: null,
      brief: null,
      serviceGuess: "",
      handedOff: false,
    },
    extra || {}
  );
}

// six files: four leads in different states, one empty session, one merged stub
function seed(dir) {
  const long = "Нужен сайт для ресторана. ".repeat(20);
  const sessions = {
    fresh: base(ID("a"), -60, { messages: [msg("bot", "Привет", -70, { kind: "greeting" }), msg("user", "Хочу бота", -61, { via: "voice" }), msg("bot", "Расскажите", -60, { src: "script" })], serviceGuess: "ИИ-боты" }),
    contact: base(ID("b"), -30, { messages: [msg("user", "Первое", -35), msg("bot", "Ответ", -34), msg("user", long, -31)], contact: { name: "Анна", phone: "+7 999 123-45-67" } }),
    misha: base(ID("c"), -5, {
      messages: [msg("user", "Нужен лендинг", -9), msg("user", "Срок месяц", -6), msg("bot", "Передал Михаилу", -5, { kind: "handoff" })],
      contact: { name: "Олег", telegram: "@oleg_k" },
      brief: { service: "Лендинги", summary: "Лендинг для запуска", missing: ["бюджет"], at: iso(-5), userCount: 2 },
      serviceGuess: "Сайты",
      handedOff: true,
      handedOffAt: iso(-5),
    }),
    tg: base(ID("d"), -20, { messages: [msg("user", "Привет из Telegram", -21)], telegramUser: { id: 42, username: "ivan_tg", first_name: "Иван", last_name: "Петров" } }),
    empty: base(ID("e"), -1),
    stub: { id: ID("f"), createdAt: iso(-100), mergedInto: ID("d") },
  };
  for (const s of Object.values(sessions)) writeSession(dir, s);
  return sessions;
}

async function setup() {
  let clock = NOW * 1000;
  const lines = [];
  const t = await start(adminEnv(), undefined, { now: () => clock, log: (l) => lines.push(l) });
  const s = seed(t.dir);
  const cookie = await loginTelegram(t);
  const get = (p) => t.get(A + p, { Cookie: cookie });
  const post = (p, b) => t.post(A + p, b || {}, H(cookie));
  return { t, s, cookie, get, post, lines, tick: (ms) => (clock += ms) };
}

test("leads: sessions with a visitor message, newest first, with their status and brief", async () => {
  const { t, s, get, lines } = await setup();
  try {
    const r = await get("leads");
    assert.equal(r.status, 200);
    const leads = r.body.leads;
    assert.deepEqual(leads.map((l) => l.id), [s.misha.id, s.tg.id, s.contact.id, s.fresh.id]);
    const by = Object.fromEntries(leads.map((l) => [l.id, l]));

    assert.deepEqual(by[s.misha.id], {
      id: s.misha.id,
      name: "Олег",
      status: "misha",
      createdAt: iso(-15),
      updatedAt: iso(-5),
      userCount: 2,
      service: "Лендинги",
      summary: "Лендинг для запуска",
      missing: ["бюджет"],
      contact: { name: "Олег", telegram: "@oleg_k" },
      telegram: null,
      handedOff: true,
      handedOffAt: iso(-5),
      projectId: null,
      closedAt: null,
      lastText: "Срок месяц",
    });
    assert.equal(by[s.contact.id].status, "contact");
    assert.equal(by[s.contact.id].lastText.length, 200);
    assert.equal(by[s.contact.id].service, "");
    assert.deepEqual(by[s.contact.id].missing, []);
    assert.equal(by[s.tg.id].status, "contact"); // a Telegram login counts as a contact
    assert.equal(by[s.tg.id].name, "Иван");
    assert.deepEqual(by[s.tg.id].telegram, { username: "ivan_tg", first_name: "Иван" });
    assert.equal(by[s.fresh.id].status, "new");
    assert.equal(by[s.fresh.id].service, "ИИ-боты");
    assert.equal(by[s.fresh.id].name, "");
    assert.equal(by[s.fresh.id].contact, null);

    // the log has no lead ids
    await get("leads/" + s.misha.id);
    assert.ok(lines.some((l) => l.startsWith("GET /api/smart/admin/leads/:id 200")));
    assert.ok(!lines.some((l) => l.includes(s.misha.id)));
  } finally {
    await t.close();
  }
});

test("a lead in full: its messages; unknown, broken, empty and merged ids are 404", async () => {
  const { t, s, get } = await setup();
  try {
    const r = await get("leads/" + s.fresh.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.lead.status, "new");
    assert.deepEqual(r.body.lead.messages, [
      { role: "bot", text: "Привет", at: iso(-70), kind: "greeting" },
      { role: "user", text: "Хочу бота", at: iso(-61), via: "voice" },
      { role: "bot", text: "Расскажите", at: iso(-60) },
    ]);
    for (const id of [ID("z"), "short", "x".repeat(23), s.empty.id, s.stub.id, "..%2F..%2Fadmin"]) {
      const bad = await get("leads/" + id);
      assert.equal(bad.status, 404, id);
      assert.equal(bad.body.error, "no_lead");
    }
  } finally {
    await t.close();
  }
});

test("take makes a project once; close and reopen change the status", async () => {
  const { t, s, get, post, tick } = await setup();
  try {
    const team = (await get("projects")).body.team.map((m) => m.name);
    const pm = team.includes("Яна Арсеньева") ? "Яна Арсеньева" : team[0];

    const r = await post("leads/" + s.misha.id + "/take");
    assert.equal(r.status, 200);
    const p = r.body.project;
    assert.match(p.id, /^[A-Za-z0-9_-]{12}$/);
    assert.equal(p.name, "Лендинги – Олег");
    assert.equal(p.client, "Олег");
    assert.equal(p.service, "Лендинги");
    assert.equal(p.leadId, s.misha.id);
    assert.equal(p.stage, 0);
    assert.equal(p.pm, pm);
    assert.deepEqual(p.history, [{ at: new Date(NOW * 1000).toISOString(), by: "Яна Арсеньева", stage: 0 }]);

    const again = await post("leads/" + s.misha.id + "/take", { name: "Другое имя" });
    assert.equal(again.body.project.id, p.id);
    assert.equal(again.body.already, true);
    const lead = (await get("leads/" + s.misha.id)).body.lead;
    assert.equal(lead.status, "work");
    assert.equal(lead.projectId, p.id);

    // close / reopen: a lead with a contact goes back to «contact»
    tick(1000);
    const closed = await post("leads/" + s.contact.id + "/close");
    assert.equal(closed.status, 200);
    assert.equal(closed.body.lead.status, "closed");
    assert.equal(closed.body.lead.closedAt, new Date(NOW * 1000 + 1000).toISOString());
    assert.equal((await get("leads")).body.leads.find((l) => l.id === s.contact.id).status, "closed");
    const reopened = await post("leads/" + s.contact.id + "/reopen");
    assert.equal(reopened.body.lead.status, "contact");
    assert.equal(reopened.body.lead.closedAt, null);

    // a closed lead taken into work is open again; a name and a manager can be given
    await post("leads/" + s.fresh.id + "/close");
    const other = team.find((n) => n !== pm) || pm;
    const took = await post("leads/" + s.fresh.id + "/take", { name: "  Бот для салона \n", pm: other });
    assert.equal(took.body.project.name, "Бот для салона");
    assert.equal(took.body.project.pm, other);
    assert.equal(took.body.project.client, "");
    assert.equal((await get("leads/" + s.fresh.id)).body.lead.status, "work");

    // a lead with no name and no service gets a plain name
    const plain = (await post("leads/" + s.contact.id + "/take")).body.project;
    assert.equal(plain.name, "Анна");

    assert.equal((await post("leads/" + s.tg.id + "/take", { pm: "Кто-то" })).body.error, "bad_pm");
    assert.equal((await post("leads/" + ID("z") + "/take")).status, 404);
    assert.equal((await post("leads/" + s.stub.id + "/close")).status, 404);

    // admin.json holds it all
    const saved = JSON.parse(fs.readFileSync(path.join(t.dir, "admin.json"), "utf8"));
    assert.equal(saved.projects.length, 3);
    assert.equal(saved.leads[s.misha.id].projectId, p.id);
    assert.equal(saved.leads[s.contact.id].closedAt, undefined);
    assert.equal((await get("projects")).body.projects.length, 3);
  } finally {
    await t.close();
  }
});

test("projects: stages and team, create, update, stage clamp, manager and field checks", async () => {
  const { t, get, post, tick } = await setup();
  try {
    const list = await get("projects");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.stages, [
      { ver: "v0.1", title: "Созвон" },
      { ver: "v0.2", title: "Разбор" },
      { ver: "v0.3", title: "Прототип" },
      { ver: "v0.5", title: "Разработка" },
      { ver: "v1.0", title: "Первая версия" },
      { ver: "v1.x", title: "Запуск" },
      { ver: "", title: "Поддержка" },
    ]);
    assert.ok(list.body.team.length > 0);
    for (const m of list.body.team) assert.deepEqual(Object.keys(m), ["name", "role"]);
    assert.deepEqual(list.body.projects, []);
    const team = list.body.team.map((m) => m.name);
    const pm = team.includes("Яна Арсеньева") ? "Яна Арсеньева" : team[0];

    assert.deepEqual((await post("projects", {})).body, { ok: false, error: "no_name" });
    assert.equal((await post("projects", { name: "   " })).body.error, "no_name");
    assert.deepEqual((await post("projects", { name: "x".repeat(121) })).body, { ok: false, error: "too_long", field: "name", max: 120 });
    assert.deepEqual((await post("projects", { name: 5 })).body, { ok: false, error: "bad_field", field: "name" });
    assert.equal((await post("projects", { name: "Сайт", pm: "Незнакомец" })).body.error, "bad_pm");

    const made = await post("projects", { name: "Сайт ВЕДАЛ", client: "ВЕДАЛ", service: "Корпоративные сайты", next: "Созвон\nво вторник", due: "2026-12-01" });
    assert.equal(made.status, 200);
    const p = made.body.project;
    assert.deepEqual(
      { name: p.name, client: p.client, service: p.service, next: p.next, due: p.due, stage: p.stage, pm: p.pm, leadId: p.leadId },
      { name: "Сайт ВЕДАЛ", client: "ВЕДАЛ", service: "Корпоративные сайты", next: "Созвон во вторник", due: "2026-12-01", stage: 0, pm, leadId: null }
    );

    tick(60e3);
    const up = await post("projects/" + p.id, { stage: 3, next: "Прототип готов", pm: team[team.length - 1] });
    assert.equal(up.status, 200);
    assert.equal(up.body.project.stage, 3);
    assert.equal(up.body.project.next, "Прототип готов");
    assert.equal(up.body.project.pm, team[team.length - 1]);
    assert.equal(up.body.project.name, "Сайт ВЕДАЛ");
    assert.equal(up.body.project.updatedAt, new Date(NOW * 1000 + 60e3).toISOString());
    assert.deepEqual(up.body.project.history.map((h) => [h.stage, h.by]), [[0, "Яна Арсеньева"], [3, "Яна Арсеньева"]]);

    assert.equal((await post("projects/" + p.id, { stage: 99 })).body.project.stage, 6);
    assert.equal((await post("projects/" + p.id, { stage: "-5" })).body.project.stage, 0);
    assert.equal((await post("projects/" + p.id, { stage: 2.6 })).body.project.stage, 3);
    const same = await post("projects/" + p.id, { stage: 3, due: "" });
    assert.equal(same.body.project.history.length, 5); // the same stage again adds nothing
    assert.equal(same.body.project.due, "");
    assert.equal((await post("projects/" + p.id, { stage: "abc" })).body.error, "bad_stage");
    assert.equal((await post("projects/" + p.id, { stage: true })).body.error, "bad_stage");
    assert.equal((await post("projects/" + p.id, { pm: "Незнакомец" })).body.error, "bad_pm");
    assert.equal((await post("projects/" + p.id, { name: "" })).body.error, "no_name");
    assert.equal((await post("projects/" + p.id, { next: "x".repeat(301) })).body.error, "too_long");
    assert.equal((await post("projects/" + "A".repeat(12), { stage: 1 })).status, 404);
    assert.equal((await post("projects/" + "nope", { stage: 1 })).body.error, "no_project");

    // newest change first
    await post("projects", { name: "Второй" });
    tick(1000);
    await post("projects/" + p.id, { next: "Свежая правка" });
    assert.deepEqual((await get("projects")).body.projects.map((x) => x.name), ["Сайт ВЕДАЛ", "Второй"]);

    // nothing here works without the login
    assert.equal((await t.get(A + "projects")).status, 401);
    assert.equal((await t.post(A + "projects", { name: "x" }, { "X-Smart-Admin": "1" })).status, 401);
  } finally {
    await t.close();
  }
});
