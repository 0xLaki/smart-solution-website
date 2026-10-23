// The scripted brain: answers when GigaChat is not configured or does not answer.
// Topics and texts are ported from the site's own assistant (white/src/template.html: topic() and A),
// plus the same qualification script the AI follows, one question at a time.

// ---------- topics (as on the site) ----------
function topic(q) {
  if (/цен|стоим|сколько ст|бюджет|прайс|деньг|₽|руб/.test(q)) return "price";
  if (/срок|когда|долго|быстро|врем|сколько.*(дн|недел|месяц)|займет/.test(q)) return "time";
  if (/как.*(работаете|начать)|с чего нач|этап|процесс/.test(q)) return "steps";
  if (/astor|астор|gustable|movable|snekit|c3|с3|vedal|ведал|кейс|пример|портфолио|с кем|клиент|(^|[^а-я])работ[ыа]?([^а-я]|$)/.test(q)) return "work";
  if (/выбра|что лучше|не знаю/.test(q)) return "choose";
  if (/поддерж|сопровожд|доработ|обслуж|сломал|не работает|исправ/.test(q)) return "care";
  if (/приложени|mini ?app|мини.?апп?|(^|[^a-z])app([^a-z]|$)|ios|android|андроид|айфон|iphone|десктоп|программ(а|у|ы|ой)?([^а-я]|$)|windows|виндовс|macos/.test(q)) return "app";
  if (/(^|[^а-я])(бот|чат)|telegram|телеграм/.test(q)) return "bot";
  if (/crm|срм|интеграц|таблиц|amo|битрикс/.test(q)) return "integr";
  if (/автомат|документ|нейросет|(^|[^а-я])ии([^а-я]|$)|gpt/.test(q)) return "auto";
  if (/сайт|лендинг|магазин|каталог|портал|кабинет|корпоратив/.test(q)) return "site";
  if (/человек|менеджер|связ|позвон|телефон|михаил|миш|написать/.test(q)) return "human";
  if (/что.*делает|услуг|чем занима/.test(q)) return "what";
  return "";
}

const A = {
  what: "Делаем сайты, приложения, ИИ-ботов и интеграции, а после запуска поддерживаем их.",
  choose: "Если клиенты пишут в мессенджеры и ждут ответа, начните с ИИ-бота. Если заявок мало или их негде оставить, начните с сайта. Можно и вместе.",
  site: "Делаем лендинги, сайты компаний, интернет-магазины и личные кабинеты. Заявки с сайта сразу приходят вам.",
  app: "Делаем мобильные приложения для iPhone и Android, программы для macOS и Windows и мини-приложения в Telegram. Ведём от идеи до публикации.",
  bot: "ИИ-бот отвечает клиентам круглосуточно в Telegram или на сайте, а сложные вопросы передаёт вам.",
  integr: "Связываем сайт и бота с вашей CRM или таблицей: заявки попадают туда сами.",
  auto: "Нейросеть разбирает письма и заявки, заполняет документы и готовит сводки, а решения остаются за вами.",
  price: "Цену Михаил назовёт, когда поймёт задачу, поэтому я и расспрашиваю. Начать можно с малого.",
  time: "Сроки Михаил назовёт, когда поймёт задачу. Первую версию покажем как можно раньше.",
  work: "Наши продукты Gustable, Movable, Astor и SnekIT и сайты для VEDAL и C3AG есть на странице «Работы». Многие проекты под NDA.",
  care: "Берём проекты на поддержку: следим, чтобы всё работало, исправляем ошибки и дорабатываем по вашим задачкам.",
  steps: "Сначала разбираем задачу, потом делаем первую версию и запускаем. Каждый шаг согласуем с вами.",
};

const LABEL = { what: "Что вы делаете?", price: "Сколько стоит?", time: "Какие сроки?", work: "С кем вы работали?", site: "Сайт", app: "Приложение", bot: "ИИ-бот", integr: "Интеграция" };
const TOPIC_QUICK = {
  what: ["site", "app", "bot"], choose: ["site", "bot"], site: ["price", "time"], app: ["price", "time"], bot: ["work", "price"],
  integr: ["price", "time"], auto: ["price", "time"], price: ["time", "work"], time: ["price", "work"], work: ["price", "what"],
  care: ["price"], steps: ["price", "time"],
};

// ---------- the qualification script ----------
const CONTACT_Q = "Как вас зовут и как удобнее держать связь: Telegram или телефон?";
const CONTACT_Q_NAMED = "Как с вами удобнее держать связь: Telegram или телефон?";
const SCRIPT = [
  { q: "Расскажите, чем занимается ваш бизнес?", quick: [] },
  { q: "Кто ваши клиенты и как они сейчас к вам приходят?", quick: ["Через сайт", "Через мессенджеры", "По рекомендации"] },
  { q: "Какую задачу хотите решить в первую очередь?", quick: ["Больше заявок", "Меньше рутины", "Нужно приложение"] },
  { q: "Что у вас уже есть: сайт, бот, CRM или таблицы?", quick: ["Пока ничего", "Есть сайт", "Есть CRM"] },
  { q: "Кто будет пользоваться результатом каждый день: клиенты, сотрудники или вы сами?", quick: ["Клиенты", "Сотрудники", "Все вместе"] },
  { q: "К какому сроку хотелось бы запуститься?", quick: ["Как можно скорее", "За пару месяцев", "Пока не знаю"] },
  { q: "На какой бюджет ориентируетесь? Можно примерно, вилкой.", quick: ["Пока не знаю", "Начать с малого"] },
  { q: "Есть ли примеры сайтов или сервисов, которые вам нравятся?", quick: ["Есть", "Пока нет"] },
  { q: "Что обязательно должно быть в первой версии?", quick: [] },
  { q: "Кто с вашей стороны будет принимать решения по проекту?", quick: ["Я", "Несколько человек"] },
];
const DEEP = [
  "Расскажите подробнее, как это устроено у вас сейчас?",
  "Что сейчас отнимает больше всего времени?",
  "Как поймём, что проект удался?",
  "Есть ли что-то, чего точно не хочется?",
  "Что ещё важно учесть?",
];
const ACK = ["Понял.", "Записал.", "Ясно, спасибо.", "Хорошо."];

const HELLO = /(^|[^а-я])(привет|здравств|добрый|хай|hello|hi)([^а-яa-z]|$)/;
const THANKS = /спасиб|благодар/;
// Answers to the script («наши клиенты — рестораны», «бюджет 300 тысяч») are full of topic words,
// so the site's topics are used only for questions and for the chips' own words.
const QUESTION = /^\s*(а\s+|и\s+)?(что|как|сколько|какие|какой|какая|каких|когда|кто|с кем|где|можно|можете|есть ли|чем|зачем|почему|расскажите|подскажите|умеете|делаете|сделаете|работаете|беретесь)([^а-я]|$)/;
const HUMAN = /жив\S* человек|с человеком|менеджер|михаил|(^|[^а-я])миш[аеиу]([^а-я]|$)|оператор|позвать|позовите/;

function norm(text) {
  return " " + String(text).toLowerCase().replace(/ё/g, "е") + " ";
}

function nextQuestion(s, st) {
  const sc = s.script;
  if (!st.hasContact && (st.userCount === 1 || st.userCount - (sc.contactAskedAt || 0) >= 3)) {
    sc.contactAskedAt = st.userCount;
    return { q: st.name ? CONTACT_Q_NAMED : CONTACT_Q, quick: [] };
  }
  if (sc.step < SCRIPT.length) return SCRIPT[sc.step++];
  return { q: DEEP[sc.deep++ % DEEP.length], quick: [] };
}

// s = the session (its script state is kept in s.script); text = the visitor's message;
// st = { hasContact, gotContact, name, userCount, canHandoff }
function scriptedReply(s, text, st) {
  if (!s.script) s.script = { step: 0, deep: 0, contactAskedAt: 0 };
  const q = norm(text);
  const chip = Object.keys(LABEL).find((x) => LABEL[x].toLowerCase() === text.trim().toLowerCase());
  const asks = text.includes("?") || QUESTION.test(q);
  let k = HUMAN.test(q) ? "human" : chip || (asks ? topic(q) : "");
  if (k === "human" && !asks && st.gotContact) k = "";
  if (!k && THANKS.test(q)) k = "thanks";
  const parts = [];
  let quick = null;
  if (HELLO.test(q) && st.userCount <= 2) parts.push("Здравствуйте!");
  if (k === "human") {
    if (st.canHandoff) return { text: "Можно звать Михаила: нажмите в чате кнопку связи с ним, и он получит весь наш разговор.", quick: [] };
    parts.push("Михаил подключится, когда мы вместе опишем задачу, и сразу увидит весь разговор.");
  } else if (k === "thanks") parts.push("Пожалуйста!");
  else if (k) {
    parts.push(A[k]);
    quick = (TOPIC_QUICK[k] || []).map((x) => LABEL[x]);
  } else if (st.gotContact) parts.push(st.name ? "Спасибо, " + st.name + "!" : "Спасибо, записал.");
  else if (!parts.length || text.trim().split(/\s+/).length > 3) parts.push(ACK[st.userCount % ACK.length]);

  if (st.canHandoff && !s.script.toldHandoff) {
    s.script.toldHandoff = true;
    parts.push("Кажется, картина сложилась: можно позвать Михаила кнопкой в чате, он получит весь разговор. А пока уточню ещё.");
  }
  const next = nextQuestion(s, st);
  parts.push(next.q);
  if (next.quick.length || !quick) quick = next.quick;
  return { text: parts.join(" "), quick: quick.slice(0, 3) };
}

// ---------- which of our services the visitor talks about ----------
const SERVICE_WORDS = [
  ["mini-app", /mini ?app|мини.?апп|мини.?приложен/],
  ["landing", /лендинг|landing|одностранич|посадочн/],
  ["shop", /магазин|каталог товар|корзин|e-?commerce/],
  ["corporate", /корпоратив|сайт (для )?компании|визитк/],
  ["web-app", /личн\S* кабинет|портал|веб.?сервис|онлайн.?запис|saas/],
  ["mobile", /мобильн|(^|[^a-z])ios([^a-z]|$)|android|андроид|айфон|iphone|app ?store|google play/],
  ["desktop", /десктоп|windows|виндовс|macos|программ\S* для (компьютер|пк)/],
  ["ai-bot", /(^|[^а-я])(чат.?)?бот(а|ы|ов|у|ом|ам)?([^а-я]|$)|ассистент/],
  ["crm", /(^|[^a-z])crm|срм|(^|[^а-я])учет([^а-я]|а|ом)|внутренн\S* систем|админк|дашборд/],
  ["integrations", /интеграц|(^|[^a-z])api([^a-z]|$)|вебхук|webhook|(^|[^а-я])амо|amocrm|битрикс|bitrix|(^|[^а-я0-9])1[сc]([^а-яa-z]|$)/],
  ["ai-automation", /автоматиз|нейросет|(^|[^а-я])ии([^а-я]|$)|(^|[^a-z])(ai|gpt)([^a-z]|$)|рутин/],
  ["support", /поддержк|сопровожд|доработ|сломал|не работает/],
];
const GROUP_WORDS = [["web", /сайт/], ["apps", /приложени/]];

function detectService(text, catalog) {
  const q = norm(text);
  for (const [slug, re] of SERVICE_WORDS) {
    if (!re.test(q)) continue;
    const item = slug === "support" ? catalog.support : catalog.items.find((i) => i.slug === slug);
    if (item) return item.name;
  }
  for (const [id, re] of GROUP_WORDS) {
    if (!re.test(q)) continue;
    const g = catalog.groups.find((x) => x.id === id);
    if (g) return g.name;
  }
  return "";
}

module.exports = { topic, scriptedReply, detectService, CONTACT_Q, SCRIPT };
