# Деплой Smart Soultion на ВМ

Сайт статический: Node-скрипт собирает HTML, а в контейнере его отдаёт nginx. HTTPS, домен
и переадресацию `www` → `smart-soultion.com` делает Caddy на ВМ. Рядом работает второй
контейнер — сервер помощника «Смарт» (`smart-api`): nginx передаёт ему запросы `/api/`, наружу
он не открыт. Секреты (ключ GigaChat, токен бота) лежат только в `.env` на ВМ.

## Что лежит в репозитории

| Файл | Зачем |
|------|-------|
| `Dockerfile` | сборка: Node 22 собирает сайт → nginx отдаёт файлы |
| `compose.yaml` | `smart-soultion-site` на `127.0.0.1:8090` и `smart-soultion-api` внутри сети compose |
| `deploy/nginx.conf` | отдача файлов, кэш `/assets/` на неделю, gzip, `/путь` → `/путь/`, `/api/` → `smart-api` |
| `smart-api/` | сервер помощника «Смарт»: Node 22 без npm-пакетов, свой `Dockerfile`, тесты |
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

Проверить сервер локально: `cd smart-api && npm test` (тесты без сети, GigaChat и Telegram
подменены).

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
