/* Smart Solution analytics and masked Webvisor, only after explicit consent. */
(function () {
  'use strict';
  if (location.hostname !== 'smart-soultion.com' && location.hostname !== 'www.smart-soultion.com') return;
  var ID = 113756904, KEY = 'ss-analytics-consent-v2', enabled = false;
  // Earlier consent explicitly excluded replay. Ask again before recording;
  // preserve earlier refusals instead of asking those visitors repeatedly.
  function stored() { try { return localStorage.getItem(KEY) || (localStorage.getItem('ss-analytics-consent-v1') === 'no' ? 'no' : null); } catch (_) { return null; } }
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
    window.ym(ID, 'init', { clickmap: true, trackLinks: false, accurateTrackBounce: true,
      webvisor: true, ecommerce: false, url: location.origin + location.pathname, referrer: ref });
    if (location.pathname.indexOf('/services/') === 0 && location.pathname !== '/services/') goal('service_view');
  }
  var style = document.createElement('style');
  style.textContent = [
    '.ss-consent{position:fixed;z-index:10000;left:24px;bottom:24px;width:430px;max-width:calc(100vw - 48px);padding:26px;background:#111;color:#f7f7f7;border:1px solid #333;border-radius:20px;box-shadow:0 18px 70px #0003;font:14px/1.6 var(--ft,system-ui);animation:ss-cookie-in .25s ease-out}',
    '.ss-consent .ss-cookie-label{display:flex;align-items:center;gap:10px;color:#f19b9c;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}.ss-cookie-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#e52124;color:#fff;font-size:20px;letter-spacing:0}',
    '.ss-consent h2{font:800 26px/1.15 var(--fh,system-ui);letter-spacing:-.04em;margin:0 0 12px;max-width:14em}.ss-consent p{margin:0 0 16px;color:#c9c9c9}.ss-consent details{margin:0 0 18px;color:#c9c9c9;font-size:12px}.ss-consent summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px}.ss-consent details p{margin:10px 0 0}',
    '.ss-cookie-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ss-consent button{min-height:46px;padding:10px 12px;border-radius:10px;border:1px solid #777;background:#fff;color:#111;cursor:pointer;font:700 13px/1.3 var(--ft,system-ui);transition:background .2s}.ss-consent .yes{background:#e52124;border-color:#e52124;color:#fff}.ss-consent .yes:hover{background:#c8161c}.ss-consent .no:hover{background:#eaeaea}.ss-consent button:focus-visible,.ss-consent summary:focus-visible{outline:3px solid #fff;outline-offset:4px}',
    '.ss-consent .ss-cookie-note{font-size:11px;color:#aaa;margin:14px 0 0}.ss-analytics-settings{position:fixed;z-index:59;left:20px;bottom:20px;padding:9px 13px;border:1px solid #ddd;border-radius:99px;background:#fffc;color:#444;box-shadow:0 2px 15px #0001;font:600 11px var(--ft,system-ui);cursor:pointer;backdrop-filter:blur(12px)}.ss-analytics-settings[hidden]{display:none}',
    '@keyframes ss-cookie-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media(max-width:600px){.ss-consent{left:12px;bottom:88px;width:calc(100vw - 24px);max-width:none;padding:22px;max-height:calc(100svh - 110px);overflow:auto;border-radius:18px}.ss-consent h2{font-size:24px}.ss-analytics-settings{left:12px;bottom:24px}.ss-cookie-actions{gap:8px}}@media(prefers-reduced-motion:reduce){.ss-consent{animation:none}}'
  ].join('');
  document.head.appendChild(style);
  var panel;
  function show() {
    if (panel) panel.remove();
    panel = document.createElement('section'); panel.className = 'ss-consent'; panel.setAttribute('aria-label', 'Настройки аналитики');
    settings.hidden = true;
    panel.innerHTML = '<div class="ss-cookie-label"><span class="ss-cookie-mark" aria-hidden="true">◌</span>SMART COOKIE</div><h2>Немного cookie.<br>Больше пользы.</h2><p>С вашего разрешения Яндекс Метрика поможет нам понять, что удобно на сайте, а что стоит улучшить.</p><details><summary>Что именно мы собираем</summary><p>Посещения, клики и обезличенные записи действий — Вебвизор. Содержимое полей и переписка с помощником скрыты от записи. До согласия аналитика не загружается.</p></details><div class="ss-cookie-actions"><button class="no" type="button">Только необходимые</button><button class="yes" type="button">Разрешить аналитику</button></div><p class="ss-cookie-note">Без аналитики сайт тоже работает. Выбор можно изменить в Cookie-настройках.</p>';
    panel.querySelector('.yes').onclick = function () { remember('yes'); start(); panel.remove(); panel = null; settings.hidden = false; };
    panel.querySelector('.no').onclick = function () {
      remember('no');
      if (enabled) { enabled = false; window.ym(ID, 'destruct'); panel.remove(); panel = null; location.reload(); }
      else { panel.remove(); panel = null; settings.hidden = false; }
    };
    document.body.appendChild(panel);
  }
  var settings = document.createElement('button'); settings.type = 'button'; settings.className = 'ss-analytics-settings';
  settings.textContent = 'Cookie-настройки'; settings.onclick = show; document.body.appendChild(settings);
  if (stored() === 'yes') start(); else if (stored() !== 'no') show();
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a,button'); if (!el) return;
    if ((el.id === 'as-dock' || el.id === 'as-pin') && el.getAttribute('aria-expanded') === 'true') goal('assistant_open');
    if (el.tagName === 'A') {
      var href = el.getAttribute('href') || '';
      if (/^https:\/\/t\.me\//.test(href)) goal('telegram_click');
    }
  });
  window.addEventListener('ss:form-telegram-open', function () { goal('form_telegram_open'); });
})();
