#!/usr/bin/env python3
"""Read-only Metrika reports. No secrets or Telegram message bodies in logs."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path('/opt/smart-metrika-reports')
STATE = Path('/var/lib/smart-metrika-reports')
OWNER = 'mpoedinenko'

def read_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            result[k.strip()] = v.strip().strip('\"').strip("'")
    return result

def request(opener, url, data=None, headers=None):
    r = urllib.request.Request(url, data=data, headers=headers or {})
    with opener.open(r, timeout=25) as response:
        return json.load(response)

def metrika(path):
    token = (ROOT / 'metrika.token').read_text().strip()
    return request(urllib.request.build_opener(), 'https://api-metrika.yandex.net' + path,
                   headers={'Authorization': 'OAuth ' + token})

def counters():
    result = metrika('/management/v1/counters?permission=own&per_page=1000')
    if result.get('rows', 0) > 1000:
        raise RuntimeError('Counter pagination required')
    selected = [c for c in result['counters']
                if c.get('owner_login') == OWNER and c.get('status') == 'Active']
    if not selected:
        raise RuntimeError('No owned counters')
    for counter in selected:
        counter['report_goals'] = [(g['id'], g['name']) for g in
            metrika(f'/management/v1/counter/{counter["id"]}/goals')['goals']]
    return sorted(selected, key=lambda c: c['name'].casefold())

def stats(counter, goals, start, end):
    metrics = ['ym:s:visits', 'ym:s:users', 'ym:s:pageviews',
               'ym:s:bounceRate', 'ym:s:pageDepth', 'ym:s:avgVisitDurationSeconds']
    metrics += [f'ym:s:goal{gid}reaches' for gid, _ in goals]
    values, sampled = [], False
    for offset in range(0, len(metrics), 20):
        chunk = metrics[offset:offset + 20]
        query = urllib.parse.urlencode(dict(ids=counter, metrics=','.join(chunk),
            date1=start.isoformat(), date2=end.isoformat(), accuracy='full', timezone='+05:00'))
        result = metrika('/stat/v1/data?' + query)
        totals = result.get('totals')
        if not isinstance(totals, list) or len(totals) != len(chunk):
            raise RuntimeError('Incomplete statistics')
        values.extend(float(x or 0) for x in totals)
        sampled = sampled or result.get('sampled', False)
    return values, {'sampled': sampled}

def period(mode, today):
    end = today - dt.timedelta(days=1)
    if mode == 'weekly':
        end = today - dt.timedelta(days=today.weekday() + 1)
        return end - dt.timedelta(days=6), end
    return end, end

def change(value, previous):
    if previous == 0:
        return 'нет базы сравнения' if value else 'без изменений'
    return f'{(value / previous - 1) * 100:+.1f}%'

def build_report(mode, today):
    start, end = period(mode, today)
    days = (end - start).days + 1
    title = 'Еженедельный' if mode == 'weekly' else 'Ежедневный'
    sites = counters()
    lines = [f'📊 {title} отчёт — все наши сайты',
             f'{start:%d.%m.%Y} — {end:%d.%m.%Y} · Екатеринбург',
             f'Счётчиков в аккаунте {OWNER}: {len(sites)}', '']
    for site in sites:
        goals = site['report_goals']
        current, meta = stats(site['id'], goals, start, end)
        previous, _ = stats(site['id'], goals, start - dt.timedelta(days=days), end - dt.timedelta(days=days))
        lines += [f'🌐 {site["name"]} · {site.get("site", "") }']
        for i, name in enumerate(['Визиты', 'Посетители', 'Просмотры']):
            lines.append(f'{name}: {int(current[i])} ({change(current[i], previous[i])})')
        duration = int(current[5])
        lines += [f'Отказы: {current[3]:.1f}%', f'Глубина: {current[4]:.2f}',
                  f'Время на сайте: {duration // 60}:{duration % 60:02d}', '🎯 Достижения целей']
        lines += [f'{name}: {int(current[i + 6])}' for i, (_, name) in enumerate(goals)]
        if not goals:
            lines.append('Цели не настроены.')
        if current[0] == 0:
            lines.append('Визиты за период не зарегистрированы.')
        if meta.get('sampled'):
            lines.append('Данные с семплированием.')
        lines += [f'https://metrika.yandex.ru/overview?id={site["id"]}', '']
    lines += ['Открытие Telegram не означает полученную заявку.',
              'Учитываются только зарегистрированные Метрикой посещения. Это не проверка доступности сайта.',
              'Новые собственные счётчики аккаунта добавляются автоматически.', '#отчетизметрики']
    return '\n'.join(lines), start, end

def chunks(text, limit=3800):
    parts, current = [], ''
    for line in text.splitlines():
        if len(line) > limit:
            raise RuntimeError('Oversized report line')
        if len(current) + len(line) + 1 > limit:
            parts.append(current.rstrip())
            current = ''
        current += line + '\n'
    if current:
        parts.append(current.rstrip())
    return parts

def telegram(config, method, params):
    env = read_env(config['bot_env'])
    token = env[config['bot_token_key']]
    inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'astor-tg-awg']))[0]
    ip = next(n['IPAddress'] for n in inspect['NetworkSettings']['Networks'].values() if n.get('IPAddress'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': f'http://{ip}:8888'}))
    response = request(opener, 'https://api.telegram.org/bot' + token + '/' + method,
                       data=urllib.parse.urlencode(params).encode())
    if not response.get('ok'):
        raise RuntimeError('Telegram rejected request')
    return response['result']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['daily', 'weekly'], default='daily')
    parser.add_argument('--send', action='store_true')
    parser.add_argument('--today', type=dt.date.fromisoformat)
    args = parser.parse_args()
    today = args.today or dt.datetime.now(ZoneInfo('Asia/Yekaterinburg')).date()
    text, start, end = build_report(args.mode, today)
    if not args.send:
        print(text)
        return
    config = json.loads((ROOT / 'config.json').read_text())
    chat = telegram(config, 'getChat', {'chat_id': config['chat_id']})
    if chat.get('title') != config['expected_chat_title'] or chat.get('type') not in ('group', 'supergroup'):
        raise RuntimeError('Destination guard failed')
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'send.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = STATE / f'all-{args.mode}-{start}-{end}.json'
        if marker.exists():
            result = json.loads(marker.read_text())
            if result.get('status') == 'sent':
                print('Already sent; skipped')
                return
            raise RuntimeError('Uncertain prior send; manual check required')
        # Write before sending. An ambiguous network result must not cause a duplicate.
        marker.write_text(json.dumps({'status': 'pending', 'started_at': dt.datetime.now(dt.timezone.utc).isoformat()}))
        ids = []
        for part in chunks(text):
            result = telegram(config, 'sendMessage', {'chat_id': config['chat_id'], 'text': part,
                                                    'disable_web_page_preview': 'true'})
            ids.append(result['message_id'])
            marker.write_text(json.dumps({'status': 'pending', 'message_ids': ids}))
        marker.write_text(json.dumps({'status': 'sent', 'message_ids': ids,
                                     'sent_at': dt.datetime.now(dt.timezone.utc).isoformat()}))
        print(f'Sent combined {args.mode} report {start}..{end}; message_ids={ids}')

if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f'Report failed: HTTP {error.code}', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f'Report failed: {type(error).__name__}; no automatic resend', file=sys.stderr)
        sys.exit(1)
