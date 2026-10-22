// Builds the site: white/index.html, services/, works/, team/ and assets/ from template.html and src/assets/.
// Pictures and fonts are written as separate files so the page itself stays small and pictures load as you scroll.
// Run: node white/src/build.js   (needs python with fontTools for the wordmark font subset)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = __dirname;
const site = path.join(dir, "..");
const out = path.join(site, "assets");
fs.rmSync(out, { recursive: true, force: true }); // generated folder: start clean so no stale files ship
fs.mkdirSync(out, { recursive: true });

let tpl = fs.readFileSync(path.join(dir, "template.html"), "utf8");

function copy(src, name) {
  fs.copyFileSync(path.join(dir, "assets", src), path.join(out, name || src));
  return "assets/" + (name || src);
}
// The wordmark face, TT Travels Next 800, is a commercial font: it lives only in src/private/ (not in git) and is cut
// to Latin, Cyrillic and the punctuation the site uses, saved as WOFF. Without it the wordmark falls back to the system face.
const privateFont = path.join(dir, "private", "travels-800.ttf");
function subsetFont(file, name) {
  execFileSync("python", ["-m", "fontTools.subset", file,
    "--unicodes=U+0020-007E,U+00A0-00FF,U+0400-045F,U+2010-2027,U+2030-203A,U+20BD,U+2116,U+2190-2193,U+2212",
    "--layout-features=*", "--flavor=woff", "--output-file=" + path.join(out, name)]);
  return "assets/" + name;
}
if (!fs.existsSync(privateFont)) {
  console.warn("src/private/travels-800.ttf not found: the wordmark uses the system face");
  tpl = tpl.split("\n").filter(line => !line.includes("%%FONT800%%")).join("\n");
}

// The logo (Roma's pick, 2026-10-21): the crescent palm with three finger arcs holding the soul-circle,
// taken as drawn from ../logo/logo-nabroski.html (mark 01). mark.svg = ink; smart.svg (the assistant) = the same with a red soul.
const sheet = fs.readFileSync(path.join(site, "..", "logo", "logo-nabroski.html"), "utf8");
const logoSrc = (sheet.match(/<svg viewBox="2 2 96 96"[^>]*>([\s\S]*?)<\/svg>/) || [])[1];
if (!logoSrc) throw new Error("logo not found in logo-nabroski.html");
const LOGO_INNER = logoSrc.replace(/#0B0B0B/gi, "#111111");
const markSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 96 96">' + LOGO_INNER + '</svg>';
fs.writeFileSync(path.join(out, "mark.svg"), markSvg);
// The assistant «Смарт»: its own sign in the manner of the logo — the logo's crescent turned into a chat bubble
// with a tail, the red soul inside (variant «Пузырь», picked 2026-10-22).
const smartSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><mask id="smart-cut">' +
  '<rect width="100" height="100" fill="#fff"/><circle cx="58" cy="43" r="29" fill="#000"/></mask></defs>' +
  '<g mask="url(#smart-cut)"><circle cx="50" cy="52" r="38" fill="#111111"/><path d="M18 70 L8 95 L36 84 Z" fill="#111111"/></g>' +
  '<circle cx="58" cy="43" r="13" fill="#e52124"/></svg>';
fs.writeFileSync(path.join(out, "smart.svg"), smartSvg);

const parts = {
  LOGO: LOGO_INNER.replace(/#111111/g, "currentColor"),
  // Manrope (Roma's pick 2026-10-22), variable 200–800, OFL, from Fontsource: the one face of the site.
  MANROPE_CYRILLIC: copy("manrope-cyrillic.woff2"),
  MANROPE_LATIN: copy("manrope-latin.woff2"),
  FONT800: fs.existsSync(privateFont) ? subsetFont(privateFont, "travels-800.woff") : "",
  // Team photos (2026-10-22), cropped head-and-shoulders alike.
  MISHA: copy("team-misha.jpg"),
  EGOR: copy("team-egor.jpg"),
  ROMA: copy("team-roma.jpg"),
  ASSISTANT: fs.readFileSync(path.join(dir, "assistant.html"), "utf8").split("assets/mark.svg").join("assets/smart.svg"),
};
for (const f of ["og.png", "apple-touch-icon.png"]) if (fs.existsSync(path.join(dir, "assets", f))) copy(f);
for (const f of fs.readdirSync(path.join(dir, "assets"))) if (f.startsWith("team-")) copy(f); // other team photos (Yana)

// Sizes stay in plain px on every screen: the page no longer grows with the window above 1440 px
// (it made everything a third bigger on a 1920 monitor; removed on the team's word 2026-10-22).

// What we make: the «Создаём» menu, the cards on the home page and one page per product (src/products.js).
const P = require("./products.js");
const ALL = P.items.concat([P.support]);
for (const a of P.apps) copy(a.img); // work covers
const url = p => "/services/" + p.slug + "/";
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ico = id => '<svg class="ic"><use href="#' + id + '"/></svg>';
const arrow = ico("i-arrow");
parts.MENU_MAKE = P.groups.map(g => '<div class="dd-col"><p class="dd-h">' + g.name + "</p>" +
  P.items.filter(p => p.group === g.id).map(p => '<a href="' + url(p) + '"><b>' + p.menu + "</b><span>" + p.line + "</span></a>").join("") + "</div>").join("") +
  '<div class="dd-foot"><a href="' + url(P.support) + '"><b>' + P.support.menu + "</b><span>" + P.support.line + '</span></a><a class="all" href="/services/">Все продукты' + arrow + "</a></div>";
parts.DROP_MAKE = ALL.map(p => '<a class="row" href="' + url(p) + '">' + p.menu + "</a>").join("") + '<a class="row all" href="/services/">Все продукты</a>';
// What we make: one coloured column per group (red / ink / rose), each a plain list of links to the product pages.
const TONES = ["red", "ink", "rose"]; // support gets "soft"
const grouped = () => '<div class="cols">' + P.groups.map((g, gi) => {
  const list = P.items.filter(p => p.group === g.id);
  return '<section class="col ' + TONES[gi % TONES.length] + " rv" + (gi ? " d" + gi : "") + '" aria-labelledby="col-' + g.id + '"><div class="col-h"><h3 class="tb" id="col-' + g.id + '">' + g.name +
    '</h3><span class="col-n">' + String(list.length).padStart(2, "0") + "</span></div><ul>" +
    list.map(p => '<li><a href="' + url(p) + '"><span><b>' + p.menu + "</b><span>" + p.line + "</span></span>" + arrow + "</a></li>").join("") + "</ul></section>";
}).join("") +
  // Support is the fourth column: what it covers, every line leading to its page.
  '<section class="col soft rv d3" aria-labelledby="col-support"><div class="col-h"><h3 class="tb" id="col-support">' + P.support.menu +
  '</h3><span class="col-n">' + String(P.support.inc.length).padStart(2, "0") + "</span></div><ul>" +
  P.support.inc.map(x => '<li><a href="' + url(P.support) + '"><span><b>' + x[0] + "</b><span>" + x[1].replace(/\.$/, "") + "</span></span>" + arrow + "</a></li>").join("") + "</ul></section></div>";
parts.PRODUCTS_HOME = grouped();
// Our works: a square dark cover (it lifts and shows a round arrow on hover, always on touch screens),
// the kind, the name and a line under it on white. The whole card is the link, so the address is not printed.
const appItems = () => P.apps.map((a, i) => {
  const inner = '<span class="w-sq" style="background:' + a.bg + '"><img loading="lazy" decoding="async" src="/assets/' + a.img + '" alt="" width="800" height="800">' +
    (a.url ? '<span class="go" aria-hidden="true">' + ico("i-out") + "</span>" : "") + "</span>" +
    '<span class="w-t"><span class="w-k">' + (a.tag || "") + '</span><b>' + a.name + '</b><span class="w-l">' + a.line + "</span></span>";
  return '<li class="rv' + (i % 3 ? " d" + (i % 3) : "") + '">' + (a.url ? '<a class="work" href="' + a.url + '" target="_blank" rel="noopener">' + inner + "</a>"
    : '<div class="work">' + inner + "</div>") + "</li>";
}).join("");
const plural = (n, [one, few, many]) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const worksWord = n => plural(n, ["работа", "работы", "работ"]);
// Home: an endless strip of the works that drifts by on its own; its last tile, in red, leads to all of them.
parts.APPS = '<div class="marq" data-marq><ul class="cases track" aria-label="Наши работы">' + appItems() +
  '<li class="rv"><a class="work all" href="/works/"><span class="w-sq"><span class="w-n">' + P.apps.length + " " + worksWord(P.apps.length) +
  '</span><span class="w-big">Все работы</span><span class="w-l">Сайты, приложения и боты — с описанием и ссылками</span><span class="arr" aria-hidden="true">' + arrow + "</span></span></a></li></ul></div>";

for (const [k, v] of Object.entries(parts)) tpl = tpl.split("%%" + k + "%%").join(v);
tpl = tpl.split('<svg class="ic">').join('<svg class="ic" aria-hidden="true" focusable="false">');
const left = tpl.match(/%%[A-Z0-9_]+%%/g);
if (left) throw new Error("unfilled: " + left.join(", "));
// Every page lives at its own path now (/services/...), so asset links start from the site root.
tpl = tpl.replace(/(["'(])assets\//g, "$1/assets/");

fs.writeFileSync(path.join(site, "index.html"), tpl);

// Product pages: the home page with its <main> swapped. Links to home sections become /#section,
// links to sections the page has itself stay local; the menu marks the page you are on.
const homeMain = /<main class="view" id="v-home" tabindex="-1">[\s\S]*?<\/main>/;
const contactHome = (tpl.match(/<section class="sec wrap" id="contact">[\s\S]*?<\/section>/) || [])[0];
const roadHome = (tpl.match(/<ol class="road" id="road">[\s\S]*?<\/ol>/) || [])[0];
if (!contactHome || !roadHome) throw new Error("contact or roadmap not found on the home page");
const svgFix = s => s.split('<svg class="ic">').join('<svg class="ic" aria-hidden="true" focusable="false">');
function contactFor(kind) {
  return contactHome.replace(/<input type="radio" name="k" checked>/, '<input type="radio" name="k">')
    .replace('<input type="radio" name="k"><span>' + kind + "</span>", '<input type="radio" name="k" checked><span>' + kind + "</span>");
}
function related(p) {
  const list = P.items.filter(x => x !== p), at = Math.max(0, P.items.indexOf(p));
  const next = list.map((x, i) => list[(at + i) % list.length]);
  return next.filter(x => p.group && x.group === p.group).concat(next.filter(x => !p.group || x.group !== p.group)).slice(0, 3);
}
const illus = require("./illus.js");
const illusCss = fs.readFileSync(path.join(dir, "illus.css"), "utf8");
const TILES = ["red", "ink", "rose", "soft"];
// «Ещё мы делаем»: other products, each shown by its own live picture, and a red tile that leads to all of them.
function moreCards(list) {
  const grpName = p => (P.groups.find(g => g.id === p.group) || { name: "Поддержка" }).name;
  return '<ul class="more">' + list.map((p, i) => '<li class="rv' + (i ? " d" + i : "") + '"><a class="mc" href="' + url(p) + '"><span class="mc-pic">' + illus(p.slug) + "</span>" +
    '<span class="mc-t"><span class="mc-k">' + grpName(p) + "</span><b>" + p.name + '</b><span class="mc-l">' + p.card + "</span></span></a></li>").join("") +
    '<li class="rv d3"><a class="mc all" href="/services/"><span class="w-n">' + ALL.length + " " + plural(ALL.length, ["продукт", "продукта", "продуктов"]) +
    '</span><span class="w-big">Все продукты</span><span class="w-l">Сайты, приложения, ИИ и поддержка</span><span class="arr" aria-hidden="true">' + arrow + "</span></a></li></ul>";
}
function productMain(p) {
  const grp = (P.groups.find(g => g.id === p.group) || { name: "Создаём" }).name;
  return '<section class="hero prod" id="home"><div class="wrap hwrap"><div class="hcopy">' +
    '<a class="back rv" href="/services/">' + ico("i-arrow") + "Все продукты</a>" +
    '<p class="lbl rv">' + grp + '</p><h1 class="m rv d1">' + p.name + '</h1><p class="lead rv d2">' + p.lead + "</p>" +
    '<div class="acts rv d3"><a class="btn" href="#contact">Обсудить задачку' + arrow + '</a><a class="ghost" href="#what"><b>' + ico("i-down") + "</b>Что это</a></div></div>" +
    '<div class="ill-wrap rv d2">' + illus(p.slug) + "</div></div></section>" +
    '<section class="sec wrap" id="what"><div class="head rv"><p class="lbl">Что это</p><h2 class="m">' + p.q + "</h2></div>" +
    '<div class="what"><p class="what-p rv">' + p.what + '</p><div class="fit rv d1"><p class="fit-h">Подходит, если</p><ul>' +
    p.fit.map(x => "<li>" + x + "</li>").join("") + "</ul></div></div></section>" +
    '<section class="sec wrap" id="inc"><div class="head rv"><p class="lbl">Что входит</p><h2 class="m">Что вы получаете</h2></div><ul class="inc4">' +
    p.inc.map((x, i) => '<li class="' + TILES[i % TILES.length] + " rv" + (i ? " d" + i : "") + '"><span class="n">0' + (i + 1) + '</span><h3 class="tb">' + x[0] + '</h3><p class="t">' + x[1] + "</p></li>").join("") + "</ul></section>" +
    '<section class="sec wrap" id="steps"><div class="head rv"><p class="lbl">Процесс</p><h2 class="m">Как проходит работа</h2></div><div class="road-box rv">' + roadHome + "</div></section>" +
    '<section class="sec wrap" id="more"><div class="head rv"><p class="lbl">Создаём</p><h2 class="m">Ещё мы делаем</h2></div>' + moreCards(related(p)) +
    "</section>" + contactFor(p.kind);
}
function overviewMain() {
  return '<section class="sec wrap ptop" id="home"><div class="head rv"><p class="lbl">Создаём</p><h1 class="m">Что мы создаём</h1>' +
    '<p class="lead">Сайты, приложения, ИИ-боты и системы для бизнеса. Выберите, что нужно, или просто расскажите о задачке.</p></div>' +
    grouped() + "</section>" + contactFor("Сайт");
}
function page(dir, title, desc, main, current, group, css) {
  const ids = new Set([...main.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]));
  let html = tpl.replace(homeMain, '<main class="view" id="v-page" tabindex="-1">' + svgFix(main) + "</main>")
    .replace("</head>", css ? "<style>" + css + "</style>\n</head>" : "</head>")
    .replace('<body data-page="home">', '<body data-page="product" data-group="' + (group || "make") + '">')
    .replace(/<title>[^<]*<\/title>/, "<title>" + esc(title) + "</title>")
    .replace(/(<meta name="description" content=")[^"]*/, "$1" + esc(desc))
    .replace(/(<meta property="og:title" content=")[^"]*/, "$1" + esc(title))
    .replace(/(<meta property="og:description" content=")[^"]*/, "$1" + esc(desc))
    .replace(/(<meta property="og:url" content="https:\/\/smart-soultion\.vercel\.app)\/[^"]*/, "$1/" + dir + "/")
    .split('class="brand" href="#home"').join('class="brand" href="/"')
    .replace(/<a\b([^>]*?)\shref="#([\w-]+)"/g, (m, a, id) => (ids.has(id) || id === "main") ? m : "<a" + a + ' href="/#' + id + '"');
  if (current) html = html.split('href="' + current + '"').join('href="' + current + '" aria-current="page"');
  const outDir = path.join(site, dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
}
page("services", "Что мы создаём — Smart Soultion", "Сайты, приложения, ИИ-боты, интеграции и внутренние системы для бизнеса.", overviewMain(), "/services/");
page("works", "Наши работы — Smart Soultion", "Gustable, Movable, Astor, SnekIT, VEDAL, C3AG: продукты, которые сделала студия Smart Soultion.",
  '<section class="sec wrap ptop" id="home"><div class="head rv"><p class="lbl">Работы</p><h1 class="m">Наши работы</h1>' +
  '<p class="lead">Свои продукты и проекты для клиентов: что придумали, сделали и развиваем.</p></div><ul class="cases">' + appItems() + "</ul></section>" + contactFor("Сайт"),
  "/works/", "apps");
const numsHome = (tpl.match(/<ol class="nums">[\s\S]*?<\/ol>/) || [])[0];
page("team", "Наша команда — Smart Soultion", "Кто делает сайты, приложения и ИИ-ботов в студии Smart Soultion и чем занимается каждый.",
  '<section class="sec wrap ptop" id="home"><div class="head rv"><p class="lbl">О студии</p><h1 class="m">Наша команда</h1>' +
  '<p class="lead">Небольшая команда разработчиков. Делаем сайты, приложения и ИИ-ботов под ключ и сами доводим их до запуска.</p></div>' +
  '<ul class="team team-full">' + P.team.map((m, i) => '<li class="rv' + (i ? " d" + i : "") + '"><img loading="lazy" decoding="async" src="/' + (parts[m.photo] || "assets/" + m.photo) + '" alt="" width="320" height="320">' +
    '<p class="role">' + m.role + '</p><h2 class="tb">' + m.name + '</h2><p class="t about">' + m.about + "</p></li>").join("") + "</ul></section>" +
  '<section class="sec wrap" id="how"><div class="head rv"><p class="lbl">Как мы работаем</p><h2 class="m">Что для нас важно</h2></div>' + numsHome + "</section>" + contactFor("Сайт"),
  "/team/", "studio");
ALL.forEach(p => page("services/" + p.slug, p.name + " — Smart Soultion", p.lead, productMain(p), url(p), "make", illusCss));
console.log("pages: /services/ + " + ALL.length + " products");
const kb = f => Math.round(fs.statSync(f).size / 1024);
console.log("index.html", kb(path.join(site, "index.html")) + " KB");
for (const f of fs.readdirSync(out)) console.log("  assets/" + f, kb(path.join(out, f)) + " KB");
