# Деплой Smart Soultion на ВМ

Сайт статический: Node-скрипт собирает HTML, а в контейнере его отдаёт nginx. HTTPS, домен
и переадресацию `www` → `smart-soultion.com` делает Caddy на ВМ. Рядом работает второй
контейнер — сервер помощника «Смарт» (`smart-api`): nginx передаёт ему запросы `/api/`, наружу
он не открыт. Секреты (ключ GigaChat, токен бота, ключ админки) лежат только в `.env` на ВМ.

## Что лежит в репозитории

| Файл | Зачем |
|------|-------|
| `Dockerfile` | сборка: Node 22 собирает сайт → nginx отдаёт файлы |
| `compose.yaml` | `smart-soultion-site` на `127.0.0.1:8090` и `smart-soultion-api` внутри сети compose |
| `deploy/nginx.conf` | отдача файлов, кэш `/assets/` на неделю, gzip, `/путь` → `/путь/`, `/api/` → `smart-api` |
| `smart-api/` | сервер помощника «Смарт» и админки: Node 22, из npm только `@noble/curves` и `@noble/hashes` для входа кошельком (версии закреплены в `package-lock.json`), свой `Dockerfile`, тесты |
| `deploy/certs/` | сюда кладётся корневой сертификат Минцифры для GigaChat (см. ниже) |
| `.env.example` | переменные; секреты заполняются только в `.env` на ВМ |

Переменные `.env`:

| Переменная | Значение | Что делает |
|------------|----------|------------|
| `SITE_URL` | `https://smart-soultion.com` | адрес в canonical, og:url, og:image, sitemap |
| `SITE_INDEX` | `1` | открыт для поисковиков (`0` — закрытая тестовая сборка) |
| `SITE_PORT` | `8090` | порт на `127.0.0.1`, который проксирует Caddy |
| `SITE_TAG` | коммит | тег образов сайта и помощника: по нему делается откат |

Переменные помощника — в разделе «Помощник «Смарт»» ниже.

Шрифт надписи в логотипе (TT Travels) коммерческий, поэтому его нет в git. Рома передаёт файл
`travels-800.ttf` отдельно, его нужно положить в `white/src/private/` до сборки. Без него сайт
соберётся, только надпись будет системным шрифтом.

## Первый запуск

```bash
git clone https://github.com/astor-hospitality/smart-solution-website.git /opt/smart-soultion
cd /opt/smart-soultion
git checkout main                      # пока PR #9 не влит: git fetch origin pull/9/head:site && git checkout site
cp .env.example .env                   # и заполнить переменные помощника, см. ниже
# положить шрифт: white/src/private/travels-800.ttf
# положить сертификат: deploy/certs/russian_trusted_root_ca_pem.crt
SITE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
curl -I http://127.0.0.1:8090/         # 200
curl http://127.0.0.1:8090/api/smart/config   # {"ai":true,...}
```

Блок для Caddyfile, после него `caddy reload` (или перезапуск контейнера Caddy):

```
smart-soultion.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8090
}
www.smart-soultion.com {
	redir https://smart-soultion.com{uri} permanent
}
```

Если Caddy сам работает в Docker, вместо `127.0.0.1:8090` указать `smart-soultion-site:80` и
подключить оба контейнера к одной сети.

DNS `smart-soultion.com` и `www` уже указывают на ВМ, поэтому сертификат Caddy выпустит сразу
после `reload`. Посмотреть сайт до подключения Caddy можно через туннель:
`ssh -L 8090:127.0.0.1:8090 <вм>` → http://localhost:8090.

## Обновление

```bash
cd /opt/smart-soultion
git pull                               # или git checkout <коммит>
SITE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
```

Каждая версия остаётся отдельными образами `smart-soultion-site:<коммит>` и
`smart-soultion-api:<коммит>`. Разговоры лежат в томе `smart-data`, обновление их не трогает.

## Откат

```bash
docker image ls smart-soultion-site                 # какие версии есть
SITE_TAG=<прошлый коммит> docker compose up -d --no-build
```

Оба контейнера пересоздаются на старых образах за пару секунд, том с разговорами остаётся.
Старые образы можно чистить: `docker image rm smart-soultion-site:<коммит> smart-soultion-api:<коммит>`.

## Помощник «Смарт»

Сервер `smart-api` ведёт разговор с посетителем: отвечает через GigaChat по сценарию (имя и
контакт → бизнес → задача → какая наша услуга подходит → сроки, бюджет, что уже есть →
пересказ), каждые 5 сообщений собирает для Михаила короткую выжимку и хранит разговор, пока
человек не вернётся — хоть через неделю, хоть с другого устройства через вход по Telegram.
Михаила можно позвать после `SMART_HANDOFF_MIN` сообщений посетителя (по умолчанию 35) и только
когда оставлен контакт. Тогда бот присылает Михаилу карточку (имя, контакт, услуга, выжимка) и
весь разговор файлом `.txt`, а всё, что человек напишет после, тоже пересылает ему.

Разговоры хранятся по одному JSON-файлу на посетителя в томе `smart-data` (`/data/sessions/`).
Пустые (никто ничего не написал) удаляются через сутки. В логах нет текстов, контактов и адресов.

| Переменная | Что это |
|------------|---------|
| `GIGACHAT_AUTH_KEY` | ключ авторизации GigaChat (секрет) |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` — ключ физлица; `GIGACHAT_API_B2B` / `GIGACHAT_API_CORP` — компании |
| `GIGACHAT_MODEL` | `GigaChat-2-Pro` по умолчанию; `GigaChat-2` дешевле, `GigaChat-2-Max` умнее |
| `GIGACHAT_VOICE_MODEL` | модель для голосового ввода, необязательно; пусто = та же, что в `GIGACHAT_MODEL` |
| `GIGACHAT_CA_DIR` | папка на ВМ с корневым сертификатом, по умолчанию `./deploy/certs` |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather (секрет) |
| `TELEGRAM_BOT_USERNAME` | имя бота без `@`, для кнопки «Войти через Telegram» |
| `TELEGRAM_NOTIFY_CHAT_ID` | куда слать разговоры: id Михаила или группы |
| `SMART_HANDOFF_MIN` | сколько сообщений посетителя до Михаила, по умолчанию 35 |

**Ключ GigaChat.** developers.sber.ru → личный кабинет → проект GigaChat API → «Настройки API»
→ «Получить ключ». Нужен Authorization Key: он показывается один раз. Ключ физлица работает на
бесплатном лимите токенов и генерирует в один поток, поэтому сервер ставит запросы в очередь.

**Сертификат.** Серверы GigaChat подписаны корневым сертификатом Минцифры, которого нет в
стандартном наборе. Скачать его в формате PEM: https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
(или со страницы https://www.gosuslugi.ru/crt) и положить в `deploy/certs/`. Контейнер подключает
эту папку только на чтение и передаёт все `*.crt` и `*.pem` из неё в Node (`NODE_EXTRA_CA_CERTS`);
проверку TLS сервер не отключает. Без сертификата запросы к GigaChat не пройдут, и «Смарт» будет
отвечать текстами сайта. В первой строке лога контейнера видно `extra CA: yes`.

**Голосовой ввод.** Где распознавание речи в самом браузере не работает (Яндекс Браузер и другие
сборки Chromium без ключей Google), сайт записывает голос сам и отправляет запись на
`/api/smart/voice`, а сервер просит GigaChat записать её текстом. Новых ключей не нужно: хватает
того же `GIGACHAT_AUTH_KEY`. Без него `/api/smart/config` отвечает `voice: false`. Модель для
распознавания можно задать отдельно в `GIGACHAT_VOICE_MODEL`, если пусто, работает
`GIGACHAT_MODEL`. Запись до 1 МБ (30 секунд речи занимают около 200 КБ), не больше 8 записей в
минуту с одного адреса. Сервер записи не хранит: текст уходит обратно на страницу, а файл из
хранилища GigaChat удаляется сразу после распознавания. В лог попадают только размер записи и
время ответа. В первой строке лога контейнера видно `voice input: GigaChat <модель>`.

**Бот Telegram.**

1. @BotFather → `/newbot` → имя и username бота. Токен — в `TELEGRAM_BOT_TOKEN`, username — в
   `TELEGRAM_BOT_USERNAME`.
2. @BotFather → `/setdomain` → выбрать бота → `smart-soultion.com`. Без этого вход через
   Telegram на сайте не заработает.
3. Михаил открывает бота и нажимает «Запустить»: иначе бот не может ему писать.
4. `TELEGRAM_NOTIFY_CHAT_ID`: открыть `https://api.telegram.org/bot<токен>/getUpdates` и взять
   `message.chat.id` из сообщения Михаила. Для группы — добавить туда бота, написать в группу
   что-нибудь и взять отрицательный `chat.id` оттуда же.

После правки `.env`: `SITE_TAG=$(git rev-parse --short HEAD) docker compose up -d` — контейнер
`smart-api` пересоздастся с новыми переменными. Проверка: `docker logs smart-soultion-api`
(первая строка показывает, что включено) и `curl http://127.0.0.1:8090/api/smart/config`.

**Что работает без ключей.** Всё, кроме ИИ: без `GIGACHAT_AUTH_KEY` «Смарт» ведёт разговор по
сценарию текстами сайта, разговоры и контакты сохраняются. Без `TELEGRAM_BOT_TOKEN` нет входа
через Telegram и нельзя передать разговор Михаилу (API ответит `503`, и сайт предложит написать
ему напрямую). Если `smart-api` не запущен, сайт работает как раньше.

Проверить сервер локально: `cd smart-api && npm ci && npm test` (тесты без сети, GigaChat,
Telegram и Google подменены).

## Админка

Страница для команды: заявки, которые собрал «Смарт» (выжимка, контакты, вся переписка), и
проекты по этапам от созвона до поддержки. Её данные отдаёт тот же `smart-api` по адресам
`/api/smart/admin/…`. Отметки по заявкам и проекты лежат в томе `smart-data`, в файле `admin.json`.

Войти можно тремя способами: через Telegram, через Google или кошельком Ethereum (MetaMask и
похожие). У каждого способа в `.env` свой список тех, кого пускать. Способ включён, только когда
заполнены и его настройка, и его список. После входа браузер получает подписанную cookie на
12 часов. Каждый запрос заново сверяется со списками: если убрать человека из `.env` и
пересоздать контейнер, его сразу выкинет.

| Переменная | Что это |
|------------|---------|
| `SMART_ADMIN_SECRET` | ключ, которым подписан вход (секрет). Пустой или короче 32 символов – админка выключена, её адреса отвечают `503` |
| `SMART_SITE_ORIGIN` | адрес сайта, по умолчанию `https://smart-soultion.com`. Запросы с других адресов админка отклоняет |
| `SMART_ADMIN_TELEGRAM_IDS` | id в Telegram через запятую |
| `SMART_GOOGLE_CLIENT_ID` | id клиента Google OAuth, вида `…apps.googleusercontent.com` |
| `SMART_ADMIN_EMAILS` | почты Google через запятую |
| `SMART_ADMIN_WALLETS` | адреса кошельков `0x…` через запятую |

**Ключ.** На ВМ выполнить `openssl rand -base64 32` и вставить вывод в `SMART_ADMIN_SECRET`.
Если ключ поменять, все выйдут и войдут заново.

**Telegram.** Работает через того же бота, что и вход посетителей (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME`). У бота в @BotFather должен стоять домен: `/setdomain` → бот →
`smart-soultion.com`. Если это уже сделано для «Смарта», второй раз не нужно. Как узнать свой id:
написать боту что угодно, открыть `https://api.telegram.org/bot<токен>/getUpdates` и взять число
`message.from.id`. Можно проще: бот @userinfobot отвечает на любое сообщение строкой `Id`. Все id
записать в `SMART_ADMIN_TELEGRAM_IDS` через запятую.

**Google.** Один раз в Google Cloud Console (console.cloud.google.com):

1. Выбрать проект или создать новый.
2. «Google Auth Platform» (раньше «OAuth consent screen»): тип «External», название
   «Smart Soultion», почта поддержки. Пока приложение в статусе «Testing», войти могут только
   почты из «Test users» – добавить туда почты команды или нажать «Publish app» (для входа по
   почте и имени проверка Google не нужна).
3. «Clients» (или «Credentials» → «Create credentials» → «OAuth client ID») → тип
   **Web application**. В «Authorized JavaScript origins» добавить `https://smart-soultion.com`.
   «Authorized redirect URIs» не нужны.
4. Скопировать «Client ID» в `SMART_GOOGLE_CLIENT_ID`. Секрет клиента не нужен: сервер проверяет
   токен от Google по открытым ключам Google, которые сам скачивает с `www.googleapis.com`.
5. Почты команды записать в `SMART_ADMIN_EMAILS`.

Если с ВМ не открывается `www.googleapis.com`, вход через Google ответит `502`, остальные способы
работают.

**Кошелёк.** Адреса (`0x…`, как их показывает MetaMask) записать в `SMART_ADMIN_WALLETS` через
запятую. При входе кошелёк подписывает сообщение «Sign in to the Smart Soultion admin» с одноразовым
кодом на 5 минут. Это не транзакция: денег и газа она не тратит.

После правки `.env`: `SITE_TAG=$(git rev-parse --short HEAD) docker compose up -d`. Первая строка
`docker logs smart-soultion-api` показывает, что включено, например
`admin: on (telegram, google, wallet)`. Проверка: `curl http://127.0.0.1:8090/api/smart/admin/config`.

Через туннель (`http://localhost:8090`) админка пустит, только если на время поставить
`SMART_SITE_ORIGIN=http://localhost:8090`. Там работает только вход кошельком: Telegram и Google
привязаны к домену `smart-soultion.com`.

Защита: cookie `HttpOnly`, `Secure`, `SameSite=Strict`; любое изменение требует заголовка
`X-Smart-Admin: 1`; запросы с чужого `Origin` отклоняются; попыток входа – не больше 10 в минуту
с одного адреса. В логах нет id заявок, почт и адресов кошельков.

## Зависимости от Vercel

Их нет, заменять нечего:

- функций, API-роутов и middleware на Vercel нет; сервер помощника работает только на ВМ;
- хранилищ (KV, Blob, Postgres) нет;
- обработки изображений нет: картинки — готовые файлы нужного размера;
- аналитики Vercel и Speed Insights нет;
- переменных окружения на Vercel нет;
- форма заявки работает в браузере: копирует текст и открывает Telegram; помощник «Смарт» на
  Vercel отвечает текстами сайта, а на ВМ — через `smart-api`.

От Vercel использовались только настройки отдачи (`vercel.json`): слэш в конце адреса,
`www` → основной домен, кэш картинок. Их заменяют `deploy/nginx.conf` и блок Caddy выше.
Vercel можно оставить работающим, пока проверяется версия на ВМ: его адрес
`smart-soultion.vercel.app` закрыт от поисковиков.
