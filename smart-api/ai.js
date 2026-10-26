// The GigaChat brain: a reply to the visitor, and a short brief for Misha (service, summary, what is missing).
const { systemPrompt, extractPrompt } = require("./prompt");
const { servicesText, worksText, serviceNames } = require("./catalog");

const HISTORY = 30; // messages the model sees; older ones live in the brief
const MAX_REPLY = 700;

// The conversation as the model sees it: it starts with the visitor (the greeting is in the system prompt)
// and never has the same role twice in a row.
function history(s) {
  const msgs = s.messages.slice(-HISTORY);
  let i = 0;
  while (i < msgs.length && msgs[i].role !== "user") i++;
  const out = [];
  for (const m of msgs.slice(i)) {
    const role = m.role === "user" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + m.text;
    else out.push({ role, content: m.text });
  }
  return out;
}

// Plain text for the chat and for reading aloud: no markdown, no lists, no «Смарт:» in front.
function plain(s) {
  return s
    .replace(/^\s*(смарт|smart)\s*:\s*/i, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function cut(text, max) {
  if (text.length <= max) return text;
  const part = text.slice(0, max);
  const end = Math.max(part.lastIndexOf(". "), part.lastIndexOf("? "), part.lastIndexOf("! "));
  return end > max / 2 ? part.slice(0, end + 1) : part.replace(/\s+\S*$/, "") + "…";
}

function cleanChip(c) {
  return c.replace(/^[\s"'«»“”(\[]+|[\s"'«»“”)\].]+$/g, "").replace(/\s+/g, " ").slice(0, 40).trim();
}

// The model's answer → { text, quick }: the line «Подсказки: a | b | c» becomes the chips.
function parseReply(raw) {
  const lines = String(raw || "").replace(/\r/g, "").split("\n");
  let quick = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*[*_]*\s*(подсказки|варианты(?: ответа)?)\s*[*_]*\s*:\s*(.*)$/i);
    if (!m) continue;
    quick = m[2].split(/\s*[|;]\s*/).map(cleanChip).filter(Boolean).slice(0, 3);
    lines.splice(i, 1);
    break;
  }
  return { text: cut(plain(lines.join("\n")), MAX_REPLY), quick };
}

function matchService(raw, names) {
  const s = String(raw || "").trim().replace(/^[«"']|[»"'.]$/g, "");
  if (!s || /^(нет|не ясно|неясно|неизвестно|пока непонятно|непонятно|none|null|-|—)$/i.test(s)) return "";
  const low = s.toLowerCase();
  const exact = names.find((n) => n.toLowerCase() === low);
  if (exact) return exact;
  const inside = names.find((n) => low.includes(n.toLowerCase()) || n.toLowerCase().includes(low));
  return inside || s.slice(0, 80);
}

// The brief call's answer → { service, summary, missing } or null when it is not usable JSON.
function parseExtraction(raw, names) {
  if (raw == null) return null;
  const s = String(raw).replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j;
  try {
    j = JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  let missing = j.missing;
  if (typeof missing === "string") missing = missing.split(/[;\n]/);
  if (!Array.isArray(missing)) missing = [];
  missing = missing
    .map((x) => (typeof x === "string" ? x.trim().replace(/^[-•]\s*/, "") : ""))
    .filter(Boolean)
    .slice(0, 6)
    .map((x) => x.slice(0, 160));
  const service = matchService(typeof j.service === "string" ? j.service : "", names);
  const summary = typeof j.summary === "string" ? plain(j.summary).slice(0, 1200) : "";
  if (!service && !summary && !missing.length) return null;
  return { service, summary, missing };
}

// The whole conversation as text for the brief call (the end of it, when it is very long).
function transcriptForModel(s, max = 12000) {
  const text = s.messages.map((m) => (m.role === "user" ? "Посетитель: " : "Смарт: ") + m.text).join("\n");
  return text.length > max ? "…\n" + text.slice(text.length - max) : text;
}

function createAi({ giga, catalog }) {
  const services = servicesText(catalog);
  const works = worksText(catalog);
  const names = serviceNames(catalog);

  // st: the conversation state for the prompt (see prompt.js systemPrompt)
  async function reply(s, st) {
    const sys = systemPrompt(Object.assign({}, st, { services, works }));
    const r = await giga.chat([{ role: "system", content: sys }].concat(history(s)), { temperature: 0.7, maxTokens: 350 });
    if (r.finish === "blacklist") return null; // GigaChat's own refusal: the scripted brain answers instead
    const out = parseReply(r.text);
    return out.text ? out : null;
  }

  async function extract(s) {
    const r = await giga.chat(
      [
        { role: "system", content: extractPrompt(names) },
        { role: "user", content: transcriptForModel(s) },
      ],
      { temperature: 0.1, maxTokens: 500 }
    );
    return parseExtraction(r.text, names);
  }

  // A voice recording → the visitor's words ("" when nothing was said). max: the longest chat message.
  async function transcribe(audio, file, max) {
    const r = await giga.transcribe(audio, file);
    if (r.finish === "blacklist") return ""; // GigaChat's canned refusal is not what the visitor said
    return cleanTranscript(r.text, max);
  }

  return { reply, extract, transcribe };
}

const QUOTES = "\"'«»“”„";
const OPEN = "\"'«“„";
const CLOSE = "\"'»”“";

// The model's transcript → plain words for the chat box: one line, no wrapping quotes, no «Текст:» in front,
// and «(тишина)», «[музыка]» or «Речи нет» count as nothing said.
function cleanTranscript(raw, max = 1000) {
  let s = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(расшифровка|транскрипция|распознанный текст|текст)\s*:\s*/i, "");
  const wrapped = (x) => x.length >= 2 && OPEN.includes(x[0]) && CLOSE.includes(x[x.length - 1]);
  while (wrapped(s)) {
    const inner = s.slice(1, -1).trim();
    // `"«Привет»"` loses both pairs, `"а" и "б"` keeps its quotes
    if ([...inner].some((ch) => QUOTES.includes(ch)) && !wrapped(inner)) break;
    s = inner;
  }
  if (/^[([][^()[\]]*[)\]]$/.test(s) || /^(пустая строка|речи нет|нет речи|речь отсутствует|тишина)\.?$/i.test(s)) return "";
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "");
  return s;
}

module.exports = { createAi, parseReply, parseExtraction, history, cleanTranscript };
