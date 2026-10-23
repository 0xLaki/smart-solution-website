# Деплой Smart Soultion на ВМ

Сайт статический: Node-скрипт собирает HTML, а в контейнере его отдаёт nginx. HTTPS, домен
и переадресацию `www` → `smart-soultion.com` делает Caddy на ВМ. Секретов, базы и серверной
части нет.

## Что лежит в репозитории

| Файл | Зачем |
|------|-------|
| `Dockerfile` | сборка: Node 22 собирает сайт → nginx отдаёт файлы |
| `compose.yaml` | один контейнер `smart-soultion-site` на `127.0.0.1:8090` |
| `deploy/nginx.conf` | отдача файлов, кэш `/assets/` на неделю, gzip, `/путь` → `/путь/` |
| `.env.example` | переменные (секретов нет) |

Переменные `.env`:

| Переменная | Значение | Что делает |
|------------|----------|------------|
| `SITE_URL` | `https://smart-soultion.com` | адрес в canonical, og:url, og:image, sitemap |
| `SITE_INDEX` | `1` | открыт для поисковиков (`0` — закрытая тестовая сборка) |
| `SITE_PORT` | `8090` | порт на `127.0.0.1`, который проксирует Caddy |
| `SITE_TAG` | коммит | тег образа: по нему делается откат |

Шрифт надписи в логотипе (TT Travels) коммерческий, поэтому его нет в git. Рома передаёт файл
`travels-800.ttf` отдельно, его нужно положить в `white/src/private/` до сборки. Без него сайт
соберётся, только надпись будет системным шрифтом.

## Первый запуск

```bash
git clone https://github.com/astor-hospitality/smart-solution-website.git /opt/smart-soultion
cd /opt/smart-soultion
git checkout main                      # пока PR #9 не влит: git fetch origin pull/9/head:site && git checkout site
cp .env.example .env
# положить шрифт: white/src/private/travels-800.ttf
SITE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
curl -I http://127.0.0.1:8090/         # 200
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

Каждая версия остаётся отдельным образом `smart-soultion-site:<коммит>`.

## Откат

```bash
docker image ls smart-soultion-site                 # какие версии есть
SITE_TAG=<прошлый коммит> docker compose up -d --no-build
```

Контейнер пересоздаётся на старом образе за пару секунд. Старые образы можно чистить:
`docker image rm smart-soultion-site:<коммит>`.

## Зависимости от Vercel

Их нет, заменять нечего:

- функций, API-роутов и middleware нет — серверного кода у сайта нет совсем;
- хранилищ (KV, Blob, Postgres) нет;
- обработки изображений нет: картинки — готовые файлы нужного размера;
- аналитики Vercel и Speed Insights нет;
- переменных окружения на Vercel нет;
- форма заявки и помощник «Смарт» работают в браузере: форма копирует текст и открывает
  Telegram, помощник отвечает текстами сайта.

От Vercel использовались только настройки отдачи (`vercel.json`): слэш в конце адреса,
`www` → основной домен, кэш картинок. Их заменяют `deploy/nginx.conf` и блок Caddy выше.
Vercel можно оставить работающим, пока проверяется версия на ВМ: его адрес
`smart-soultion.vercel.app` закрыт от поисковиков.
