// Smart Soultion – the team's admin (/admin/). One page, no libraries. First the gate: a check of the session, then the
// login (Telegram, Google, a Web3 wallet – only the ways the server turns on) or a calm screen when there is no server
// (the static preview). Inside, two tabs: «Заявки» – conversations collected by the assistant «Смарт», and «Проекты» –
// the board on the roadmap stages of the site. It talks only to /api/smart/admin/* on the same origin with the session
// cookie. Server text holds what visitors typed, so it goes into the page only through textContent, never innerHTML.
(() => {
  "use strict";

  const API = "/api/smart/admin";
  const SITE = "https://smart-soultion.com";
  const REFRESH_MS = 60000;
  const TG_WIDGET = "https://telegram.org/js/telegram-widget.js?22";
  const GOOGLE_GSI = "https://accounts.google.com/gsi/client";

  const S = {
    me: null, cfg: null, handoffMin: 35,
    leads: [], loaded: false, leadsFailed: false, full: new Map(), leadErr: "", filter: "all", current: null,
    stages: [], team: [], projects: [], projState: "loading",
    tab: "leads", timer: 0,
  };

  const $ = (id) => document.getElementById(id);
  const narrow = () => matchMedia("(max-width: 860px)").matches;
  const enc = (v) => encodeURIComponent(String(v));
  const str = (v) => (v == null ? "" : String(v));

  // ---------- DOM: every node is built here, text always as text ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== "") el.append(c.nodeType ? c : String(c));
    return el;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function icon(paths) {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of paths) {
      const p = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      s.append(p);
    }
    return s;
  }
  const walletIcon = () => icon([
    ["path", { d: "M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" }],
    ["path", { d: "M4 7.5v10A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" }],
    ["circle", { cx: "15.5", cy: "14.5", r: "1.2" }],
  ]);

  function toast(t) {
    const el = $("toast");
    el.textContent = t;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- API ----------
  class ApiError extends Error {
    constructor(status, code) { super(code || "http_" + status); this.status = status; this.code = code || ""; }
  }
  class UiError extends Error {}

  async function api(method, path, body) {
    const isLogin = method === "POST" && path.startsWith("/login/");
    const opt = { method, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } };
    if (method === "POST") {
      opt.headers["Content-Type"] = "application/json";
      if (!isLogin) opt.headers["X-Smart-Admin"] = "1";
      opt.body = JSON.stringify(body || {});
    }
    let res;
    try { res = await fetch(API + path, opt); } catch (e) { throw new ApiError(0, "network"); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.ok && data === null && method === "POST") return { ok: true };
    if (!res.ok || !data || typeof data !== "object" || data.ok === false) {
      const code = data && typeof data.error === "string" ? data.error : res.ok ? "not_json" : "";
      throw new ApiError(res.ok ? 502 : res.status, code);
    }
    return data;
  }
  // Calls made inside the panel: a 401 means the session is over, so back to the login.
  async function call(method, path, body) {
    try { return await api(method, path, body); } catch (e) {
      if (e.status === 401 && S.me) sessionLost();
      throw e;
    }
  }
  function errText(e) {
    if (e instanceof UiError) return e.message;
    switch (e && e.status) {
      case 0: return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
      case 400: return "Сервер не принял данные. Проверьте поля и попробуйте ещё раз.";
      case 403: return "Сервер не принял запрос. Обновите страницу и попробуйте ещё раз.";
      case 404: return "Такой записи уже нет. Обновите страницу.";
      case 429: return "Слишком часто. Подождите минуту и попробуйте снова.";
      case 503: return "Админка сейчас недоступна. Попробуйте чуть позже.";
      default: return "Не получилось. Попробуйте ещё раз.";
    }
  }
  function failed(e) { if (!(e && e.status === 401)) toast(errText(e)); }

  // ---------- time: Moscow, «сегодня, 11:42» / «вчера, 21:30» / «23 окт, 10:15» ----------
  const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  let MSK = null;
  try {
    MSK = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch (e) { MSK = null; }
  function msk(d) {
    if (MSK) {
      const o = {};
      for (const p of MSK.formatToParts(d)) o[p.type] = p.value;
      return { y: +o.year, m: +o.month, d: +o.day, hh: o.hour.padStart(2, "0").replace("24", "00"), mm: o.minute.padStart(2, "0") };
    }
    const t = new Date(d.getTime() + 3 * 3600e3); // Moscow is UTC+3 all year
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: String(t.getUTCHours()).padStart(2, "0"), mm: String(t.getUTCMinutes()).padStart(2, "0") };
  }
  const toDate = (v) => { if (v == null || v === "") return null; const d = new Date(v); return isNaN(d) ? null : d; };
  const dayKey = (p) => p.y * 10000 + p.m * 100 + p.d;
  function dayWord(p) {
    const now = Date.now(), today = msk(new Date(now)), k = dayKey(p);
    if (k === dayKey(today)) return "сегодня";
    if (k === dayKey(msk(new Date(now - 864e5)))) return "вчера";
    if (k === dayKey(msk(new Date(now + 864e5)))) return "завтра";
    return p.d + " " + MON[p.m - 1] + (p.y !== today.y ? " " + p.y : "");
  }
  function when(v) { const d = toDate(v); if (!d) return ""; const p = msk(d); return dayWord(p) + ", " + p.hh + ":" + p.mm; }
  function day(v) { const d = toDate(v); return d ? dayWord(msk(d)) : ""; }
  function clock(v) { const d = toDate(v); if (!d) return ""; const p = msk(d); return p.hh + ":" + p.mm; }
  // A due date is free text («пт», «ноябрь») unless it is an ISO date.
  function dueText(v) {
    const s = str(v).trim();
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return day(s.length === 10 ? s + "T12:00:00+03:00" : s) || s;
    return s;
  }

  // ---------- people ----------
  function ini(name) {
    const s = str(name).trim();
    if (!s) return "?";
    if (/^0x[0-9a-f]/i.test(s)) return "0x";
    const w = s.split(/\s+/).filter(Boolean);
    const first = (x) => Array.from(x)[0] || "";
    return (w.length > 1 ? first(w[0]) + first(w[1]) : first(w[0])).toUpperCase();
  }
  const firstName = (n) => str(n).trim().split(/\s+/)[0] || "";
  const VIA = { telegram: "Telegram", google: "Google", wallet: "кошелёк" };

  // ---------- gate ----------
  function gate(title, text) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gate").classList.remove("gate-busy");
    $("gateTitle").textContent = title;
    $("gateText").textContent = text;
    $("ways").replaceChildren();
    gateErr("");
  }
  function gateErr(t) { const e = $("gateErr"); e.textContent = t || ""; e.hidden = !t; }
  function busy(on) { $("gate").classList.toggle("gate-busy", on); }

  function showOff() {
    const host = location.hostname.replace(/^www\./, "");
    if (host === "smart-soultion.com") {
      gate("Админка сейчас недоступна", "Сервер заявок не отвечает или вход для команды на нём выключен. Попробуйте через пару минут.");
      $("ways").append(h("button", { class: "btn btn-ink way-btn", type: "button", onclick: () => boot() }, "Попробовать ещё раз"));
    } else {
      gate("Админка работает только на smart-soultion.com", "Здесь у неё нет сервера: это копия сайта для просмотра. Заявки и проекты открываются на основном адресе.");
      $("ways").append(h("a", { class: "btn btn-ink way-btn", href: SITE + "/admin/" }, "Открыть админку"));
    }
  }

  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((ok, no) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = ok;
        s.onerror = () => { scripts.delete(src); s.remove(); no(new Error("script")); };
        document.head.append(s);
      }));
    }
    return scripts.get(src);
  }

  async function loadLogin(note) {
    let cfg;
    try { cfg = await api("GET", "/config"); } catch (e) { return showOff(); }
    S.cfg = cfg;
    if (Number.isFinite(cfg.handoffMin) && cfg.handoffMin > 0) S.handoffMin = cfg.handoffMin;
    const bot = str(cfg.telegramBot).replace(/^@/, "");
    const gid = str(cfg.googleClientId).trim();
    const ways = [];
    if (/^[A-Za-z0-9_]{3,64}$/.test(bot)) ways.push(tgWay(bot));
    if (gid) ways.push(googleWay(gid));
    if (cfg.wallet === true) ways.push(walletWay());
    gate("Вход для команды", ways.length ? "Заявки от Смарта и проекты студии. Пускаем только аккаунты команды."
      : "Вход пока не настроен: на сервере не включён ни один способ. Напишите Михаилу.");
    $("ways").append(...ways);
    gateErr(note || "");
  }

  // Telegram: the official Login Widget. The script draws the button where it stands and calls __smartTg(user).
  function tgWay(bot) {
    window.__smartTg = (user) => login("telegram", { auth: user });
    const box = h("div", { class: "way way-tg" });
    const s = document.createElement("script");
    s.async = true;
    s.src = TG_WIDGET;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "20");
    s.setAttribute("data-userpic", "false");
    s.setAttribute("data-lang", "ru");
    s.setAttribute("data-onauth", "__smartTg(user)");
    s.onerror = () => box.replaceChildren(h("p", { class: "way-note" }, "Кнопка Telegram не загрузилась. Проверьте интернет и обновите страницу."));
    box.append(s);
    return box;
  }

  // Google: Identity Services, the button in Russian, the ID token goes to the server.
  function googleWay(clientId) {
    const box = h("div", { class: "way way-g" });
    loadScript(GOOGLE_GSI).then(() => {
      const id = window.google && google.accounts && google.accounts.id;
      if (!id) throw new Error("gsi");
      id.initialize({
        client_id: clientId,
        callback: (r) => (r && r.credential ? login("google", { credential: r.credential }) : gateErr("Вход не подтвердился, попробуйте ещё раз.")),
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      id.renderButton(box, { type: "standard", theme: "outline", size: "large", shape: "pill", text: "signin_with", logo_alignment: "center", locale: "ru", width: Math.max(200, Math.min(320, box.clientWidth || 300)) });
    }).catch(() => box.replaceChildren(h("p", { class: "way-note" }, "Кнопка Google не загрузилась. Проверьте интернет и обновите страницу.")));
    return box;
  }

  // Web3 wallet: the address, a one-time message from the server, the wallet's signature of it.
  function walletWay() {
    const note = h("p", { class: "way-note", hidden: !!window.ethereum },
      "Кошелёк не найден. Откройте эту страницу в браузере кошелька (MetaMask, Rabby, Coinbase Wallet) или поставьте его расширение.");
    if (!window.ethereum) window.addEventListener("ethereum#initialized", () => { note.hidden = !!window.ethereum; }, { once: true });
    const btn = h("button", { class: "btn btn-ink way-btn", type: "button", onclick: () => walletLogin(note) }, walletIcon(), "Войти через кошелёк");
    return h("div", { class: "way way-wallet" }, btn, note);
  }
  const toHex = (s) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
  function walletErr(e, fallback) {
    if (e && e.code === 4001) return new UiError("Вы отменили запрос в кошельке.");
    if (e && e.code === -32002) return new UiError("Откройте кошелёк: там уже ждёт запрос.");
    return new UiError(fallback);
  }
  async function walletLogin(note) {
    const eth = window.ethereum;
    if (!eth || typeof eth.request !== "function") { note.hidden = false; return; }
    gateErr("");
    busy(true);
    try {
      let accounts;
      try { accounts = await eth.request({ method: "eth_requestAccounts" }); } catch (e) { throw walletErr(e, "Кошелёк не дал адрес. Попробуйте ещё раз."); }
      const addr = Array.isArray(accounts) ? str(accounts[0]) : "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new UiError("Кошелёк не дал адрес. Попробуйте ещё раз.");
      const n = await api("GET", "/login/wallet/nonce?address=" + enc(addr));
      if (typeof n.message !== "string" || !n.message) throw new ApiError(502, "not_json");
      let signature;
      try { signature = await eth.request({ method: "personal_sign", params: [toHex(n.message), addr] }); } catch (e) { throw walletErr(e, "Кошелёк не подписал сообщение. Попробуйте ещё раз."); }
      const r = await api("POST", "/login/wallet", { message: n.message, signature });
      enter(r.user);
    } catch (e) {
      loginFailed(e);
    } finally {
      busy(false);
    }
  }

  async function login(method, body) {
    gateErr("");
    busy(true);
    try {
      const r = await api("POST", "/login/" + method, body);
      enter(r.user);
    } catch (e) {
      loginFailed(e);
    } finally {
      busy(false);
    }
  }
  function loginFailed(e) {
    if (e instanceof UiError) return gateErr(e.message);
    if (e.status === 403 && e.code === "not_team") return gateErr("Этого аккаунта нет в списке команды. Попросите Михаила добавить его.");
    if (e.status === 401) return gateErr("Вход не подтвердился, попробуйте ещё раз.");
    if (e.code === "method_off") return gateErr("Этот способ входа сейчас выключен на сервере. Попробуйте другой.");
    if (e.code === "google_failed") return gateErr("Google сейчас не ответил. Попробуйте ещё раз через минуту.");
    if (e.status === 503 || e.status === 404 || e.code === "not_json") return showOff();
    if (e.status === 429) return gateErr("Слишком много попыток. Подождите минуту и попробуйте снова.");
    if (e.status === 0) return gateErr("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
    return gateErr("Не получилось войти. Попробуйте ещё раз.");
  }

  // ---------- session ----------
  async function boot() {
    gate("Вход для команды", "Проверяем, вошли ли вы раньше…");
    let r;
    try { r = await api("GET", "/me"); } catch (e) { return e.status === 401 || e.status === 403 ? loadLogin() : showOff(); }
    enter(r.user);
  }

  function enter(user) {
    S.me = user && typeof user === "object" ? user : {};
    $("ways").replaceChildren(); // the login widgets go away with the gate
    $("gate").hidden = true;
    $("app").hidden = false;
    const name = str(S.me.name).trim() || "Команда";
    const via = VIA[S.me.via] ? ", вход через " + VIA[S.me.via] : "";
    $("meName").textContent = name;
    const av = $("meAv");
    av.textContent = ini(name);
    av.title = name + via;
    av.setAttribute("role", "img");
    av.setAttribute("aria-label", name + via);
    Object.assign(S, { leads: [], loaded: false, leadsFailed: false, leadErr: "", filter: "all", current: null, projects: [], projState: "loading" });
    S.full.clear();
    $("tab-leads").classList.remove("open");
    showTab("leads");
    renderFilters(); renderRows(); renderDetail(); renderBoard();
    reloadLeads();
    loadProjects().catch(failed);
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (S.me && document.visibilityState === "visible") refreshLeads().catch(() => {}); }, REFRESH_MS);
  }

  function leave() {
    S.me = null;
    clearInterval(S.timer);
    const d = $("dlg");
    if (d.open) d.close();
    $("tab-leads").classList.remove("open");
    document.title = "Админка – Smart Soultion";
  }
  function sessionLost() {
    if (!S.me) return;
    leave();
    loadLogin("Сессия закончилась, войдите снова.");
  }
  async function logout() {
    const b = $("logout");
    b.disabled = true;
    try { await api("POST", "/logout"); } catch (e) {
      if (e.status !== 401) { b.disabled = false; return toast("Не получилось выйти. " + errText(e)); }
    }
    b.disabled = false;
    leave();
    loadLogin();
  }

  // ---------- tabs ----------
  function showTab(t) {
    S.tab = t;
    for (const b of document.querySelectorAll(".tab")) {
      const on = b.dataset.tab === t;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    $("tab-leads").hidden = t !== "leads";
    $("tab-projects").hidden = t !== "projects";
  }

  // ---------- leads ----------
  const STATUS = { new: ["Новая", "st-new"], contact: ["Есть контакт", "st-contact"], misha: ["У Михаила", "st-misha"], work: ["В работе", "st-work"], closed: ["Закрыта", "st-closed"] };
  const FILTERS = [["all", "Все"], ["new", "Новые"], ["contact", "Есть контакт"], ["misha", "У Михаила"], ["work", "В работе"], ["closed", "Закрытые"]];
  const chip = (st) => { const s = STATUS[st] || [str(st) || "–", ""]; return h("span", { class: "chip " + s[1] }, h("i"), s[0]); };
  const stamp = (l) => Date.parse(l.updatedAt || l.createdAt || 0) || 0;

  async function refreshLeads() {
    const r = await call("GET", "/leads");
    const before = new Map(S.leads.map((l) => [l.id, l.updatedAt]));
    S.leads = (Array.isArray(r.leads) ? r.leads : []).filter((l) => l && l.id != null).sort((a, b) => stamp(b) - stamp(a));
    S.loaded = true;
    renderFilters();
    renderRows();
    const cur = S.current && S.leads.find((l) => l.id === S.current);
    if (S.current && !cur) S.current = null;
    if (!S.current && !narrow()) {
      const first = visibleLeads()[0];
      if (first) return openLead(first.id, false);
    }
    if (cur && (before.get(cur.id) !== cur.updatedAt || !S.full.has(cur.id))) loadLead(cur.id);
    else renderDetail();
  }

  // The first load and a retry: when the list never came, say so in its place.
  function reloadLeads() {
    return refreshLeads().catch((e) => {
      if (!S.loaded && S.me) { S.leadsFailed = true; renderRows(); }
      failed(e);
    });
  }

  async function loadLead(id) {
    try {
      const r = await call("GET", "/leads/" + enc(id));
      if (r.lead && typeof r.lead === "object") {
        S.full.set(id, r.lead);
        const i = S.leads.findIndex((l) => l.id === id);
        if (i >= 0) {
          const copy = Object.assign({}, r.lead);
          delete copy.messages;
          S.leads[i] = Object.assign({}, S.leads[i], copy);
        }
      }
      if (S.leadErr === id) S.leadErr = "";
    } catch (e) {
      if (e.status === 401) return;
      S.leadErr = id;
    }
    if (S.current === id) { renderFilters(); renderRows(); renderDetail(); }
  }

  function visibleLeads() { return S.leads.filter((l) => S.filter === "all" || l.status === S.filter); }

  function renderFilters() {
    $("filters").replaceChildren(...FILTERS.map(([k, t]) => {
      const n = k === "all" ? S.leads.length : S.leads.filter((l) => l.status === k).length;
      return h("button", { class: "filter", type: "button", "aria-pressed": String(S.filter === k), onclick: () => { S.filter = k; renderFilters(); renderRows(); } }, t, h("b", null, String(n)));
    }));
    const fresh = S.leads.filter((l) => l.status === "new").length;
    $("newCount").textContent = fresh ? String(fresh) : "";
    document.title = (fresh ? "(" + fresh + ") " : "") + "Админка – Smart Soultion";
  }

  function rowEl(l) {
    const at = l.updatedAt || l.createdAt;
    return h("button", { class: "row" + (l.status === "closed" ? " closed" : ""), type: "button", "aria-current": String(l.id === S.current), onclick: () => openLead(l.id, true) },
      h("span", { class: "av", "aria-hidden": "true" }, l.name ? ini(l.name) : "?"),
      h("b", null, str(l.name).trim() || "Без имени"),
      h("time", { datetime: toDate(at) ? str(at) : null }, when(at)),
      h("span", { class: "what" }, str(l.summary).trim() || str(l.lastText).trim() || "Пока без сообщений"),
      h("span", { class: "meta" }, chip(l.status), h("span", null, str(l.service).trim() || "услуга пока не ясна"),
        l.status === "new" ? h("span", { class: "new-dot", role: "img", "aria-label": "новая" }) : null));
  }

  function renderRows() {
    const box = $("rows");
    if (!S.loaded) {
      return box.replaceChildren(S.leadsFailed ? h("div", { class: "empty" }, "Заявки не загрузились. ", btn("Загрузить ещё раз", "btn-soft", () => { S.leadsFailed = false; renderRows(); reloadLeads(); }))
        : h("p", { class: "empty" }, "Загружаем заявки…"));
    }
    const list = visibleLeads();
    if (!list.length) {
      return box.replaceChildren(h("p", { class: "empty" }, S.leads.length ? "Здесь пока пусто."
        : "Заявок пока нет. Они появятся, когда кто-нибудь напишет Смарту на сайте."));
    }
    box.replaceChildren(...list.map(rowEl));
  }

  function openLead(id, byHand) {
    S.current = id;
    renderRows();
    renderDetail();
    $("detail").scrollTop = 0;
    if (byHand && narrow() && !$("tab-leads").classList.contains("open")) {
      $("tab-leads").classList.add("open");
      try { history.pushState({ lead: id }, ""); } catch (e) { /* history is a nicety here */ }
    }
    loadLead(id);
  }
  function closeLead() { $("tab-leads").classList.remove("open"); }

  // Contacts from what the visitor left and from the Telegram login, each as a link where it can be one.
  const tgName = (v) => { const m = str(v).trim().match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})$/i); return m ? m[1] : ""; };
  const EMAIL = /^[^\s@<>"'?&#/\\]+@[^\s@<>"'?&#/\\]+\.[^\s@<>"'?&#/\\]+$/;
  function contactsOf(l) {
    const out = [], c = l.contact && typeof l.contact === "object" ? l.contact : {}, seen = new Set();
    for (const v of [c.telegram, l.telegram && l.telegram.username]) {
      const u = tgName(v);
      if (u && !seen.has(u.toLowerCase())) { seen.add(u.toLowerCase()); out.push({ label: "Telegram: @" + u, href: "https://t.me/" + u, tg: u }); }
      else if (!u && v === c.telegram && str(v).trim()) out.push({ label: "Telegram: " + str(v).trim() });
    }
    const phone = str(c.phone).trim();
    if (phone) {
      const digits = phone.replace(/[^\d+]/g, "");
      out.push({ label: "Телефон: " + phone, href: digits.replace(/\D/g, "").length >= 5 ? "tel:" + digits : null });
    }
    const email = str(c.email).trim();
    if (email) out.push({ label: "Почта: " + email, href: EMAIL.test(email) ? "mailto:" + email : null });
    return out;
  }

  function btn(text, cls, onclick) { return h("button", { class: "btn " + cls, type: "button", onclick }, text); }

  function renderDetail() {
    const box = $("detail");
    const base = S.current != null ? S.leads.find((x) => x.id === S.current) : null;
    if (!base) {
      box.replaceChildren(S.loaded && S.leads.length && !narrow() ? h("p", { class: "placeholder" }, "Выберите заявку слева.") : "");
      return;
    }
    const full = S.full.get(base.id);
    const l = Object.assign({}, full || {}, base);
    const name = str(l.name).trim() || "Без имени";
    const contacts = contactsOf(l);
    const tg = (contacts.find((c) => c.tg) || {}).tg;
    const project = l.projectId != null ? S.projects.find((p) => p.id === l.projectId) : null;

    const acts = [];
    if (l.projectId != null) acts.push(btn("Открыть проект", "btn-soft", () => openProject(l.projectId)));
    else if (l.status !== "closed") acts.push(btn("Взять в работу", "btn-ink", () => takeDialog(l)));
    if (tg) acts.push(h("a", { class: "btn btn-soft", href: "https://t.me/" + tg, target: "_blank", rel: "noopener noreferrer" }, "Написать в Telegram"));
    acts.push(l.status === "closed" ? btn("Вернуть", "btn-soft", (e) => leadAction(l.id, "reopen", e.currentTarget))
      : btn("Закрыть заявку", "btn-ghost", (e) => leadAction(l.id, "close", e.currentTarget)));

    const n = Math.max(0, Math.floor(Number(l.userCount) || 0));
    const note = l.handedOff ? ", разговор передан Михаилу" + (l.handedOffAt ? " " + when(l.handedOffAt) : "")
      : n >= S.handoffMin ? ", можно передавать Михаилу" : ", до передачи Михаилу нужно " + S.handoffMin;
    const missing = (Array.isArray(l.missing) ? l.missing : []).map((m) => str(m).trim()).filter(Boolean);

    box.replaceChildren(h("div", { class: "detail-in" },
      h("button", { class: "btn btn-soft back", type: "button", onclick: () => { if (history.state && history.state.lead) history.back(); else closeLead(); } }, "← Все заявки"),
      h("div", { class: "d-head" }, h("p", { class: "label" }, "Заявка от Смарта"), h("h1", null, name)),
      h("div", { class: "d-meta" },
        chip(l.status),
        contacts.map((c) => (c.href ? h("a", { class: "contact", href: c.href, target: c.tg ? "_blank" : null, rel: c.tg ? "noopener noreferrer" : null }, c.label) : h("span", { class: "contact" }, c.label))),
        l.telegram ? h("span", { class: "chip" }, "вошёл через Telegram") : null,
        contacts.length ? null : h("span", { class: "chip st-new" }, "контакта пока нет")),
      h("div", { class: "actions" }, acts),
      h("div", { class: "brief" },
        h("dl", null,
          h("dt", null, "Услуга"), h("dd", null, str(l.service).trim() || "пока не ясно"),
          h("dt", null, "Суть"), h("dd", null, str(l.summary).trim() || "Смарт ещё собирает задачу."),
          h("dt", null, "Не выяснено"), h("dd", null, missing.length ? h("ul", null, missing.map((m) => h("li", null, m))) : "всё выяснено"),
          h("dt", null, "Сообщений клиента"), h("dd", null, n + note)),
        h("p", { class: "src" }, "Сводку собирает GigaChat каждые 5 сообщений клиента.")),
      talkEl(l, full, project)));
  }

  function talkEl(l, full, project) {
    const msgs = full && Array.isArray(full.messages) ? full.messages : null;
    const first = msgs && msgs.length ? msgs[0].at : null;
    const head = h("h2", null, "Разговор", h("small", null, day(l.createdAt || first)));
    if (!msgs) {
      const err = S.leadErr === l.id;
      return h("div", { class: "talk" }, head, h("div", { class: "msgs" },
        h("p", { class: "msg sys" }, err ? "Разговор не загрузился." : "Загружаем разговор…"),
        err ? h("p", { class: "msg sys" }, btn("Загрузить ещё раз", "btn-soft", () => { S.leadErr = ""; renderDetail(); loadLead(l.id); })) : null));
    }
    const out = [];
    let lastDay = day(l.createdAt || first);
    for (const m of msgs) {
      if (!m || typeof m !== "object") continue;
      const d = day(m.at);
      if (d && d !== lastDay) { out.push(h("p", { class: "msg sys" }, d)); lastDay = d; }
      if (m.role === "user" || m.role === "bot") {
        const who = (m.role === "user" ? "Клиент" : "Смарт") + (m.role === "user" && m.via === "voice" ? ", голосом" : "") + (m.at ? " · " + clock(m.at) : "");
        out.push(h("p", { class: "msg " + m.role }, str(m.text), h("small", null, who)));
      } else if (str(m.text).trim()) {
        out.push(h("p", { class: "msg sys" }, str(m.text)));
      }
    }
    if (!out.length) out.push(h("p", { class: "msg sys" }, "Сообщений пока нет."));
    if (project) out.push(h("p", { class: "msg sys" }, "Взята в работу: проект «" + str(project.name) + "»"));
    return h("div", { class: "talk" }, head, h("div", { class: "msgs" }, out));
  }

  async function leadAction(id, what, el) {
    if (el) el.disabled = true;
    try {
      await call("POST", "/leads/" + enc(id) + "/" + what, {});
      toast(what === "close" ? "Заявка закрыта" : "Заявка вернулась в список");
      await refreshLeads();
      await loadLead(id);
    } catch (e) {
      failed(e);
      if (el && el.isConnected) el.disabled = false;
    }
  }

  // ---------- projects ----------
  async function loadProjects() {
    try {
      const r = await call("GET", "/projects");
      S.stages = (Array.isArray(r.stages) ? r.stages : []).filter((s) => s && typeof s === "object").map((s) => ({ ver: str(s.ver), title: str(s.title) }));
      S.team = (Array.isArray(r.team) ? r.team : []).filter((m) => m && str(m.name).trim()).map((m) => ({ name: str(m.name).trim(), role: str(m.role) }));
      S.projects = (Array.isArray(r.projects) ? r.projects : []).filter((p) => p && p.id != null);
      S.projState = "ok";
    } catch (e) {
      if (S.projState !== "ok") S.projState = "error";
      throw e;
    } finally {
      if (S.me) { renderBoard(); renderDetail(); }
    }
  }

  // A stage may come as its index or as its version («v0.1»); answers keep the form the server used.
  function stageIndex(p) {
    const last = Math.max(0, S.stages.length - 1);
    if (typeof p.stage === "number") return Math.max(0, Math.min(last, Math.floor(p.stage)));
    const s = str(p.stage);
    const i = S.stages.findIndex((x) => (x.ver && x.ver === s) || x.title === s);
    if (i >= 0) return i;
    return /^\d+$/.test(s) ? Math.min(last, +s) : 0;
  }
  function stageValue(p, i) {
    if (typeof p.stage === "number" || /^\d+$/.test(str(p.stage)) || p.stage == null) return i;
    return S.stages[i].ver || S.stages[i].title;
  }
  const stageLabel = (i) => { const s = S.stages[i]; return s ? (s.ver ? s.ver + " " : "") + "«" + s.title + "»" : ""; };

  function pmAv(pm) {
    const name = str(pm).trim();
    if (!name) return h("span", { class: "av none", title: "Никто не ведёт", role: "img", "aria-label": "Никто не ведёт" }, "–");
    return h("span", { class: "av", title: "Ведёт " + name, role: "img", "aria-label": "Ведёт " + name }, ini(name));
  }

  function cardEl(p, i) {
    const who = [str(p.client).trim(), str(p.service).trim()].filter(Boolean).join(" · ");
    const due = dueText(p.due);
    const next = str(p.next).trim();
    return h("article", { class: "card", "data-id": str(p.id) },
      h("button", { class: "card-main", type: "button", title: "Изменить", onclick: () => editDialog(p.id) },
        h("b", null, str(p.name).trim() || "Без названия"),
        who ? h("span", { class: "who" }, who) : null,
        h("span", { class: "next" }, next || (due ? "" : "Следующий шаг не задан"), due ? [next ? " " : "", h("em", null, due)] : null)),
      h("div", { class: "card-foot" }, pmAv(p.pm),
        i < S.stages.length - 1 ? h("button", { class: "move", type: "button", "aria-label": "Дальше: " + (str(p.name) || "проект") + " на " + stageLabel(i + 1), onclick: (e) => moveNext(p.id, e.currentTarget) }, "Дальше →") : null));
  }

  function renderBoard() {
    const board = $("board");
    if (!S.stages.length) {
      const msg = S.projState === "error" ? "Проекты не загрузились." : S.projState === "ok" ? "Сервер не прислал этапы." : "Загружаем проекты…";
      board.replaceChildren(h("div", { class: "empty" }, msg, S.projState === "error" ? [" ", btn("Загрузить ещё раз", "btn-soft", () => { S.projState = "loading"; renderBoard(); loadProjects().catch(failed); })] : null));
      return;
    }
    board.replaceChildren(...S.stages.map((st, i) => {
      const cards = S.projects.filter((p) => stageIndex(p) === i);
      return h("section", { class: "col", "aria-label": (st.ver ? st.ver + " " : "") + st.title },
        h("div", { class: "col-head" }, st.ver ? h("span", { class: "ver" }, st.ver) : null, h("b", null, st.title), h("span", { class: "n" }, String(cards.length))),
        cards.length ? cards.map((p) => cardEl(p, i)) : h("p", { class: "empty-col" }, "Пусто"));
    }));
  }

  function upsertProject(p) {
    if (!p || typeof p !== "object" || p.id == null) return false;
    const i = S.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) S.projects[i] = Object.assign({}, S.projects[i], p);
    else S.projects.unshift(p);
    return true;
  }

  function cardNode(id) { return Array.from(document.querySelectorAll(".card")).find((c) => c.dataset.id === str(id)); }
  function flash(id) {
    const c = cardNode(id);
    if (!c) return;
    c.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
    c.classList.add("flash");
    setTimeout(() => c.classList.remove("flash"), 1800);
  }
  function openProject(id) {
    showTab("projects");
    renderBoard();
    requestAnimationFrame(() => flash(id));
  }

  async function moveNext(id, el) {
    const p = S.projects.find((x) => x.id === id);
    if (!p) return;
    const i = stageIndex(p);
    if (i >= S.stages.length - 1) return;
    if (el) el.disabled = true;
    const stage = stageValue(p, i + 1);
    try {
      const r = await call("POST", "/projects/" + enc(id), { stage });
      if (!upsertProject(r.project)) upsertProject(Object.assign({}, p, { stage }));
      renderBoard();
      flash(id);
      toast((str(p.name) || "Проект") + ": " + stageLabel(i + 1));
    } catch (e) {
      failed(e);
      if (el && el.isConnected) el.disabled = false;
    }
  }

  // ---------- dialogs: take a lead, a new project, edit a card ----------
  function textField(label, name, value, opts = {}) {
    const input = h("input", { type: "text", name, value: str(value), maxlength: opts.max || 120, placeholder: opts.placeholder || null, required: !!opts.required, autocomplete: "off" });
    return { name, required: !!opts.required, input, el: h("label", { class: "field" }, h("span", null, label), input), value: () => input.value.trim() };
  }
  function selectField(label, name, options, value) {
    const sel = h("select", { name }, options.map(([v, t]) => h("option", { value: v, selected: str(v) === str(value) }, t)));
    return { name, input: sel, el: h("label", { class: "field" }, h("span", null, label), sel), value: () => sel.value };
  }
  // The manager is someone from the team page. The server keeps the old one (or puts its default) on an empty value,
  // so «Пока никто» is offered only to a project that has nobody yet.
  function pmField(value, allowEmpty) {
    const names = S.team.map((m) => m.name);
    const opts = (allowEmpty ? [["", "Пока никто"]] : []).concat(S.team.map((m) => [m.name, m.name]));
    if (value && !names.includes(value)) opts.push([value, value]);
    return selectField("Ведёт", "pm", opts, value || "");
  }
  // A new project goes to Yana by default, by name as on the server (her role on the site may change).
  const PM_DEFAULT = "Яна Арсеньева";
  function defaultPm() {
    const me = str(S.me && S.me.name).trim();
    if (S.team.some((m) => m.name === PM_DEFAULT)) return PM_DEFAULT;
    return S.team.some((m) => m.name === me) ? me : (S.team[0] || {}).name || "";
  }

  function openDialog({ title, sub, fields, submit, onSubmit, extra }) {
    const dlg = $("dlg");
    const err = h("p", { class: "dlg-err", role: "alert", hidden: true });
    const ok = h("button", { class: "btn btn-ink", type: "submit" }, submit);
    const form = h("form", { novalidate: true },
      h("h2", { id: "dlgTitle" }, title),
      sub ? h("p", { class: "dlg-sub" }, sub) : null,
      fields.map((f) => f.el), err,
      h("div", { class: "dlg-acts" }, ok, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dlg.close() }, "Отмена"), extra || null));
    form.addEventListener("input", () => { err.hidden = true; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) vals[f.name] = f.value();
      const empty = fields.find((f) => f.required && !vals[f.name]);
      if (empty) { err.textContent = "Заполните поле «" + empty.el.firstChild.textContent + "»."; err.hidden = false; empty.input.focus(); return; }
      ok.disabled = true;
      err.hidden = true;
      try {
        const done = await onSubmit(vals);
        if (done !== false && dlg.open) dlg.close();
      } catch (x) {
        if (x && x.status === 401) return;
        err.textContent = errText(x);
        err.hidden = false;
      } finally {
        ok.disabled = false;
      }
    });
    dlg.replaceChildren(form);
    if (!dlg.open) dlg.showModal();
    const first = fields[0] && fields[0].input;
    if (first && first.select) { first.focus(); first.select(); }
  }

  function takeDialog(l) {
    const name = str(l.name).trim(), service = str(l.service).trim();
    const def = [service, name].filter(Boolean).join(" – ") || "Задача с сайта";
    const fName = textField("Название проекта", "name", def, { required: true });
    const fPm = pmField(defaultPm(), !S.team.length);
    openDialog({
      title: "Взять в работу",
      sub: S.stages.length ? "Проект появится на доске, этап " + stageLabel(0) + "." : "Проект появится на доске.",
      fields: [fName, fPm],
      submit: "Создать проект",
      onSubmit: async (v) => {
        const r = await call("POST", "/leads/" + enc(l.id) + "/take", { name: v.name, pm: v.pm || undefined });
        const p = r.project && typeof r.project === "object" ? r.project : null;
        if (p) upsertProject(p);
        const pm = (p && str(p.pm)) || v.pm;
        toast("Проект создан" + (S.stages.length ? ": " + stageLabel(p ? stageIndex(p) : 0) : "") + (pm ? ", ведёт " + firstName(pm) : ""));
        if (!p) loadProjects().catch(failed);
        renderBoard();
        refreshLeads().then(() => loadLead(l.id)).catch(failed);
      },
    });
  }

  function newProjectDialog() {
    const fName = textField("Название", "name", "", { required: true });
    const fClient = textField("Клиент", "client", "", { placeholder: "например, свой продукт" });
    const fPm = pmField(defaultPm(), !S.team.length);
    openDialog({
      title: "Новый проект",
      sub: S.stages.length ? "Появится на этапе " + stageLabel(0) + "." : "",
      fields: [fName, fClient, fPm],
      submit: "Добавить",
      onSubmit: async (v) => {
        const body = { name: v.name };
        if (v.client) body.client = v.client;
        if (v.pm) body.pm = v.pm;
        const r = await call("POST", "/projects", body);
        if (upsertProject(r.project)) { renderBoard(); flash(r.project.id); } else await loadProjects();
        toast("Проект добавлен");
      },
    });
  }

  function editDialog(id) {
    const p = S.projects.find((x) => x.id === id);
    if (!p) return;
    const fName = textField("Название", "name", p.name, { required: true });
    const fNext = textField("Следующий шаг", "next", p.next, { max: 300, placeholder: "например, созвониться с клиентом" });
    const fDue = textField("Срок", "due", p.due, { max: 40, placeholder: "например, пт, завтра или 30 окт" });
    const fPm = pmField(str(p.pm).trim(), !str(p.pm).trim());
    const fStage = selectField("Этап", "stage", S.stages.map((s, i) => [String(i), (s.ver ? s.ver + " " : "") + s.title]), String(stageIndex(p)));
    const lead = p.leadId != null ? h("button", { class: "link", type: "button", onclick: () => { $("dlg").close(); showTab("leads"); S.filter = "all"; renderFilters(); openLead(p.leadId, true); } }, "Открыть заявку") : null;
    openDialog({
      title: str(p.name).trim() || "Проект",
      fields: [fName, fNext, fDue, fPm, fStage],
      submit: "Сохранить",
      extra: lead,
      onSubmit: async (v) => {
        const diff = {};
        if (v.name !== str(p.name).trim()) diff.name = v.name;
        if (v.next !== str(p.next).trim()) diff.next = v.next;
        if (v.due !== str(p.due).trim()) diff.due = v.due;
        if (v.pm !== str(p.pm).trim()) diff.pm = v.pm;
        const si = +v.stage;
        if (S.stages.length && si !== stageIndex(p)) diff.stage = stageValue(p, si);
        if (!Object.keys(diff).length) return;
        const r = await call("POST", "/projects/" + enc(id), diff);
        if (!upsertProject(r.project)) upsertProject(Object.assign({}, p, diff));
        renderBoard();
        flash(id);
        toast("Сохранено");
      },
    });
  }

  // ---------- wiring ----------
  $("logout").addEventListener("click", logout);
  $("newProject").addEventListener("click", newProjectDialog);
  for (const b of document.querySelectorAll(".tab")) {
    b.addEventListener("click", () => {
      showTab(b.dataset.tab);
      if (b.dataset.tab === "projects" && S.me) loadProjects().catch(failed);
    });
  }
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const t = S.tab === "leads" ? "projects" : "leads";
    showTab(t);
    $(t === "leads" ? "tabLeads" : "tabProjects").focus();
  });
  window.addEventListener("popstate", closeLead);
  document.addEventListener("visibilitychange", () => {
    if (S.me && document.visibilityState === "visible") refreshLeads().catch(() => {});
  });
  matchMedia("(max-width: 860px)").addEventListener("change", (e) => {
    if (!S.me) return;
    if (e.matches) closeLead();
    else if (!S.current && visibleLeads()[0]) openLead(visibleLeads()[0].id, false);
    else renderDetail();
  });

  boot();
})();
