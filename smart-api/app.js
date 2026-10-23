// HTTP API of the assistant «Смарт»: everything under /api/smart/, JSON in and out, same origin as the site.
//   GET  /api/smart/config          { ai, telegramBot, handoffMin }
//   POST /api/smart/session         new or resumed conversation
//   POST /api/smart/message         the visitor's message → the bot's reply
//   POST /api/smart/contact         name + phone / Telegram / e-mail
//   POST /api/smart/telegram-auth   Telegram Login Widget; resumes the same person's session on another device
//   POST /api/smart/handoff         the conversation goes to Misha in Telegram (after SMART_HANDOFF_MIN messages)
// Logs carry no personal data: method, path, status, time and which brain answered.
const { createStore } = require("./store");
const { loadCatalog } = require("./catalog");
const { createGigaChat } = require("./gigachat");
const { createAi } = require("./ai");
const { createTelegram, verifyLogin, formatCard, formatTranscript, formatForward } = require("./telegram");
const { scriptedReply, detectService } = require("./brain");
const { validateContact, sniffContact, hasContact, contactKinds, visitorName } = require("./contact");
const { GREETING, GREETING_QUICK } = require("./prompt");

const MAX_TEXT = 1000;
const MAX_BODY = 16 * 1024;
const RETURN_GAP = 6 * 3600e3; // after this pause the visitor is welcomed back
const BRIEF_EVERY = 5; // a fresh brief for Misha every 5 visitor messages
const AI_DEADLINE = 35000; // longest wait for GigaChat's reply (queue included)
const EMPTY_TTL = 24 * 3600e3; // sessions where nobody wrote anything are removed after a day
const FULL_TEXT = "Мы уже очень подробно всё обсудили. Позовите Михаила кнопкой в чате: он получит весь разговор и продолжит сам.";

class HttpError extends Error {
  constructor(status, body) {
    super(body.error || String(status));
    this.status = status;
    this.body = body;
  }
}
const noSession = () => new HttpError(404, { ok: false, error: "no_session" });
const tooFast = (sec) => new HttpError(429, { ok: false, error: "rate", retryIn: sec });

// Sliding one-minute windows in memory.
function createLimiter(now) {
  const hits = new Map();
  function hit(key, limit, windowMs = 60000) {
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000));
    }
    arr.push(t);
    hits.set(key, arr);
    return 0;
  }
  function prune() {
    const t = now();
    for (const [k, arr] of hits) if (!arr.length || t - arr[arr.length - 1] > 60000) hits.delete(k);
  }
  return { hit, prune };
}

function cleanText(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) over = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (over) return reject(new HttpError(413, { ok: false, error: "too_big" }));
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        const j = JSON.parse(raw);
        resolve(j && typeof j === "object" && !Array.isArray(j) ? j : {});
      } catch {
        reject(new HttpError(400, { ok: false, error: "bad_json" }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  });
  res.end(body);
}

function createApp({ config: cfg, fetch = globalThis.fetch, now = Date.now, log = (line) => console.log(line) }) {
  const store = createStore(cfg.dataDir);
  const catalog = loadCatalog(cfg.productsFile);
  const giga = cfg.gigachat.authKey ? createGigaChat(cfg.gigachat, { fetch, now }) : null;
  const ai = giga ? createAi({ giga, catalog }) : null;
  const tg = createTelegram(cfg.telegram, { fetch });
  const limits = createLimiter(now);
  const pending = new Set();
  const iso = () => new Date(now()).toISOString();

  // Work after the answer is sent (the brief, forwards to Misha). Failures are only logged.
  function background(fn) {
    const p = Promise.resolve()
      .then(fn)
      .catch((e) => log("background: " + e.message));
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  function state(s) {
    const userCount = s.messages.filter((m) => m.role === "user").length;
    const contact = hasContact(s);
    return { userCount, hasContact: contact, canHandoff: !s.handedOff && contact && userCount >= cfg.handoffMin };
  }

  function view(s) {
    const st = state(s);
    const u = s.telegramUser;
    return {
      sessionId: s.id,
      messages: s.messages.map((m) => {
        const o = { role: m.role, text: m.text, at: m.at };
        if (m.via) o.via = m.via;
        return o;
      }),
      contact: s.contact || null,
      telegramUser: u ? publicUser(u) : null,
      userCount: st.userCount,
      canHandoff: st.canHandoff,
      handedOff: !!s.handedOff,
    };
  }

  function publicUser(u) {
    const o = { id: u.id };
    if (u.username) o.username = u.username;
    if (u.first_name) o.first_name = u.first_name;
    return o;
  }

  const serviceOf = (s) => (s.brief && s.brief.service) || s.serviceGuess || "";

  function newSession() {
    const at = iso();
    return {
      id: store.newId(),
      createdAt: at,
      updatedAt: at,
      messages: [{ role: "bot", text: GREETING, at, kind: "greeting" }],
      contact: null,
      telegramUser: null,
      brief: null,
      serviceGuess: "",
      script: { step: 0, deep: 0, contactAskedAt: 0 },
      handedOff: false,
    };
  }

  async function refreshBrief(id) {
    const snap = await store.peek(id);
    if (!snap) return;
    const brief = await ai.extract(snap);
    if (!brief) return log("brief: the model's answer was not usable JSON");
    await store.withSession(id, async (s) => {
      if (!s) return;
      s.brief = Object.assign(brief, { at: iso(), userCount: state(s).userCount });
      await store.save(s);
    });
  }

  // ---------- routes ----------
  async function config() {
    return [200, { ai: !!ai, telegramBot: tg.canLogin ? cfg.telegram.username : null, handoffMin: cfg.handoffMin }];
  }

  async function session(body, ip) {
    if (store.validId(body.sessionId)) {
      const out = await store.withSession(body.sessionId, async (s) => {
        if (!s) return null;
        const last = s.messages[s.messages.length - 1];
        if (state(s).userCount > 0 && last && last.kind !== "welcome" && now() - Date.parse(last.at) > RETURN_GAP) {
          const name = visitorName(s);
          s.messages.push({ role: "bot", text: "С возвращением" + (name ? ", " + name : "") + "! Продолжим с того места, где остановились?", at: iso(), kind: "welcome" });
          await store.save(s);
        }
        return [200, Object.assign(view(s), { quick: [] }), "resume"];
      });
      if (out) return out;
    }
    const wait = limits.hit("new:" + ip, 30);
    if (wait) throw tooFast(wait);
    const s = newSession();
    await store.save(s);
    return [200, Object.assign(view(s), { quick: GREETING_QUICK }), "new"];
  }

  async function message(body, ip) {
    const text = cleanText(body.text);
    if (!text) throw new HttpError(400, { ok: false, error: "empty" });
    if (text.length > MAX_TEXT) throw new HttpError(400, { ok: false, error: "too_long", max: MAX_TEXT });
    const via = body.via === "voice" ? "voice" : "text";
    if (!store.validId(body.sessionId)) throw noSession();
    let wait = limits.hit("ip:" + ip, cfg.ratePerMin);
    if (wait) throw tooFast(wait);

    return store.withSession(body.sessionId, async (s) => {
      if (!s) throw noSession();
      wait = limits.hit("s:" + s.id, cfg.ratePerMin);
      if (wait) throw tooFast(wait);
      const reply0 = (st, text, quick, tag) => {
        const out = { reply: { text, quick }, askContact: !st.hasContact, userCount: st.userCount, canHandoff: st.canHandoff };
        if (serviceOf(s)) out.service = serviceOf(s);
        return [200, out, tag];
      };
      if (s.messages.length >= cfg.maxMessages) return reply0(state(s), FULL_TEXT, [], "full");

      const prev = s.messages[s.messages.length - 1];
      const lastUser = s.messages.filter((m) => m.role === "user").pop();
      const returning = !!lastUser && now() - Date.parse(lastUser.at) > RETURN_GAP && !(prev && prev.kind === "welcome");
      s.messages.push({ role: "user", text, at: iso(), via });

      // contact details typed into the chat count as the contact
      const askedName = !!prev && prev.role === "bot" && /как вас зовут/i.test(prev.text);
      const found = sniffContact(text, askedName);
      const c = Object.assign({}, s.contact || {});
      let gotContact = false;
      for (const k of ["phone", "telegram", "email", "name"]) {
        if (!found[k] || c[k] === found[k] || (k === "name" && c.name)) continue;
        c[k] = found[k];
        gotContact = true;
      }
      if (gotContact) s.contact = c;
      // a product named once is not replaced by a group («ИИ-боты» stays when «у нас есть сайт» comes later)
      const guess = detectService(text, catalog);
      const generic = (n) => catalog.groups.some((g) => g.name === n);
      if (guess && !(generic(guess) && s.serviceGuess && !generic(s.serviceGuess))) s.serviceGuess = guess;

      const st = state(s);
      let reply = null;
      let src = "script";
      if (ai) {
        let timer = null;
        try {
          const job = ai.reply(s, {
            name: visitorName(s),
            contactKinds: contactKinds(s),
            telegramLogin: tg.canLogin,
            userCount: st.userCount,
            handoffMin: cfg.handoffMin,
            canHandoff: st.canHandoff,
            handedOff: !!s.handedOff,
            brief: s.brief,
            returning,
            voice: via === "voice",
          });
          job.catch(() => {});
          // the site waits 45 s at most: past AI_DEADLINE the scripted brain answers instead
          const late = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("no answer in " + AI_DEADLINE / 1000 + " s")), AI_DEADLINE);
          });
          reply = await Promise.race([job, late]);
          if (reply) src = "ai";
        } catch (e) {
          log("gigachat reply failed: " + e.message);
        } finally {
          clearTimeout(timer);
        }
      }
      if (!reply) reply = scriptedReply(s, text, { hasContact: st.hasContact, gotContact, name: visitorName(s), userCount: st.userCount, canHandoff: st.canHandoff });
      s.messages.push({ role: "bot", text: reply.text, at: iso(), src });
      await store.save(s);

      if (ai && st.userCount % BRIEF_EVERY === 0) background(() => refreshBrief(s.id));
      if (s.handedOff && tg.canNotify) {
        const fwd = formatForward(s, text, reply.text);
        background(() => tg.sendMessage(fwd));
      }
      return reply0(st, reply.text, reply.quick || [], src);
    });
  }

  async function contact(body, ip) {
    const wait = limits.hit("misc:" + ip, 30);
    if (wait) throw tooFast(wait);
    const c = validateContact(body.contact);
    if (!c) throw new HttpError(400, { ok: false, error: "invalid_contact" });
    return store.withSession(body.sessionId, async (s) => {
      if (!s) throw noSession();
      s.contact = Object.assign({}, s.contact || {}, c);
      await store.save(s);
      return [200, { ok: true }];
    });
  }

  // The same person's latest session (another device, another day) takes this one in.
  function mergeInto(p, h, user) {
    const extra = h.messages.filter((m) => m.kind !== "greeting");
    p.messages = p.messages.concat(extra).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (p.messages.length > cfg.maxMessages) p.messages = p.messages.slice(-cfg.maxMessages);
    if (h.contact) p.contact = Object.assign({}, p.contact || {}, h.contact);
    p.telegramUser = user;
    if (h.serviceGuess && !p.serviceGuess) p.serviceGuess = h.serviceGuess;
    if (h.handedOff && !p.handedOff) {
      p.handedOff = true;
      p.handedOffAt = h.handedOffAt;
    }
  }

  async function telegramAuth(body, ip) {
    const wait = limits.hit("misc:" + ip, 30);
    if (wait) throw tooFast(wait);
    if (!tg.canLogin) throw new HttpError(503, { ok: false, error: "telegram_off" });
    const user = verifyLogin(body.auth, cfg.telegram.token, Math.floor(now() / 1000));
    if (!user) throw new HttpError(401, { ok: false, error: "bad_auth" });
    if (!store.validId(body.sessionId)) throw noSession();

    return store.lock("telegram-auth", async () => {
      const here = await store.withSession(body.sessionId, async (s) => {
        if (!s) return null;
        s.telegramUser = user;
        await store.save(s);
        return s.id;
      });
      if (!here) throw noSession();
      let final = here;
      const prevId = await store.telegramGet(user.id);
      if (prevId && prevId !== here) {
        const merged = await store.withSession(prevId, async (p) => {
          if (!p || p.id === here) return null;
          return store.withSession(here, async (h) => {
            if (!h) return null;
            mergeInto(p, h, user);
            await store.save(p);
            await store.save({ id: h.id, createdAt: h.createdAt, mergedInto: p.id });
            return p.id;
          });
        });
        if (merged) final = merged;
      }
      await store.telegramSet(user.id, final);
      const v = await store.withSession(final, async (s) => (s ? view(s) : null));
      return [200, { ok: true, user: publicUser(user), sessionId: final, session: v }, final === here ? "" : "merged"];
    });
  }

  async function handoff(body, ip) {
    const wait = limits.hit("misc:" + ip, 30);
    if (wait) throw tooFast(wait);
    return store.withSession(body.sessionId, async (s) => {
      if (!s) throw noSession();
      if (s.handedOff) return [200, { ok: true, already: true }];
      const st = state(s);
      const need = Math.max(0, cfg.handoffMin - st.userCount);
      if (need > 0 || !st.hasContact) return [409, { ok: false, need, needContact: !st.hasContact }];
      if (!tg.canNotify) throw new HttpError(503, { ok: false, error: "telegram_off" });

      if (ai) {
        try {
          const b = await ai.extract(s);
          if (b) s.brief = Object.assign(b, { at: iso(), userCount: st.userCount });
        } catch (e) {
          log("brief before the hand-off failed: " + e.message);
        }
      }
      const service = serviceOf(s);
      try {
        await tg.sendMessage(formatCard(s, s.brief, service, st.userCount));
      } catch (e) {
        log("hand-off card failed: " + e.message);
        throw new HttpError(502, { ok: false, error: "telegram_failed" });
      }
      try {
        const name = "smart-" + iso().slice(0, 10) + "-" + s.id.slice(0, 6) + ".txt";
        await tg.sendDocument(name, formatTranscript(s, service), "Весь разговор со Смартом");
      } catch (e) {
        log("hand-off transcript failed: " + e.message);
        s.transcriptFailed = true;
      }
      s.handedOff = true;
      s.handedOffAt = iso();
      const c = s.contact || {};
      const how = c.telegram || (s.telegramUser && s.telegramUser.username) ? "Он напишет вам в Telegram." : c.phone ? "Он свяжется с вами по телефону." : c.email ? "Он напишет вам на почту." : "Он свяжется с вами сам.";
      const text = "Передал наш разговор Михаилу. " + how + " А я пока на связи: если вспомните что-то ещё, пишите, Михаил это тоже увидит.";
      s.messages.push({ role: "bot", text, at: iso(), kind: "handoff" });
      await store.save(s);
      return [200, { ok: true, reply: { text } }];
    });
  }

  const ROUTES = {
    "GET /api/smart/config": config,
    "GET /api/smart/health": async () => [200, { ok: true }],
    "POST /api/smart/session": session,
    "POST /api/smart/message": message,
    "POST /api/smart/contact": contact,
    "POST /api/smart/telegram-auth": telegramAuth,
    "POST /api/smart/handoff": handoff,
  };

  async function handle(req, res) {
    const started = now();
    const path = (req.url || "/").split("?")[0];
    let status = 500;
    let tag = "";
    try {
      const route = ROUTES[req.method + " " + path];
      if (!route) {
        const known = Object.keys(ROUTES).some((k) => k.endsWith(" " + path));
        throw new HttpError(known ? 405 : 404, { ok: false, error: known ? "method" : "not_found" });
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      const ip = (typeof req.headers["x-real-ip"] === "string" && req.headers["x-real-ip"].trim()) || req.socket.remoteAddress || "?";
      const [st, out, t] = await route(body, ip);
      status = st;
      tag = t || "";
      send(res, st, out);
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        send(res, e.status, e.body);
      } else {
        log("error on " + path + ": " + e.message);
        send(res, 500, { ok: false, error: "server" });
      }
    } finally {
      if (path !== "/api/smart/health") log(req.method + " " + path + " " + status + " " + (now() - started) + "ms" + (tag ? " " + tag : ""));
    }
  }

  // Housekeeping: rate-limit memory every minute, empty sessions every 6 hours (first run after a minute).
  function startTimers() {
    setInterval(limits.prune, 60000).unref();
    const sweep = () =>
      store
        .sweep(EMPTY_TTL)
        .then((n) => n && log("sweep: removed " + n + " empty sessions"))
        .catch((e) => log("sweep: " + e.message));
    setTimeout(sweep, 60000).unref();
    setInterval(sweep, 6 * 3600e3).unref();
  }

  // Resolves when the work started after answers (briefs, forwards) is done.
  async function idle() {
    while (pending.size) await Promise.allSettled([...pending]);
  }

  return { handle, idle, startTimers, store, info: { ai: !!ai, model: ai ? cfg.gigachat.model : null, telegramLogin: tg.canLogin, telegramNotify: tg.canNotify, services: catalog.items.length } };
}

module.exports = { createApp, cleanText };
