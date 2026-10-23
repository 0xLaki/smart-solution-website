# Smart Soultion Cloud.ru release — 2026-10-23

- Repository: https://github.com/astor-hospitality/smart-solution-website
- Source: PR #9, requested commit `43a798c92e68293672a22f1f535ea7b26bad4765`.
- Release directory: `/opt/smart-soultion` (source snapshot, not a git checkout).
- Docker image: `smart-soultion-site:43a798c-metrika` (base source plus analytics commit `6c10107`).
- Runtime: localhost `127.0.0.1:8090`; shared Caddy uses Docker network `edge` and `smart-soultion-site:80`.
- Caddy snippet: `/opt/edge/sites.d/smart-soultion.caddy`.
- Previous snippets: `/var/backups/smart-soultion/sites.d-before-43a798c`.
- Private font copied separately to `white/src/private/travels-800.ttf`; keep out of git.
- DNS: `A @ 176.123.165.162`, `CNAME www smart-soultion.com.`. Prior Vercel records removed.

## Start / update

```bash
cd /opt/smart-soultion
docker compose -p smart-soultion -f compose.yaml -f compose.vm.yaml up -d --build
```

The `.env` pins `SITE_TAG=43a798c-metrika`. For a later release, transfer the approved source and update its tag.

## Rollback

```bash
cd /opt/smart-soultion
SITE_TAG=<previous-image-tag> docker compose -p smart-soultion -f compose.yaml -f compose.vm.yaml up -d --no-build
```

The base image `43a798c` is retained for rollback without analytics.

## Analytics

Yandex Metrika counter `113756904`, owner account `mpoedinenko`, timezone Asia/Yekaterinburg.
Explicit visitor opt-in; Webvisor, clickmap and form-content collection disabled.
Custom events: `telegram_click`, `form_telegram_open`, `assistant_open`, `service_view`.
Opening Telegram is not evidence of a successfully received lead.
Telegram API reporting runs independently on the VM (not via Codex or the native Yandex subscription).
- Sender: `@smart_soultion_bot`; destination: `Smart_Soultion.com` with exact-title guard.
- Daily: 10:00 Asia/Yekaterinburg, previous calendar day.
- Weekly: Monday 10:05 Asia/Yekaterinburg, completed Monday–Sunday, compared with previous week.
- API token scope: `metrika:read` only. Token/config stored outside the repo, root-only under `/opt/smart-metrika-reports/`.
- Entry point: `report.py`; source: `deploy/metrika_report.py`.
- State/idempotency markers: `/var/lib/smart-metrika-reports/`.
- Service: `smart-metrika@daily.service` / `smart-metrika@weekly.service`; timers in `deploy/`.
- Initial daily report for 2026-10-22 delivered on 2026-10-23, Telegram message ID 465.
- Native Yandex Telegram subscription page remained blank; existing VEDAL subscription was not changed.

Check: `sudo systemctl list-timers --all smart-metrika-*` and `sudo journalctl -u smart-metrika@daily.service`.
Pause: `sudo systemctl disable --now smart-metrika-daily.timer smart-metrika-weekly.timer`.
An uncertain network send leaves a pending marker and must be checked manually before resending; no blind retries.

## Acceptance

All sitemap pages and referenced internal links/assets must respond successfully. Unknown URL returns 404.
Canonical host is `https://smart-soultion.com`; `www` redirects there. TLS must pass without bypassing certificate validation.
