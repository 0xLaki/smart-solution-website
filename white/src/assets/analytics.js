/* Smart Solution analytics: explicit consent, no session recording or form contents. */
(function () {
  'use strict';
  if (location.hostname !== 'smart-soultion.com' && location.hostname !== 'www.smart-soultion.com') return;
  var ID = 113756904, KEY = 'ss-analytics-consent-v1', enabled = false;
  function stored() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
  function remember(value) { try { localStorage.setItem(KEY, value); } catch (_) {} }
  function goal(name) { if (enabled && typeof window.ym === 'function') window.ym(ID, 'reachGoal', name); }
  function start() {
    if (enabled) return;
    enabled = true;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    var tag = document.createElement('script'); tag.async = true; tag.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(tag);
    var ref = ''; try { ref = document.referrer ? new URL(document.referrer).origin : ''; } catch (_) {}
    window.ym(ID, 'init', { clickmap: false, trackLinks: false, accurateTrackBounce: true,
      webvisor: false, ecommerce: false, url: location.origin + location.pathname, referrer: ref });
    if (location.pathname.indexOf('/services/') === 0 && location.pathname !== '/services/') goal('service_view');
  }
  var style = document.createElement('style');
  style.textContent = '.ss-consent{position:fixed;z-index:10000;bottom:16px;left:16px;right:16px;margin:auto;max-width:740px;padding:18px;background:#fff;color:#111;border:1px solid #ddd;border-radius:12px;box-shadow:0 5px 25px #0002;font:14px/1.5 system-ui}.ss-consent p{margin:0 0 12px}.ss-consent button{padding:10px 16px;margin-right:8px;border-radius:8px;border:1px solid #bbb;cursor:pointer}.ss-consent .yes{background:#111;color:#fff}.ss-analytics-settings{display:block;margin:12px auto;padding:10px;background:transparent;color:#555;text-decoration:underline;font:13px system-ui;cursor:pointer}';
  document.head.appendChild(style);
  var panel;
  function show() {
    if (panel) panel.remove();
    panel = document.createElement('section'); panel.className = 'ss-consent'; panel.setAttribute('aria-label', 'Настройки аналитики');
    panel.innerHTML = '<p>Разрешить Яндекс Метрике собирать статистику посещений и действий на сайте? Запись сессий выключена; содержимое форм и переписки мы в Метрику не передаём. Выбор можно изменить внизу страницы.</p><button class="yes" type="button">Разрешить аналитику</button><button class="no" type="button">Без аналитики</button>';
    panel.querySelector('.yes').onclick = function () { remember('yes'); start(); panel.remove(); panel = null; };
    panel.querySelector('.no').onclick = function () {
      remember('no');
      if (enabled) { enabled = false; window.ym(ID, 'destruct'); panel.remove(); panel = null; location.reload(); }
      else { panel.remove(); panel = null; }
    };
    document.body.appendChild(panel);
  }
  var settings = document.createElement('button'); settings.type = 'button'; settings.className = 'ss-analytics-settings';
  settings.textContent = 'Настройки аналитики'; settings.onclick = show; document.body.appendChild(settings);
  if (stored() === 'yes') start(); else if (stored() !== 'no') show();
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a,button'); if (!el) return;
    if (el.id === 'as-dock' && el.getAttribute('aria-expanded') === 'true') goal('assistant_open');
    if (el.tagName === 'A') {
      var href = el.getAttribute('href') || '';
      if (/^https:\/\/t\.me\//.test(href)) goal('telegram_click');
    }
  });
  window.addEventListener('ss:form-telegram-open', function () { goal('form_telegram_open'); });
})();
