// The picture in the first screen of every product page: a small interface of our own (styles in illus.css).
// Decorative only — the page says the same in words — so every scene is aria-hidden.
const wb = '<div class="wb"><i></i><i></i><i></i><s></s></div>';
const sk = (w, extra = "") => '<span class="sk' + extra + '" style="width:' + w + '%"></span>';

const S = {
  landing: `<div class="win" style="left:8%;top:9%;right:8%;bottom:13%">${wb}
      <div class="ld"><div class="ld-c">${sk(64, " dk")}${sk(48, " dk")}${sk(78)}${sk(58)}<span class="pill">Оставить заявку</span></div><div class="ld-pic"></div></div>
      <div class="ld-row"><span></span><span></span><span></span></div></div>
    <div class="toast"><span class="ok">✓</span>Новая заявка → Telegram</div>`,

  corporate: `<div class="win" style="left:7%;top:8%;right:16%;bottom:20%">${wb}
      <div class="cp-nav"><b></b><span></span><span></span><span></span><span></span><em></em></div>
      <div class="cp-hero">${sk(58)}${sk(40)}</div>
      <div class="cp-cards"><span></span><span></span><span></span></div></div>
    <div class="win cp-ed"><span class="lbl-d">Панель управления</span><div class="cp-field">О компании<i class="caret"></i></div><span class="pill">Сохранить</span></div>
    <div class="toast"><span class="ok">✓</span>Новость опубликована</div>`,

  shop: `<div class="win" style="left:8%;top:8%;right:8%;bottom:8%">${wb}
      <div class="sh-h"><s></s><span class="cart"><span class="badge"><span><b>1</b><b>2</b><b>3</b></span></span></span></div>
      <div class="sh-g">${'<div class="pr"><i></i>' + sk(80) + "<em></em></div>"}${'<div class="pr"><i></i>' + sk(70) + "<em></em></div>"}${'<div class="pr"><i></i>' + sk(75) + "<em></em></div>"}${'<div class="pr"><i></i>' + sk(66) + "<em></em></div>"}${'<div class="pr"><i></i>' + sk(82) + "<em></em></div>"}${'<div class="pr"><i></i>' + sk(60) + "<em></em></div>"}</div></div>
    <span class="fly"></span>`,

  "web-app": `<div class="win" style="left:7%;top:9%;right:7%;bottom:9%">${wb}
      <div class="wa"><div class="wa-side"><i></i><i></i><i></i><i></i></div>
      <div class="wa-main"><div class="kpi"><span>${sk(70)}<b></b></span><span>${sk(60)}<b></b></span><span>${sk(76)}<b></b></span></div>
        <div class="chart"><i style="height:40%"></i><i style="height:62%"></i><i style="height:48%"></i><i style="height:80%"></i><i style="height:58%"></i><i style="height:92%"></i><i style="height:70%"></i><i style="height:100%"></i></div>
        <div class="row">${sk(60)}<span class="st">Готово</span></div><div class="row">${sk(48)}<span class="st">Готово</span></div></div></div></div>`,

  mobile: `<div class="ph b"><div class="scr"><span class="card r"></span><span class="card"></span><span class="card"></span></div></div>
    <div class="ph a"><div class="scr">${sk(50, " dk")}<span class="card r"></span><span class="card"></span><span class="card"></span><span class="card"></span></div></div>
    <div class="toast note"><span class="ok">✓</span>Заказ готов, можно забирать</div>`,

  desktop: `<div class="win win10"><div class="tb10"><span>—</span><span>☐</span><span>✕</span></div>
      <div class="dk-main">${sk(50, " dk")}<div class="ln">${sk(30)}${sk(30)}</div><div class="ln">${sk(30)}${sk(30)}</div><div class="prog"><i></i></div></div></div>
    <div class="win mac">${wb}<div class="dk"><div class="dk-side"><span></span><span></span><span></span><span></span></div>
      <div class="dk-main">${sk(56, " dk")}<div class="ln">${sk(30)}${sk(30)}${sk(30)}</div><div class="ln">${sk(30)}${sk(30)}${sk(30)}</div><div class="ln">${sk(30)}${sk(30)}${sk(30)}</div></div></div></div>
    <div class="toast"><span class="ok">✓</span>Обновление установлено</div>`,

  "mini-app": `<div class="tg"><div class="tg-h"><i></i>Бот кофейни</div>
      <div class="tg-b"><span class="bub">Здравствуйте! Меню и заказ — по кнопке ниже.</span><span class="open">Открыть меню</span>
        <div class="sheet"><i></i><i></i><i></i><i></i><span class="pill">Оформить заказ</span></div></div></div>`,

  "ai-bot": `<div class="win chat"><div class="ch-h"><i></i>ИИ-бот<em>онлайн</em></div>
      <div class="ch-b"><span class="me s1">Здравствуйте! Есть столик на четверых в субботу?</span>
        <span class="bot s2">Да, в 19:00 свободно. Забронировать?</span>
        <span class="me s3">Да, на имя Анна</span>
        <span class="bot s4">Готово! Ждём вас в субботу в 19:00.</span>
        <span class="bot done s5">✓ Бронь передана администратору</span></div></div>`,

  "ai-automation": `<svg viewBox="0 0 500 400" preserveAspectRatio="none"><path class="flow" d="M160 95 C210 95 210 200 250 200"/><path class="flow" d="M160 150 C210 150 210 200 250 200"/><path class="flow" d="M160 205 C210 205 210 200 250 200"/>
      <path class="flow" d="M250 200 C290 200 290 95 340 95"/><path class="flow" d="M250 200 C290 200 290 150 340 150"/><path class="flow" d="M250 200 C290 200 290 205 340 205"/></svg>
    <div class="col in"><span class="lbl-d">Входящие</span><div class="it"><i></i>Счёт от поставщика</div><div class="it"><i></i>Заявка с сайта</div><div class="it"><i></i>Вопрос клиента</div></div>
    <div class="core">ИИ</div>
    <div class="col out"><span class="lbl-d">Готово</span><div class="it s1"><i></i>Счёт внесён в учёт</div><div class="it s2"><i></i>Задача менеджеру</div><div class="it s3"><i></i>Черновик ответа</div></div>
    <p class="cap lbl-d">Решение остаётся за человеком</p>`,

  integrations: `<svg viewBox="0 0 500 400" preserveAspectRatio="none">
      <path class="ln" d="M250 200 L110 90"/><path class="ln" d="M250 200 L390 90"/><path class="ln" d="M250 200 L80 230"/><path class="ln" d="M250 200 L420 230"/><path class="ln" d="M250 200 L250 340"/>
      <path class="run" d="M110 90 L250 200"/><path class="run" d="M250 200 L390 90"/><path class="run" d="M80 230 L250 200"/><path class="run" d="M250 200 L420 230"/><path class="run" d="M250 340 L250 200"/></svg>
    <div class="node" style="left:22%;top:22.5%"><i></i>Сайт</div><div class="node" style="left:78%;top:22.5%"><i></i>CRM</div>
    <div class="node" style="left:16%;top:57.5%"><i></i>Бот</div><div class="node" style="left:84%;top:57.5%"><i></i>Таблица</div>
    <div class="node" style="left:50%;top:85%"><i></i>Оплата</div><div class="hub">API</div>`,

  crm: `<div class="board">
      <div class="cl"><div class="cl-h">Новые<b>3</b></div><div class="cd">${sk(70)}${sk(45)}</div><div class="cd">${sk(60)}${sk(50)}</div></div>
      <div class="cl"><div class="cl-h">В работе<b>2</b></div><div class="cd">${sk(66)}${sk(40)}</div></div>
      <div class="cl"><div class="cl-h">Готово<b>5</b></div><div class="cd">${sk(72)}${sk(52)}</div><div class="cd">${sk(58)}${sk(44)}</div></div></div>
    <div class="mv">${sk(70)}${sk(48)}</div>`,

  support: `<div class="win mon"><div class="mon-h">Мониторинг<span class="live"><i></i>Всё работает</span></div>
      <div class="bars">${'<i></i>'.repeat(17)}<i class="bad"></i>${'<i></i>'.repeat(12)}</div>
      <div class="log"><span class="s1"><b>✓</b>Сбой формы найден и исправлен</span><span class="s2"><b>✓</b>Сертификат продлён</span><span class="s3"><b>✓</b>Библиотеки обновлены</span><span class="s4"><b>✓</b>Новая функция выпущена</span></div></div>`,
};

module.exports = slug => S[slug] ? '<div class="ill ill-' + slug + '" aria-hidden="true"><div class="ill-in">' + S[slug] + "</div></div>" : "";
