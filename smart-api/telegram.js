// Telegram: checking the Login Widget data (core.telegram.org/widgets/login#checking-authorization)
// and sending the hand-off to Misha through the Bot API (sendMessage + sendDocument).
const crypto = require("crypto");

// The widget's data → { id, username?, first_name?, last_name? } or null when the hash or the date is wrong.
function verifyLogin(auth, botToken, nowSec, maxAgeSec = 86400) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth) || !botToken) return null;
  if (typeof auth.hash !== "string" || !/^[a-f0-9]{64}$/i.test(auth.hash)) return null;
  const keys = Object.keys(auth).filter((k) => k !== "hash" && auth[k] != null).sort();
  if (keys.some((k) => typeof auth[k] === "object")) return null;
  const dataCheck = keys.map((k) => k + "=" + auth[k]).join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest();
  const got = Buffer.from(auth.hash, "hex");
  if (got.length !== calc.length || !crypto.timingSafeEqual(got, calc)) return null;
  const date = Number(auth.auth_date);
  if (!Number.isFinite(date) || nowSec - date > maxAgeSec || date - nowSec > 300) return null;
  const id = Number(auth.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const user = { id };
  for (const k of ["username", "first_name", "last_name"]) if (typeof auth[k] === "string" && auth[k]) user[k] = auth[k].slice(0, 64);
  return user;
}

// multipart/form-data by hand: plain fields and one file
function multipart(fields, file) {
  const boundary = "----smart" + crypto.randomBytes(12).toString("hex");
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === "") continue;
    chunks.push(Buffer.from("--" + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + "\r\n"));
  }
  chunks.push(
    Buffer.from(
      "--" + boundary + '\r\nContent-Disposition: form-data; name="' + file.field + '"; filename="' + file.name + '"\r\n' +
        "Content-Type: " + file.type + "\r\n\r\n"
    )
  );
  chunks.push(Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data)));
  chunks.push(Buffer.from("\r\n--" + boundary + "--\r\n"));
  return { body: Buffer.concat(chunks), type: "multipart/form-data; boundary=" + boundary };
}

function createTelegram(cfg, { fetch = globalThis.fetch } = {}) {
  const canLogin = !!(cfg.token && cfg.username);
  const canNotify = !!(cfg.token && cfg.notifyChatId);

  async function api(method, body, type) {
    const r = await fetch("https://api.telegram.org/bot" + cfg.token + "/" + method, {
      method: "POST",
      headers: { "Content-Type": type },
      body,
      signal: AbortSignal.timeout(20000),
    });
    let j = null;
    try {
      j = await r.json();
    } catch {}
    if (!r.ok || !j || !j.ok) throw new Error("telegram " + method + " " + r.status + (j && j.description ? ": " + j.description : ""));
    return j.result;
  }

  function sendMessage(text) {
    const body = { chat_id: cfg.notifyChatId, text: text.slice(0, 4096), link_preview_options: { is_disabled: true } };
    return api("sendMessage", JSON.stringify(body), "application/json");
  }

  function sendDocument(name, data, caption) {
    const m = multipart({ chat_id: cfg.notifyChatId, caption: caption ? caption.slice(0, 1024) : "" }, { field: "document", name, type: "text/plain; charset=utf-8", data });
    return api("sendDocument", m.body, m.type);
  }

  return { canLogin, canNotify, sendMessage, sendDocument };
}

// ---------- texts for Misha ----------
// Moscow time (UTC+3 all year)
function msk(iso) {
  const d = new Date(Date.parse(iso) + 3 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + "." + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}

function contactLine(s) {
  const c = s.contact || {};
  return [c.telegram, c.phone, c.email].filter(Boolean).join(" · ");
}

function tgUserLine(u) {
  if (!u) return "";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return [u.username ? "@" + u.username : "", name, "id " + u.id].filter(Boolean).join(", ");
}

function shortId(s) {
  return String(s.id).slice(0, 6);
}

// The card: who, how to reach, what they need. brief = { service, summary, missing } or null.
function formatCard(s, brief, service, userCount) {
  const name = (s.contact && s.contact.name) || (s.telegramUser && s.telegramUser.first_name) || "без имени";
  const first = s.messages[0] ? msk(s.messages[0].at) : "";
  const last = s.messages.length ? msk(s.messages[s.messages.length - 1].at) : "";
  const lines = ["Смарт: клиент просит Михаила", "", "Имя: " + name];
  const c = contactLine(s);
  if (c) lines.push("Связь: " + c);
  if (s.telegramUser) lines.push("Вошёл через Telegram: " + tgUserLine(s.telegramUser));
  lines.push("Услуга: " + ((brief && brief.service) || service || "пока не ясно"));
  lines.push("Сообщений клиента: " + userCount + " (" + first + " — " + last + " МСК)");
  if (brief && brief.summary) lines.push("", "Суть: " + brief.summary);
  else {
    const said = s.messages.filter((m) => m.role === "user").slice(-3).map((m) => "— " + m.text.slice(0, 300));
    lines.push("", "Последние сообщения клиента:", ...said);
  }
  if (brief && brief.missing && brief.missing.length) lines.push("", "Не выяснено: " + brief.missing.join("; "));
  lines.push("", "Весь разговор — в файле ниже. Сессия " + shortId(s) + ".");
  return lines.join("\n");
}

function formatTranscript(s, service) {
  const head = ["Разговор со Смартом, Smart Soultion", "Сессия: " + s.id];
  const name = (s.contact && s.contact.name) || "";
  if (name) head.push("Имя: " + name);
  const c = contactLine(s);
  if (c) head.push("Связь: " + c);
  if (s.telegramUser) head.push("Вошёл через Telegram: " + tgUserLine(s.telegramUser));
  if (service) head.push("Услуга: " + service);
  head.push("Время московское.", "");
  const body = s.messages.map((m) => {
    const who = m.role === "user" ? (m.via === "voice" ? "Клиент (голосом)" : "Клиент") : "Смарт";
    return "[" + msk(m.at) + "] " + who + ": " + m.text;
  });
  return head.concat(body).join("\n") + "\n";
}

// After the hand-off every new exchange goes to Misha too.
function formatForward(s, userText, botText) {
  const name = (s.contact && s.contact.name) || (s.telegramUser && s.telegramUser.first_name) || "клиент";
  const c = contactLine(s) || (s.telegramUser && s.telegramUser.username ? "@" + s.telegramUser.username : "");
  return "Смарт, продолжение: " + name + (c ? " (" + c + ")" : "") + ", сессия " + shortId(s) + "\n\nКлиент: " + userText + "\n\nСмарт: " + botText;
}

module.exports = { verifyLogin, createTelegram, multipart, formatCard, formatTranscript, formatForward, msk };
