// The team's admin panel API: /api/smart/admin/*, JSON in and out, same origin as the site.
// A team member logs in with Telegram (Login Widget), Google (ID token) or an Ethereum wallet (Sign-In with
// Ethereum); each way checks its own allow-list from the environment. A signed cookie then opens the rest.
//   GET  config                                  which login ways are on (no login needed)
//   POST login/telegram · login/google · login/wallet,  GET login/wallet/nonce?address=0x…
//   POST logout · GET me
//   GET  leads · GET leads/:id · POST leads/:id/take · leads/:id/close · leads/:id/reopen
//   GET  projects · POST projects · POST projects/:id
// Without SMART_ADMIN_SECRET every admin path answers 503 admin_off.
// CSRF: the cookie is SameSite=Strict, every POST but the logins needs the header X-Smart-Admin: 1,
// and when SMART_SITE_ORIGIN is set an Origin header from anywhere else is refused.
const crypto = require("crypto");
const { HttpError, tooFast, cleanText, readBody } = require("./http");
const { verifyLogin } = require("./telegram");
const { hasContact } = require("./contact");
const { createGoogleVerifier } = require("./auth-google");
const { createWalletLogin, checksumAddress, ADDRESS } = require("./auth-wallet");
const { createAdminStore } = require("./admin-store");

const PREFIX = "/api/smart/admin/";
const COOKIE = "smart_admin";
const COOKIE_FLAGS = "; HttpOnly; Secure; SameSite=Strict; Path=/api/smart/admin";
const TTL = 12 * 3600; // seconds a login lasts
const MIN_SECRET = 32; // a shorter SMART_ADMIN_SECRET keeps the admin off
const TELEGRAM_MAX_AGE = 3600; // the widget signs fresh data at every press; older data is a replay

const STAGES = [
  { ver: "v0.1", title: "Созвон" },
  { ver: "v0.2", title: "Разбор" },
  { ver: "v0.3", title: "Прототип" },
  { ver: "v0.5", title: "Разработка" },
  { ver: "v1.0", title: "Первая версия" },
  { ver: "v1.x", title: "Запуск" },
  { ver: "", title: "Поддержка" },
];
const PM_DEFAULT = "Яна Арсеньева"; // she brings the projects in and holds the first call (by name: her role on the site changes)
const LIMITS = { name: 120, client: 120, service: 120, next: 300, due: 40 };
const MAX_PROJECTS = 2000;
const MAX_HISTORY = 100;
const PROJECT_ID = /^[A-Za-z0-9_-]{12}$/;

const isAdminPath = (p) => p === "/api/smart/admin" || p.startsWith(PREFIX);
// for the log: lead ids are visitors' session ids, so no id goes into it
const logPath = (p) => p.replace(/^(\/api\/smart\/admin\/(?:leads|projects)\/)[^/]+/, "$1:id");
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const fail = (status, error, extra) => new HttpError(status, Object.assign({ ok: false, error }, extra || {}));
const badAuth = () => fail(401, "bad_auth");
const notTeam = () => fail(403, "not_team");
const methodOff = () => fail(503, "method_off");
const noLead = () => fail(404, "no_lead");
const noProject = () => fail(404, "no_project");

function readCookie(header) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

function createAdmin({ cfg, store, catalog, tg, limits, fetch, now, log = () => {} }) {
  const A = cfg.admin;
  const on = A.secret.length >= MIN_SECRET;
  const methods = {
    telegram: !!(tg.canLogin && A.telegramIds.length),
    google: !!(A.googleClientId && A.emails.length),
    wallet: !!(A.siteOrigin && A.wallets.length),
  };
  const google = on && methods.google ? createGoogleVerifier({ clientId: A.googleClientId, fetch, now }) : null;
  const wallet = on && methods.wallet ? createWalletLogin({ origin: A.siteOrigin, now }) : null;
  const data = createAdminStore(cfg.dataDir, store.lock);
  const team = catalog.team || [];
  const teamNames = team.map((t) => t.name);
  const defaultPm = teamNames.includes(PM_DEFAULT) ? PM_DEFAULT : teamNames[0] || "";
  const iso = () => new Date(now()).toISOString();

  // ---------- the login cookie: <base64url payload>.<base64url HMAC-SHA256> ----------
  const mac = (p) => crypto.createHmac("sha256", A.secret).update(p).digest("base64url");
  const clearCookie = COOKIE + "=" + COOKIE_FLAGS + "; Max-Age=0";

  function signIn(sub, name, via) {
    const p = Buffer.from(JSON.stringify({ sub, name, via, exp: Math.floor(now() / 1000) + TTL })).toString("base64url");
    const cookie = COOKIE + "=" + p + "." + mac(p) + COOKIE_FLAGS + "; Max-Age=" + TTL;
    return [200, { ok: true, user: { name, via } }, via, { "Set-Cookie": cookie }];
  }

  // The allow-lists are read on every request: taking someone off the list logs them out at once.
  const VIA = { tg: "telegram", google: "google", wallet: "wallet" };
  function allowed(sub) {
    const i = typeof sub === "string" ? sub.indexOf(":") : -1;
    if (i < 0) return null;
    const kind = sub.slice(0, i);
    const v = sub.slice(i + 1);
    const ok =
      (kind === "tg" && methods.telegram && A.telegramIds.includes(v)) ||
      (kind === "google" && methods.google && A.emails.includes(v)) ||
      (kind === "wallet" && methods.wallet && A.wallets.includes(v));
    return ok ? VIA[kind] : null;
  }

  function userFrom(token) {
    if (!token || token.length > 2048) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const want = Buffer.from(mac(parts[0]));
    const got = Buffer.from(parts[1]);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    let u;
    try {
      u = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (!u || typeof u.exp !== "number" || u.exp <= now() / 1000) return null;
    const via = allowed(u.sub);
    if (!via || u.via !== via) return null;
    return { sub: u.sub, name: typeof u.name === "string" ? u.name : "", via };
  }

  function currentUser(req) {
    const raw = readCookie(req.headers.cookie);
    const u = raw ? userFrom(raw) : null;
    if (u) return u;
    // a dead cookie (changed, expired, its owner taken off the list) is removed from the browser
    throw new HttpError(401, { ok: false, error: "no_login" }, raw ? { "Set-Cookie": clearCookie } : null);
  }

  // ---------- login ----------
  async function config() {
    return [
      200,
      {
        ok: true,
        telegramBot: methods.telegram ? cfg.telegram.username : null,
        googleClientId: methods.google ? A.googleClientId : null,
        wallet: methods.wallet,
        siteOrigin: A.siteOrigin || null,
      },
    ];
  }

  async function loginTelegram({ body }) {
    if (!methods.telegram) throw methodOff();
    const u = verifyLogin(body.auth, cfg.telegram.token, Math.floor(now() / 1000), TELEGRAM_MAX_AGE);
    if (!u) throw badAuth();
    if (!A.telegramIds.includes(String(u.id))) throw notTeam();
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? "@" + u.username : "Telegram");
    return signIn("tg:" + u.id, name, "telegram");
  }

  async function loginGoogle({ body }) {
    if (!methods.google) throw methodOff();
    let who;
    try {
      who = await google.verify(body.credential);
    } catch (e) {
      log("admin: Google keys failed: " + e.message);
      throw fail(502, "google_failed");
    }
    if (!who) throw badAuth();
    if (!A.emails.includes(who.email)) throw notTeam();
    return signIn("google:" + who.email, who.name || who.email, "google");
  }

  async function walletNonce({ req }) {
    if (!methods.wallet) throw methodOff();
    const address = new URL(req.url, "http://local").searchParams.get("address") || "";
    if (!ADDRESS.test(address)) throw fail(400, "bad_address");
    const out = wallet.issue(address);
    if (!out) throw tooFast(60);
    return [200, { ok: true, message: out.message, nonce: out.nonce }];
  }

  async function loginWallet({ body }) {
    if (!methods.wallet) throw methodOff();
    const signer = wallet.verify(body.message, body.signature);
    if (!signer) throw badAuth();
    if (!A.wallets.includes(signer)) throw notTeam();
    const c = checksumAddress(signer);
    return signIn("wallet:" + signer, c.slice(0, 6) + "…" + c.slice(-4), "wallet");
  }

  async function logout() {
    return [200, { ok: true }, "", { "Set-Cookie": clearCookie }];
  }

  async function me({ user }) {
    return [200, { ok: true, user: { name: user.name, via: user.via } }];
  }

  // ---------- leads: the assistant's conversations ----------
  const userMessages = (s) => (Array.isArray(s.messages) ? s.messages.filter((m) => m && m.role === "user") : []);
  const isLead = (s) => !s.mergedInto && userMessages(s).length > 0;

  function leadOf(s, d) {
    const a = d.leads[s.id] || {};
    const project = a.projectId ? d.projects.find((p) => p.id === a.projectId) : null;
    const users = userMessages(s);
    const last = users[users.length - 1];
    const u = s.telegramUser;
    const b = s.brief || {};
    return {
      id: s.id,
      name: (s.contact && s.contact.name) || (u && u.first_name) || "",
      status: a.closedAt ? "closed" : project ? "work" : s.handedOff ? "misha" : hasContact(s) ? "contact" : "new",
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || s.createdAt || null,
      userCount: users.length,
      service: b.service || s.serviceGuess || "",
      summary: b.summary || "",
      missing: Array.isArray(b.missing) ? b.missing : [],
      contact: s.contact || null,
      telegram: u ? { username: u.username || "", first_name: u.first_name || "" } : null,
      handedOff: !!s.handedOff,
      handedOffAt: s.handedOffAt || null,
      projectId: project ? project.id : null,
      closedAt: a.closedAt || null,
      lastText: last && typeof last.text === "string" ? last.text.slice(0, 200) : "",
    };
  }

  async function leadSession(id) {
    const s = store.validId(id) ? await store.load(id) : null;
    if (!s || !isLead(s)) throw noLead();
    return s;
  }

  async function leads() {
    const [all, d] = await Promise.all([store.all(), data.read()]);
    const out = all
      .filter(isLead)
      .map((s) => leadOf(s, d))
      .sort((x, y) => (Date.parse(y.updatedAt) || 0) - (Date.parse(x.updatedAt) || 0));
    return [200, { ok: true, leads: out }];
  }

  async function lead({ params }) {
    const s = await leadSession(params.id);
    const out = leadOf(s, await data.read());
    out.messages = s.messages.map((m) => ({ role: m.role, text: m.text, at: m.at, via: m.via, kind: m.kind }));
    return [200, { ok: true, lead: out }];
  }

  async function take({ params, body, user }) {
    const s = await leadSession(params.id);
    const named = textField(body, "name");
    const pm = pmField(body);
    return data.change((d) => {
      const a = d.leads[s.id] || (d.leads[s.id] = {});
      const existing = a.projectId && d.projects.find((p) => p.id === a.projectId);
      if (existing) return [200, { ok: true, project: existing, already: true }];
      if (d.projects.length >= MAX_PROJECTS) throw fail(409, "too_many");
      const l = leadOf(s, d);
      const name = named || [l.service, l.name].filter(Boolean).join(" – ").slice(0, LIMITS.name) || "Заявка " + s.id.slice(0, 6);
      const p = newProject({ name, client: l.name.slice(0, LIMITS.client), service: l.service.slice(0, LIMITS.service), pm: pm || defaultPm }, s.id, user);
      d.projects.push(p);
      a.projectId = p.id;
      delete a.closedAt; // taking a closed lead into work opens it again
      return [200, { ok: true, project: p }, "take"];
    });
  }

  function setClosed(closed) {
    return async ({ params }) => {
      const s = await leadSession(params.id);
      return data.change((d) => {
        const a = d.leads[s.id] || (d.leads[s.id] = {});
        if (closed) a.closedAt = a.closedAt || iso();
        else delete a.closedAt;
        if (!Object.keys(a).length) delete d.leads[s.id];
        return [200, { ok: true, lead: leadOf(s, d) }];
      });
    };
  }

  // ---------- projects ----------
  // One line of text from the body: undefined when the key is absent, 400 when it is not text or too long.
  function textField(body, key) {
    if (!has(body, key) || body[key] === undefined) return undefined;
    const v = body[key];
    if (v === null) return "";
    if (typeof v !== "string") throw fail(400, "bad_field", { field: key });
    const s = cleanText(v).replace(/\s*\n\s*/g, " ");
    if (s.length > LIMITS[key]) throw fail(400, "too_long", { field: key, max: LIMITS[key] });
    return s;
  }

  // A project's manager is someone from the team page; empty = leave as it is (or the default).
  function pmField(body) {
    if (!has(body, "pm") || body.pm == null || body.pm === "") return undefined;
    const v = typeof body.pm === "string" ? body.pm.trim() : "";
    if (!teamNames.includes(v)) throw fail(400, "bad_pm");
    return v;
  }

  // 0..6, an index into STAGES; out-of-range numbers are clamped
  function stageField(body) {
    if (!has(body, "stage") || body.stage == null) return undefined;
    const raw = body.stage;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(n)) throw fail(400, "bad_stage");
    return Math.min(STAGES.length - 1, Math.max(0, Math.round(n)));
  }

  function newProject(f, leadId, user) {
    const at = iso();
    return {
      id: crypto.randomBytes(9).toString("base64url"),
      name: f.name,
      client: f.client || "",
      leadId: leadId || null,
      service: f.service || "",
      stage: 0,
      pm: f.pm || "",
      next: f.next || "",
      due: f.due || "",
      createdAt: at,
      updatedAt: at,
      history: [{ at, by: user.name, stage: 0 }],
    };
  }

  async function projects() {
    const d = await data.read();
    const list = d.projects.slice().sort((x, y) => (Date.parse(y.updatedAt) || 0) - (Date.parse(x.updatedAt) || 0));
    return [200, { ok: true, stages: STAGES, team, projects: list }];
  }

  async function createProject({ body, user }) {
    const name = textField(body, "name");
    if (!name) throw fail(400, "no_name");
    const f = { name, pm: pmField(body) || defaultPm };
    for (const k of ["client", "service", "next", "due"]) f[k] = textField(body, k) || "";
    return data.change((d) => {
      if (d.projects.length >= MAX_PROJECTS) throw fail(409, "too_many");
      const p = newProject(f, null, user);
      d.projects.push(p);
      return [200, { ok: true, project: p }];
    });
  }

  async function updateProject({ params, body, user }) {
    if (!PROJECT_ID.test(params.id)) throw noProject();
    const patch = {};
    for (const k of ["name", "client", "service", "next", "due"]) {
      const v = textField(body, k);
      if (v !== undefined) patch[k] = v;
    }
    if (patch.name === "") throw fail(400, "no_name");
    const pm = pmField(body);
    if (pm !== undefined) patch.pm = pm;
    const stage = stageField(body);
    return data.change((d) => {
      const p = d.projects.find((x) => x.id === params.id);
      if (!p) throw noProject();
      Object.assign(p, patch);
      if (stage !== undefined && stage !== p.stage) {
        p.stage = stage;
        p.history = (Array.isArray(p.history) ? p.history : []).concat({ at: iso(), by: user.name, stage }).slice(-MAX_HISTORY);
      }
      p.updatedAt = iso();
      return [200, { ok: true, project: p }];
    });
  }

  // ---------- routing ----------
  // kind: "open" = no login, "login" = a login step (rate-limited, no X-Smart-Admin), "user" = the cookie is needed
  const ROUTES = [
    ["GET", "config", config, "open"],
    ["POST", "login/telegram", loginTelegram, "login"],
    ["POST", "login/google", loginGoogle, "login"],
    ["GET", "login/wallet/nonce", walletNonce, "login"],
    ["POST", "login/wallet", loginWallet, "login"],
    ["POST", "logout", logout, "open"],
    ["GET", "me", me, "user"],
    ["GET", "leads", leads, "user"],
    ["GET", "leads/:id", lead, "user"],
    ["POST", "leads/:id/take", take, "user"],
    ["POST", "leads/:id/close", setClosed(true), "user"],
    ["POST", "leads/:id/reopen", setClosed(false), "user"],
    ["GET", "projects", projects, "user"],
    ["POST", "projects", createProject, "user"],
    ["POST", "projects/:id", updateProject, "user"],
  ].map(([method, pattern, fn, kind]) => ({ method, parts: pattern.split("/"), fn, kind }));

  function match(method, segs) {
    let otherMethod = false;
    for (const r of ROUTES) {
      if (r.parts.length !== segs.length) continue;
      const params = {};
      const fits = r.parts.every((x, i) => {
        if (!x.startsWith(":")) return x === segs[i];
        params[x.slice(1)] = segs[i];
        return segs[i].length > 0 && segs[i].length <= 64;
      });
      if (!fits) continue;
      if (r.method === method) return { r, params };
      otherMethod = true;
    }
    return otherMethod ? "method" : null;
  }

  async function handle(req, path, ip) {
    if (!on) throw fail(503, "admin_off");
    const sub = path.length > PREFIX.length ? path.slice(PREFIX.length).replace(/\/+$/, "") : "";
    const found = match(req.method, sub ? sub.split("/") : []);
    if (!found) throw fail(404, "not_found");
    if (found === "method") throw fail(405, "method");
    const { r, params } = found;
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (A.siteOrigin && origin !== undefined && origin !== A.siteOrigin) throw fail(403, "bad_origin");
      if (r.kind !== "login" && req.headers["x-smart-admin"] !== "1") throw fail(403, "csrf");
    }
    if (r.kind === "login") {
      const wait = limits.hit((req.method === "GET" ? "admin-nonce:" : "admin-login:") + ip, A.loginPerMin);
      if (wait) throw tooFast(wait);
    }
    const user = r.kind === "user" ? currentUser(req) : null;
    const body = req.method === "POST" ? await readBody(req) : {};
    return r.fn({ req, body, params, user });
  }

  function prune() {
    if (wallet) wallet.prune();
  }

  const info = { on, shortSecret: !!A.secret && !on, methods: Object.keys(methods).filter((k) => methods[k]) };
  return { handle, prune, info };
}

module.exports = { createAdmin, isAdminPath, logPath, STAGES };
