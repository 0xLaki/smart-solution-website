// How a visitor can be reached: a phone, a Telegram handle or an e-mail.
// The contact form sends them to /contact; in the chat they are also picked out of the visitor's own words.

const TG_NAME = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/; // Telegram usernames: 5–32 characters

function normTelegram(v) {
  let s = String(v).trim();
  s = s.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.(me|dog)\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return TG_NAME.test(s) ? "@" + s : null;
}

function normPhone(v) {
  const s = String(v).trim();
  if (!/^\+?[\d\s()\-.]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 ? s.replace(/\s+/g, " ") : null;
}

function normEmail(v) {
  const s = String(v).trim().toLowerCase();
  return s.length <= 254 && /^[^\s@<>()",;]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/.test(s) ? s : null;
}

function cleanName(v) {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return /\p{L}/u.test(s) ? s : "";
}

// The contact form: { name?, phone?, telegram?, email? } → a clean contact, or null when nothing usable is in it.
// People type anything into any box, so each value is sorted by what it looks like.
function validateContact(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const out = {};
  const name = cleanName(c.name);
  if (name) out.name = name;
  for (const raw of [c.telegram, c.phone, c.email]) {
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const s = String(raw).trim().slice(0, 200);
    if (!s) continue;
    const email = !s.startsWith("@") && s.includes("@") ? normEmail(s) : null;
    const tg = email ? null : normTelegram(s);
    const phone = email || tg ? null : normPhone(s);
    if (email) out.email = email;
    else if (tg) out.telegram = tg;
    else if (phone) out.phone = phone;
    else return null;
  }
  return out.phone || out.telegram || out.email ? out : null;
}

const NOT_NAMES = new Set(
  ("да нет привет здравствуйте добрый доброе меня мой моя мне можно пишите напишите звоните позвоните хорошо спасибо " +
    "это телеграм телеграмм телефон номер почта ок окей ага конечно давайте лучше пока сайт бот нужно нужен хочу хотим " +
    "мы я наш наша у не сейчас сначала вот так здравствуй хотел хотела интересует подскажите скажите расскажите " +
    "лендинг магазин приложение приложения интеграция ресторан кафе салон компания студия сколько какие когда").split(" ")
);

// Contact details the visitor typed into the chat. askedName = the previous bot message asked for the name.
function sniffContact(text, askedName) {
  const out = {};
  const email = text.match(/[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}/i);
  if (email) out.email = email[0].toLowerCase();
  const tg = text.match(/(?:^|[\s,;:(«"])@([a-zA-Z][a-zA-Z0-9_]{4,31})(?![a-zA-Z0-9_@.])/) || text.match(/(?:t|telegram)\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})/i);
  if (tg) out.telegram = "@" + tg[1];
  // only what looks like a phone: +<country>… or a Russian 8/7 number with 11 digits (not «бюджет 800 000»)
  const phone = text.match(/\+\d[\d\s()\-]{8,18}\d|(?:^|[^\d])([78][\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2})(?!\d)/);
  if (phone) {
    const p = (phone[1] || phone[0]).trim();
    const digits = p.replace(/\D/g, "").length;
    if (digits >= 10 && digits <= 15) out.phone = p.replace(/\s+/g, " ");
  }
  // «меня зовут иван петров» / «Я Иван» / «Иван, @ivan» (a capitalised first word next to a contact or after «как вас зовут»)
  let name = text.match(/(?:[Мм]еня зовут|[Зз]овут меня|[Мм]о[её] имя)\s*[:,—–-]?\s*([А-ЯЁA-Zа-яёa-z][а-яёa-z]{1,20}(?:\s[А-ЯЁA-Z][а-яёa-z]{1,20})?)(?![а-яёa-z])/);
  if (!name) name = text.match(/^\s*(?:[Яя]|[Ээ]то)\s*[—–-]?\s*([А-ЯЁ][а-яё]{1,20})(?=[\s,.!]|$)/);
  const short = !text.includes("?") && text.trim().split(/\s+/).length <= 3;
  if (!name && ((askedName && short) || out.telegram || out.phone || out.email)) {
    name = text.match(/^\s*([А-ЯЁA-Z][а-яёa-z]{1,20})(?=[\s,.!;:]|$)/);
  }
  if (name && !NOT_NAMES.has(name[1].split(" ")[0].toLowerCase())) out.name = name[1].charAt(0).toUpperCase() + name[1].slice(1);
  return out;
}

function hasContact(s) {
  return !!(s.telegramUser || (s.contact && (s.contact.phone || s.contact.telegram || s.contact.email)));
}

// For the prompt: which kinds of contact are known (no values).
function contactKinds(s) {
  const k = [];
  if (s.contact && s.contact.telegram) k.push("Telegram");
  if (s.contact && s.contact.phone) k.push("телефон");
  if (s.contact && s.contact.email) k.push("почта");
  if (s.telegramUser && !k.includes("Telegram")) k.push("вход через Telegram");
  return k;
}

function visitorName(s) {
  return (s.contact && s.contact.name) || (s.telegramUser && s.telegramUser.first_name) || "";
}

module.exports = { validateContact, sniffContact, hasContact, contactKinds, visitorName, normTelegram, normPhone, normEmail };
