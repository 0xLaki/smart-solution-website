# Smart Soultion — design system

The site of a small development studio that makes websites, apps, AI bots and integrations. Russian copy. The name is spelled «Soultion» on purpose.
Live: https://smart-soultion.vercel.app (noindex while it is being shaped).

## Build and deploy

- Source: `src/template.html` (page shell, styles, script), `src/products.js` (products, works, team), `src/illus.js` + `src/illus.css`
  (product pictures), `src/assistant.html` + `src/smart.js` + `src/smart.css` (assistant «Смарт», inlined into every page),
  `src/assets/` (fonts, photos, covers).
- `node src/build.js` writes `index.html`, `services/`, `works/`, `team/` and `assets/` next to `src/`. Needs Python with fontTools
  (the TT Travels wordmark face is subset to WOFF) and reads the logo from `../logo/logo-nabroski.html`.
- Preview deploy: copy `index.html`, `assets/`, `services/`, `works/`, `team/` to the Vercel project folder and run `vercel deploy --prod`.
- Release for smart-soultion.com: `SITE_URL=https://smart-soultion.com SITE_INDEX=1 OUT=_local/release node white/src/build.js`
  (canonical, sitemap.xml, robots.txt, no noindex). Without these variables the build is the noindex preview.
- Production runs on the team VM in Docker behind Caddy (`Dockerfile`, `compose.yaml`, `deploy/nginx.conf`): see `docs/DEPLOY.md`.
- Not in git: `shots/` (local screenshots), `_fonts/` (font trials, one of them a trial build), `_shot.html` (shot helper).

## Audience

Small and medium business owners of every age. A young visitor must understand in seconds what we do and where to tap;
an older visitor must read everything without zooming and never guess what an icon means.

## Principles (owner's and Yana's rules)

- Warm minimalism: white page, one accent colour, a lot of air, no visual noise, contrast ≥ 4.5:1.
- A team of programmers, not a «medical company»: terminal on the home page, versions on the roadmap.
- Every section reads the same way: small red label → heading → content under it, all left-aligned.
- Fewer words, fewer elements. «Нагружено» / «нагромождено» means remove and add space, not restyle.
- Geometry: pictures are squares (team photos, work covers); coloured text blocks are rectangles.
- The brand visual is the logo: a crescent palm with three finger arcs holding a solid soul-circle. It never travels over text.
- Never invent numbers, prices or clients.
- Tone: restrained but not stiff, plain words, a little IT slang («задачка»).
- Plain px on every screen; content stays in a 1280 px column (no page-wide scaling).

## Logo and assistant sign

Mark from `../logo/logo-nabroski.html` (mark 01), read by `build.js`: inline in the header, intro and footer as `currentColor`;
`assets/mark.svg` is the favicon. Wordmark «SMART S●ULTION»: TT Travels Next 800, the O is a solid circle.
The assistant has its own sign in the manner of the logo (`assets/smart.svg`): the crescent as a chat bubble with a tail,
the red soul inside.

## Assistant «Смарт»

A «cursor», not a window: a slim white pill in the bottom-right corner (the sign, a blinking red caret, «Спросите Смарта…»,
a mic), hairline and a faint shadow. On phones it shrinks to the sign while the page scrolls down and steps aside while the
contact form is on screen. A click, a key or the mic opens the chat: a 420 px panel on the right edge, full height, over the
page with a soft shadow (computers; the page stays usable and the panel stays open from page to page within a visit), a sheet
from the bottom with a dimmed page on phones. Inside, top to bottom: Смарт; Mikhail's strip (photo, a calm line, «Позвать
Михаила», active only when the server says the task is collected — no counters); the conversation (voice messages marked
«голосом», a date line once it is older than today); hints as pills; the composer — the same pill grown into the chat.
Red only for what is live: the caret and the mic while it listens. With the server (`/api/smart/*`) the conversation is kept
by `sessionId` in localStorage and comes back on return; without it Смарт answers from the site's own words.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | page |
| `--soft` / `--soft2` | `#f8f8f8` / `#f1f1f1` | cards, panels |
| `--line` | `#ebebeb` | borders, dividers |
| `--ink` | `#111111` | headings, buttons, dark panels |
| `--text` | `#262626` | body text |
| `--mid` | `#5c5c5c` | secondary text, captions |
| `--accent` | `#e52124` | red: dots, lines, active tab, icons |
| `--accent-ink` | `#c8161c` | red panels and red text (≥ 4.5:1) |
| `--accent-soft` | `#fdecec` | rose panels |

Coloured blocks use four tones in this order: red (`--accent-ink`), ink, rose (`--accent-soft`), grey (`--soft2`).

## Type

One face for the site: **Manrope** (variable, OFL), headings 800 with −.03em tracking, text 400 / 600. The wordmark keeps
TT Travels Next 800; system mono only inside the terminal. Sizes: `--s` 13 · `--t` 16 · `--l` 22 · `--m` 23–56 px.
Captions above names (team role, kind of work, product section) are 13 px grey uppercase with .1em tracking.

## Space and shape

`--g` side gutter 24–80 px · `--sec` 88–160 px between sections · `--head` 36–64 px heading → content · `--pad` 32 px (24 on phones)
· `--gap` 16–24 px · `--r` 20 px corners (14 on phones). No heavy shadows.

## Pages

- `/` — intro (≈2 s, once per visit) → hero (slogan, terminal, four facts) → О нас (line «Наша команда» → `/team/`, three principles)
  → Что мы умеем (four coloured columns 2×2: Сайты, Приложения, ИИ и автоматизация, Поддержка) → Наши работы (strip that drifts on
  computers and is swiped by hand on phones; square covers; red tile «Все работы» → `/works/`) → Формат сотрудничества (Fix Price /
  Time & Material panels + process roadmap) → Контакты (dark panel; the form copies the request and opens Telegram).
- `/services/` — all products in the four columns. `/services/<slug>/` — one page per product: hero with a live picture
  (`illus.js`; on computers it takes the height of the copy), «Что это» (one card: words + «Подходит, если»), «Что вы получаете»
  (four coloured tiles), process, «Ещё мы делаем» (three products by their pictures + red tile «Все продукты»), contact.
- `/works/` — all works as square cards. `/team/` — four people (photo, role caption, name, what they do) and the principles.
- Header: logo · «Создаём ⌄» (three-column menu + support + «Все продукты») · «Работы» · «О студии ⌄» (О нас, Наша команда,
  Формат работы) · «Обсудить задачку»; a burger with groups under 1100 px.

## Motion

Blocks rise in once as they enter; roadmap segments fill one after another when it comes into view; the home terminal types once;
product pictures loop calmly. Everything is off with `prefers-reduced-motion`.
