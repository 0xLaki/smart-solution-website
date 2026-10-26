// HTTP API of the assistant «Смарт»: everything under /api/smart/, JSON in and out, same origin as the site.
//   GET  /api/smart/config          { ai, voice, telegramBot, handoffMin }
//   POST /api/smart/session         new or resumed conversation
//   POST /api/smart/message         the visitor's message → the bot's reply
//   POST /api/smart/voice           a voice recording (base64, up to 1 MB) → its text, written down by GigaChat
//   POST /api/smart/contact         name + phone / Telegram / e-mail
//   POST /api/smart/telegram-auth   Telegram Login Widget; resumes the same person's session on another device
//   POST /api/smart/handoff         the conversation goes to Misha in Telegram (after SMART_HANDOFF_MIN messages)
//   /api/smart/admin/*              the team's admin panel: leads and projects behind a login (admin.js)
// Logs carry no personal data: method, path, status, time and which brain answered (for voice, the size).
const { createStore } = require("./store");
const { loadCatalog } = require("./catalog");
const { createGigaChat } = require("./gigachat");
const { createAi } = require("./ai");
const { createTelegram, verifyLogin, formatCard, formatTranscript, formatForward } = require("./telegram");
const { scriptedReply, detectService } = require("./brain");
const { validateContact, sniffContact, hasContact, contactKinds, visitorName } = require("./contact");
const { GREETING, GREETING_QUICK } = require("./prompt");
const { HttpError, tooFast, createLimiter, cleanText, readBody, send } = require("./http");
const { createAdmin, isAdminPath, logPath } = require("./admin");

const MAX_TEXT = 1000;
const RETURN_GAP = 6 * 3600e3; // after this pause the visitor is welcomed back
const BRIEF_EVERY = 5; // a fresh brief for Misha every 5 visitor messages
const AI_DEADLINE = 35000; // longest wait for GigaChat's reply (queue included)
const EMPTY_TTL = 24 * 3600e3; // sessions where nobody wrote anything are removed after a day
const FULL_TEXT = "Мы уже очень подробно всё обсудили. Позовите Михаила кнопкой в чате: он получит весь разговор и продолжит сам.";

// Voice input for browsers whose own speech recognition fails (Yandex Browser and other Chromium forks):
// the page records with MediaRecorder and sends the recording here as base64 in JSON.
const MAX_AUDIO = 1024 * 1024; // decoded; a 30 s opus clip is 150–250 KB
const VOICE_BODY = 1536 * 1024; // the JSON around it: base64 is a third longer than the audio
const VOICE_PER_MIN = 8; // recordings a minute from one address
// MediaRecorder's mimeType (without «;codecs=…») → the file GigaChat gets, from its list of audio formats
const VOICE_FILES = {
  webm: { name: "voice.weba", mime: "audio/webm" },
  ogg: { name: "voice.ogg", mime: "audio/x-ogg" },
  mp4: { name: "voice.mp4", mime: "audio/mp4" },
  mpeg: { name: "voice.mp3", mime: "audio/mp3" },
  mp3: { name: "voice.mp3", mime: "audio/mp3" },
  wav: { name: "voice.wav", mime: "audio/wav" },
};

function voiceFile(type) {
  if (typeof type !== "string") return null;
  const m = /^audio\/([a-z0-9]+)$/.exec(type.split(";")[0].trim().toLowerCase());
  return m && Object.hasOwn(VOICE_FILES, m[1]) ? VOICE_FILES[m[1]] : null;
}

// plain base64 (no «data:» prefix) → bytes, or null when it is not base64
function decodeAudio(b64) {
  if (typeof b64 !== "string" || b64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return Buffer.from(b64, "base64");
}

const BODY_LIMITS = { "/api/smart/voice": VOICE_BODY };

const noSession = () => new HttpError(404, { ok: false, error: "no_session" });

function createApp({ config: cfg, fetch = globalThis.fetch, now = Date.now, log = (line) => console.log(line) }) {
  const store = createStore(cfg.dataDir);
  const catalog = loadCatalog(cfg.productsFile);
  const giga = cfg.gigachat.authKey ? createGigaChat(cfg.gigachat, { fetch, now, log }) : null;
  const ai = giga ? createAi({ giga, catalog }) : null;
  const tg = createTelegram(cfg.telegram, { fetch });
  const limits = createLimiter(now);
  const admin = createAdmin({ cfg, store, catalog, tg, limits, fetch, now, log });
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
    return [200, { ai: !!ai, voice: !!ai, telegramBot: tg.canLogin ? cfg.telegram.username : null, handoffMin: cfg.handoffMin }];
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

  // The recording is written down and forgotten: it is not stored, and GigaChat's copy is deleted right
  // after. sessionId is accepted but not needed; the text goes back to the page, which sends it as a message.
  async function voice(body, ip) {
    if (!ai) throw new HttpError(503, { ok: false, error: "voice_off" });
    const file = voiceFile(body.type);
    const audio = file ? decodeAudio(body.audio) : null;
    if (!audio || !audio.length) throw new HttpError(400, { ok: false, error: "bad_audio" });
    if (audio.length > MAX_AUDIO) throw new HttpError(413, { ok: false, error: "too_big" });
    const wait = limits.hit("voice:" + ip, VOICE_PER_MIN);
    if (wait) throw tooFast(wait);
    let text;
    try {
      text = await ai.transcribe(audio, file, MAX_TEXT);
    } catch (e) {
      log("voice: " + audio.length + " B not written down: " + e.message);
      throw new HttpError(502, { ok: false, error: "voice_failed" });
    }
    return [200, { ok: true, text }, audio.length + " B"];
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
    "POST /api/smart/voice": voice,
    "POST /api/smart/contact": contact,
    "POST /api/smart/telegram-auth": telegramAuth,
    "POST /api/smart/handoff": handoff,
  };

  async function handle(req, res) {
    const started = now();
    const path = (req.url || "/").split("?")[0];
    let status = 500;
    let tag = "";
    // admin paths carry lead ids (= visitors' session ids), so the log gets them as :id
    const shown = isAdminPath(path) ? logPath(path) : path;
    try {
      const ip = (typeof req.headers["x-real-ip"] === "string" && req.headers["x-real-ip"].trim()) || req.socket.remoteAddress || "?";
      let result;
      if (isAdminPath(path)) result = await admin.handle(req, path, ip);
      else {
        const route = ROUTES[req.method + " " + path];
        if (!route) {
          const known = Object.keys(ROUTES).some((k) => k.endsWith(" " + path));
          throw new HttpError(known ? 405 : 404, { ok: false, error: known ? "method" : "not_found" });
        }
        // 16 KB of JSON everywhere, except the voice route
        const body = req.method === "POST" ? await readBody(req, BODY_LIMITS[path]) : {};
        result = await route(body, ip);
      }
      const [st, out, t, headers] = result;
      status = st;
      tag = t || "";
      send(res, st, out, headers);
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        send(res, e.status, e.body, e.headers);
      } else {
        log("error on " + shown + ": " + e.message);
        send(res, 500, { ok: false, error: "server" });
      }
    } finally {
      if (path !== "/api/smart/health") log(req.method + " " + shown + " " + status + " " + (now() - started) + "ms" + (tag ? " " + tag : ""));
    }
  }

  // Housekeeping: rate-limit memory every minute, empty sessions every 6 hours (first run after a minute).
  function startTimers() {
    setInterval(() => {
      limits.prune();
      admin.prune();
    }, 60000).unref();
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

  return {
    handle,
    idle,
    startTimers,
    store,
    info: { ai: !!ai, model: ai ? cfg.gigachat.model : null, voiceModel: ai ? cfg.gigachat.voiceModel || cfg.gigachat.model : null, telegramLogin: tg.canLogin, telegramNotify: tg.canNotify, services: catalog.items.length, admin: admin.info },
  };
}

module.exports = { createApp, cleanText };
