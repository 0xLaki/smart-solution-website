/* Assistant «Смарт». The «cursor»: a slim input pill in the corner (the sign, a blinking caret, «Спросите Смарта…», a mic).
   A click, a key or the mic drops out the chat: a panel on the right edge, full height on computers, a sheet from the bottom
   on phones. The whole conversation stays in it, voice messages are marked.
   With the site's server (/api/smart/*, ГигаЧат behind it) the conversation is kept by sessionId in localStorage and comes
   back days later; the server asks for a contact and says when Mikhail can join (canHandoff).
   Without the server (the Vercel preview, a local build) Смарт answers from the site's own words and hands over to Mikhail
   in Telegram or through the contact form. */
(function(){
  var $=function(id){ return document.getElementById(id); };
  var pill=$("as-pill"), panel=$("as-panel");
  if(!pill||!panel) return;
  var pin=$("as-pin"), pinMic=$("as-pin-mic"), ph=$("as-ph"), back=$("as-back"), scroller=$("as-scroll"), thread=$("as-thread"),
      quick=$("as-quick"), aform=$("as-form"), ainput=$("as-input"), mic=$("as-mic"), statusEl=$("as-status"), closeB=$("as-close"),
      foot=$("as-foot"), hintsBtn=$("as-hints"), humanT=$("as-human-t"), humanA=$("as-human-a"), humanB=$("as-human-b"),
      note=$("as-note"), noteT=$("as-note-t"), form=$("form");
  var reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var phone=window.matchMedia("(max-width:760px)"), fine=window.matchMedia("(pointer:fine)");
  var home=document.body.getAttribute("data-page")==="home";
  var TG="https://t.me/michael_welly", API="/api/smart/", TG_WIDGET="https://telegram.org/js/telegram-widget.js?22";
  var PH="Спросите Смарта…";
  function store(kind,key,val){ try{ var s=kind==="l"?localStorage:sessionStorage; if(val===undefined) return s.getItem(key); if(val===null) s.removeItem(key); else s.setItem(key,val); }catch(e){ return null; } }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

  /* ---------- The scripted brain: answers from the site's own words (no server) ---------- */
  var A={
    hello:{text:"Здравствуйте! Я Смарт, помощник Smart Soultion. Подскажу, что мы делаем и с чего начать.",quick:["what","price","time","work","human"]},
    what:{text:"Делаем сайты, приложения, ИИ-ботов и интеграции, а после запуска поддерживаем их.",quick:["site","app","bot","integr"]},
    choose:{text:"Если клиенты пишут в мессенджеры и ждут ответа, начните с ИИ-бота. Если заявок мало или их негде оставить, начните с сайта. Можно и вместе.",quick:["site","bot","human"]},
    site:{text:"Лендинги, сайты компаний, интернет-магазины и личные кабинеты. Заявки с сайта сразу приходят вам.",quick:["price","human"],act:["Обсудить сайт","Сайт"]},
    app:{text:"Мобильные приложения для iPhone и Android, программы для macOS и Windows и мини-приложения в Telegram. Ведём от идеи до публикации.",quick:["price","human"],act:["Обсудить приложение","Приложение"]},
    bot:{text:"ИИ-бот отвечает клиентам круглосуточно в Telegram или на сайте, а сложные вопросы передаёт вам.",quick:["work","price"],act:["Обсудить ИИ-бота","ИИ-бот"]},
    integr:{text:"Связываем сайт и бота с вашей CRM или таблицей: заявки попадают туда сами.",quick:["price","human"],act:["Обсудить интеграцию","Интеграция"]},
    auto:{text:"Нейросеть разбирает письма и заявки, заполняет документы и готовит сводки, а решения остаются за вами.",quick:["price","human"],act:["Обсудить автоматизацию","Интеграция"]},
    price:{text:"Цену назовём после короткого созвона, когда поймём задачу. Начать можно с малого.",quick:["time","human"]},
    time:{text:"Срок зависит от задачи, точно скажем после созвона. Первую версию стараемся показать как можно раньше.",quick:["price","human"]},
    work:{text:'Свои продукты Gustable, Movable, Astor и SnekIT и сайты для VEDAL и C3AG — все на странице <a href="/works/">Работы</a>. Многие проекты под NDA, подробнее расскажем на созвоне.',quick:["human","price"]},
    care:{text:"Берём проект на поддержку: следим, чтобы всё работало, исправляем ошибки и дорабатываем по вашим задачкам.",quick:["price","human"]},
    steps:{text:"Созвон, разбор, прототип, разработка, первая версия и запуск. Каждый шаг согласуем с вами.",quick:["price","human"]},
    human:{text:"Напишите Михаилу в Telegram или оставьте заявку, и мы ответим.",links:true,quick:["what","work"]},
    thanks:{text:"Пожалуйста! Если появятся вопросы, я здесь.",quick:["what","human"]},
    other:{text:"С этим лучше к Михаилу: напишите ему или оставьте заявку.",links:true,quick:["what","price"]}
  };
  var LABEL={what:"Что вы делаете?",price:"Сколько стоит?",time:"Какие сроки?",work:"С кем вы работали?",human:"Связаться с человеком",site:"Сайт",app:"Приложение",bot:"ИИ-бот",integr:"Интеграция"};
  // The question is read for a topic first, so «Привет! Сколько стоит…» gets the price, not just a hello.
  function topic(q){
    if(/цен|стоим|сколько ст|бюджет|прайс|деньг|₽|руб/.test(q)) return "price";
    if(/срок|когда|долго|быстро|врем|сколько.*(дн|недел|месяц)|займет/.test(q)) return "time";
    if(/как.*(работаете|начать)|с чего нач|этап|процесс/.test(q)) return "steps";
    if(/astor|астор|gustable|movable|snekit|c3|с3|vedal|ведал|кейс|пример|портфолио|с кем|клиент|(^|[^а-я])работ[ыа]?([^а-я]|$)/.test(q)) return "work";
    if(/выбра|что лучше|не знаю/.test(q)) return "choose";
    if(/поддерж|сопровожд|доработ|обслуж|сломал|не работает|исправ/.test(q)) return "care";
    if(/приложени|mini ?app|мини.?апп?|(^|[^a-z])app([^a-z]|$)|ios|android|андроид|айфон|iphone|десктоп|программ(а|у|ы|ой)?([^а-я]|$)|windows|виндовс|macos/.test(q)) return "app";
    if(/(^|[^а-я])(бот|чат)|telegram|телеграм/.test(q)) return "bot";
    if(/crm|срм|интеграц|таблиц|amo|битрикс/.test(q)) return "integr";
    if(/автомат|документ|нейросет|(^|[^а-я])ии([^а-я]|$)|gpt/.test(q)) return "auto";
    if(/сайт|лендинг|магазин|каталог|портал|кабинет|корпоратив/.test(q)) return "site";
    if(/человек|менеджер|связ|позвон|телефон|михаил|миш|написать/.test(q)) return "human";
    if(/что.*делает|услуг|чем занима/.test(q)) return "what";
    return ""; }
  function guess(q){ q=" "+q.toLowerCase().replace(/ё/g,"е")+" ";
    var k=topic(q); if(k) return k;
    if(/(^|[^а-я])(привет|здравств|добрый|хай|hello|hi)([^а-яa-z]|$)/.test(q)) return "hello";
    if(/спасиб|благодар/.test(q)) return "thanks";
    return "other"; }
  function botHtml(a){ return a.text+(a.links?' <a href="'+TG+'" target="_blank" rel="noopener">Telegram</a> · <a href="#contact" data-go="#contact">Заявка</a>':""); }

  /* ---------- The server ---------- */
  // JSON in and out. Anything else (the static preview answers 404 with a page) is an error, and no server means the scripted brain.
  function api(path,body,ms){
    var ctl=window.AbortController? new AbortController() : null, timer=setTimeout(function(){ if(ctl) ctl.abort(); },ms||25000);
    return fetch(API+path,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,
      signal:ctl?ctl.signal:undefined,credentials:"same-origin",cache:"no-store"})
      .then(function(r){ return r.json().catch(function(){ return null; }).then(function(d){ clearTimeout(timer);
        if(!r.ok||!d||typeof d!=="object"){ var e=new Error("smart api "+path+" "+r.status); e.status=r.status; e.data=d; throw e; }
        return d; }); },function(e){ clearTimeout(timer); throw e; });
  }
  var mode="", cfg={}, probeP=null, sessionP=null;
  var S={id:store("l","ss-smart-sid")||"",contact:null,tgUser:null,userCount:0,canHandoff:false,handedOff:false,msgs:[]};
  // Once per visit: is there a server behind the site? The answer is kept for the visit, so other pages do not ask again.
  function probe(){
    if(probeP) return probeP;
    var known=store("s","ss-smart-cfg");
    if(known==="local") mode="local";
    else if(known){ try{ cfg=JSON.parse(known)||{}; mode="api"; }catch(e){ known=""; } }
    probeP=(known||!window.fetch? Promise.resolve() : api("config",null,4000).then(function(d){ cfg=d; mode="api"; store("s","ss-smart-cfg",JSON.stringify(d)); }))
      .catch(function(){ toLocal(); })
      .then(function(){ if(!mode) mode="local"; setHuman(); setPh(); });
    return probeP;
  }
  function toLocal(){ mode="local"; store("s","ss-smart-cfg","local"); setHuman(); }
  // The server's copy of the conversation: a new one comes with the server's hello and hints, a known one is restored.
  function session(){
    if(sessionP) return sessionP;
    sessionP=probe().then(function(){
      if(mode!=="api") return;
      return api("session",S.id?{sessionId:S.id}:{},12000).then(apply);
    }).catch(function(e){ if(limited(e)){ sessionP=null; throw e; } toLocal(); });
    return sessionP;
  }
  function apply(d){ if(!d||!d.sessionId) throw new Error("no session");
    S.id=String(d.sessionId); store("l","ss-smart-sid",S.id);
    S.contact=d.contact||null; S.tgUser=d.telegramUser||null; S.userCount=d.userCount||0;
    S.canHandoff=!!d.canHandoff; S.handedOff=!!d.handedOff; S.msgs=d.messages||[]; S.quick=d.quick||[];
    setHuman(); }
  // Too many requests: the server answers 429 with JSON, nginx with a page. The words go back into the field.
  var RATE="Слишком часто. Подождите минуту и отправьте ещё раз.";
  function limited(e){ return !!e&&e.status===429; }
  function hasContact(){ return !!(S.contact||S.tgUser); }
  // Mikhail can join once the server has the contact and enough of the conversation (handoffMin from the config).
  function recheck(){ if(hasContact()&&!S.handedOff&&cfg.handoffMin&&S.userCount>=cfg.handoffMin) S.canHandoff=true; }
  function tgBot(){ var b=cfg&&cfg.telegramBot; return typeof b==="string"&&/^[A-Za-z0-9_]{3,64}$/.test(b)? b : ""; }

  /* ---------- The transcript ---------- */
  var MONTHS=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  var lastDay="";
  function when(at){ var d=at? new Date(typeof at==="number"&&at<1e12? at*1000 : at) : new Date(); return isNaN(d)? new Date() : d; }
  function dayName(d){ var t=new Date(), y=new Date(t.getFullYear(),t.getMonth(),t.getDate()-1);
    if(d.toDateString()===t.toDateString()) return "Сегодня"; if(d.toDateString()===y.toDateString()) return "Вчера";
    return d.getDate()+" "+MONTHS[d.getMonth()]+(d.getFullYear()!==t.getFullYear()?" "+d.getFullYear():""); }
  // A day line before the first message of each day, once the conversation is older than today.
  function dayMark(d){ var key=d.toDateString(); if(key===lastDay) return; var first=!lastDay; lastDay=key;
    if(first&&key===new Date().toDateString()) return;
    var li=document.createElement("li"); li.className="as-day"; li.textContent=dayName(d); thread.appendChild(li); }
  function toBottom(){ requestAnimationFrame(function(){ scroller.scrollTop=scroller.scrollHeight; }); }
  function item(cls,html,at){ var d=when(at); dayMark(d);
    var li=document.createElement("li"); li.className=cls; li.innerHTML=html;
    li.title=d.toLocaleString("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"});
    thread.appendChild(li); toBottom(); return li; }
  var VIA='<span class="as-via"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-mic"/></svg>голосом</span>';
  function addUser(text,via,at){ return item("as-msg you",esc(text)+(via==="voice"?VIA:""),at); }
  function addBot(html,at,who){ return item("as-msg bot",(who?'<span class="as-from">'+esc(who)+"</span>":"")+html,at); }
  function addSys(text){ var li=document.createElement("li"); li.className="as-sys"; li.textContent=text; thread.appendChild(li); toBottom(); return li; }
  function typing(){ var li=document.createElement("li"); li.className="as-msg bot as-typing";
    li.innerHTML='<span class="vh">Смарт печатает</span><i></i><i></i><i></i>'; thread.appendChild(li); toBottom(); return li; }
  // Server text is plain: escape it, then links, **bold**, list dashes and line breaks.
  function fmt(t){ var h=esc(String(t||"").trim());
    h=h.replace(/\*\*([^*\n]+)\*\*/g,"<b>$1</b>");
    h=h.replace(/(^|[\s(])((?:https?:\/\/|t\.me\/)[^\s<)]+)/g,function(m,pre,u){ return pre+'<a href="'+(/^t\.me/.test(u)?"https://"+u:u)+'" target="_blank" rel="noopener">'+u+"</a>"; });
    h=h.replace(/(^|[\s(])(\/(?:services|works|team)\/[a-z0-9\-\/]*)/g,'$1<a href="$2">$2</a>');
    h=h.replace(/^[-*•] /gm,"• ");
    return h.replace(/\n/g,"<br>"); }
  // While a saved conversation is drawn, the screen reader is not made to read all of it out.
  function quietly(fn){ scroller.setAttribute("aria-live","off"); fn(); setTimeout(function(){ scroller.setAttribute("aria-live","polite"); },50); }
  function renderMsg(m){ if(!m||!m.text) return;
    if(m.role==="user") addUser(m.text,m.via,m.at);
    else if(m.role==="bot") addBot(fmt(m.text),m.at);
    else addBot(fmt(m.text),m.at,"Михаил"); }
  // The whole conversation from the server (on return, or after Telegram login joined two devices).
  function redraw(){ thread.innerHTML=""; lastDay=""; quietly(function(){ S.msgs.forEach(renderMsg); }); }
  // Without a server the conversation lives in this visit only (sessionStorage), so it follows the visitor across pages.
  function loadLocal(){ try{ var x=JSON.parse(store("s","ss-smart-local")||"[]"); return Array.isArray(x)? x : []; }catch(e){ return []; } }
  function saveLocal(add){ var x=loadLocal().concat(add).slice(-80); store("s","ss-smart-local",JSON.stringify(x)); }
  function renderLocal(x){ if(x.r==="you") addUser(x.t,x.v,x.at); else addBot(botHtml(A[x.k]||A.other),x.at); }

  /* ---------- Quick hints ---------- */
  function setQuick(list){ quick.innerHTML="";
    (list||[]).forEach(function(c){ var b;
      if(c.href){ b=document.createElement("a"); b.href=c.href; }
      else { b=document.createElement("button"); b.type="button"; b.addEventListener("click",c.run||function(){ ask(c.ask||c.label,"text",c.key); }); }
      b.className="as-chip"; b.textContent=c.label; quick.appendChild(b); });
    toBottom(); }
  function quickFor(a){ var list=(a.quick||[]).map(function(k){ return {label:LABEL[k],key:k}; });
    if(a.act) list.push({label:a.act[0],run:function(){ pick(a.act[1]); }});
    setQuick(list); }
  function chipOf(q){ if(typeof q==="string") return q.trim()? {label:q.trim().slice(0,60)} : null;
    if(q&&typeof q==="object"&&(q.label||q.text)) return {label:String(q.label||q.text).slice(0,60),ask:String(q.text||q.value||q.label)};
    return null; }
  function serverQuick(list){ setQuick((Array.isArray(list)? list : []).map(chipOf).filter(Boolean).slice(0,5)); }

  /* ---------- Asking ---------- */
  var busy=false;
  function ask(text,via,key){ text=String(text||"").trim(); if(!text) return false;
    if(busy){ setStatus("Секунду, Смарт ещё отвечает."); return false; }
    busy=true; setQuick([]);
    var u=null, t=null;
    begin().then(function(){ u=addUser(text,via); t=typing(); return session(); })
      .then(function(){ if(mode==="api") sendApi(text,via,t,u); else answerLocal(key||guess(text),t,text,via); })
      .catch(function(){ busy=false; if(t) t.remove(); if(u) u.remove(); keepWords(text); });
    return true; }
  function keepWords(text){ if(!ainput.value.trim()){ ainput.value=text; syncSend(); } setStatus(RATE,true); }
  function answerLocal(k,t,text,via){
    setTimeout(function(){ t.remove(); var a=A[k]||A.other; addBot(botHtml(a)); quickFor(a);
      saveLocal([{r:"you",t:text,v:via||"text",at:Date.now()},{r:"bot",k:k,at:Date.now()}]); busy=false; },reduce?0:600); }
  function sendApi(text,via,t,u,again){
    api("message",{sessionId:S.id,text:text,via:via||"text"},45000).then(function(d){
      t.remove(); busy=false;
      var r=d.reply||{}; addBot(fmt(r.text||"…")); serverQuick(r.quick);
      if(typeof d.userCount==="number") S.userCount=d.userCount;
      S.canHandoff=!!d.canHandoff;
      // the server stops asking once it has a contact (a phone typed into the chat counts too)
      if(d.askContact===false&&!hasContact()) S.contact={};
      if(hasContact()) dropCard(); else if(d.askContact) contactCard();
      setHuman();
    }).catch(function(e){ t.remove(); busy=false;
      if(limited(e)){ if(u) u.remove(); keepWords(text); return; }
      // the server no longer knows this conversation: start a new one and send again, once
      if(e&&e.status===404&&e.data&&!again){ S.id=""; store("l","ss-smart-sid",null); sessionP=null; busy=true; var t2=typing();
        session().then(function(){ if(mode==="api") sendApi(text,via,t2,u,true); else answerLocal(guess(text),t2,text,via); })
          .catch(function(){ busy=false; t2.remove(); if(u) u.remove(); keepWords(text); }); return; }
      // the route is gone (a page, not JSON): answer from the site's words instead
      if(e&&e.status===404&&!e.data){ toLocal(); busy=true; answerLocal(guess(text),typing(),text,via); return; }
      var li=addBot("Не получилось отправить. Проверьте интернет и попробуйте ещё раз. ");
      li.classList.add("err"); var b=document.createElement("button"); b.type="button"; b.className="as-retry"; b.textContent="Повторить"; li.appendChild(b);
      b.addEventListener("click",function(){ if(busy) return; li.remove(); busy=true; sendApi(text,via,typing(),u); }); });
  }

  /* ---------- Contact: the server asks for it; Telegram login or a name and a phone / Telegram ---------- */
  var cardN=0, pendingHandoff=false;
  function contactCard(){
    var old=thread.querySelector(".as-card"), keep=null;
    if(old){ if(old===thread.lastElementChild) return;
      keep=[].map.call(old.querySelectorAll("input"),function(i){ return i.value; }); old.remove(); }
    var n=++cardN, bot=tgBot(), li=document.createElement("li"); li.className="as-card";
    li.innerHTML='<p class="as-card-h">Как к вам обращаться и куда ответить?</p>'+
      '<p class="as-card-s">Разговор сохранится, и Михаил сможет ответить вам лично.</p>'+
      (bot?'<div class="as-tg" aria-label="Вход через Telegram"></div><p class="as-or">или</p>':"")+
      '<form class="as-cf" novalidate>'+
        '<label class="vh" for="as-cn'+n+'">Имя</label><input id="as-cn'+n+'" type="text" placeholder="Имя" autocomplete="name" maxlength="80">'+
        '<label class="vh" for="as-cw'+n+'">Телефон, Telegram или почта</label><input id="as-cw'+n+'" type="text" placeholder="Телефон, @ник или почта" autocomplete="tel" maxlength="120" aria-describedby="as-ce'+n+'">'+
        '<p class="as-cerr" id="as-ce'+n+'" role="alert" hidden></p>'+
        '<button type="submit" class="as-save">Сохранить контакт</button></form>'+
      '<p class="as-legal">Отправляя контакт, вы соглашаетесь на обработку персональных данных.</p>';
    thread.appendChild(li);
    var f=li.querySelector("form"), inName=f.querySelectorAll("input")[0], inWay=f.querySelectorAll("input")[1], err=f.querySelector(".as-cerr"), save=f.querySelector(".as-save");
    if(keep){ inName.value=keep[0]||""; inWay.value=keep[1]||""; }
    function bad(el,msg){ [inName,inWay].forEach(function(i){ i.removeAttribute("aria-invalid"); }); el.setAttribute("aria-invalid","true"); el.setAttribute("aria-describedby","as-ce"+n); err.textContent=msg; err.hidden=false; el.focus(); }
    [inName,inWay].forEach(function(i){ i.addEventListener("input",function(){ i.removeAttribute("aria-invalid"); err.hidden=true; }); });
    f.addEventListener("submit",function(e){ e.preventDefault();
      var name=inName.value.trim(), way=inWay.value.trim(), c={name:name};
      if(!name){ bad(inName,"Напишите, как к вам обращаться."); return; }
      var tg=way.match(/^(?:https?:\/\/)?t\.me\/([a-z0-9_]{4,32})\/?$/i)||way.match(/^@([a-z0-9_]{4,32})$/i)||way.match(/^([a-z][a-z0-9_]{4,31})$/i);
      if(tg) c.telegram="@"+tg[1];
      else if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(way)) c.email=way;
      else if((way.match(/\d/g)||[]).length>=6&&/^[\d\s()+\-.]+$/.test(way)) c.phone=way;
      else { bad(inWay,way?"Не похоже на телефон, Telegram или почту. Проверьте, пожалуйста.":"Напишите телефон, Telegram или почту."); return; }
      save.disabled=true;
      api("contact",{sessionId:S.id,contact:c},15000).then(function(d){ if(!d.ok) throw 0; S.contact=c;
        contactDone(li,"Контакт сохранён: "+name+", "+(c.telegram||c.email||c.phone)+". Михаил ответит вам лично."); })
        .catch(function(e){ save.disabled=false;
          bad(inWay,limited(e)? RATE : e&&e.status===400? "Не похоже на телефон, Telegram или почту. Проверьте, пожалуйста." : "Не получилось сохранить. Попробуйте ещё раз."); });
    });
    if(bot) loadTg(li.querySelector(".as-tg"),bot);
    toBottom();
  }
  function dropCard(){ var c=thread.querySelector(".as-card"); if(c){ if(c.contains(document.activeElement)) ainput.focus({preventScroll:true}); c.remove(); } }
  function contactDone(card,text){ var focusIn=card&&card.contains(document.activeElement);
    if(card) card.remove(); addSys(text); recheck(); setHuman();
    if(focusIn) ainput.focus({preventScroll:true});
    if(pendingHandoff){ pendingHandoff=false; handoff(); } }
  // The official Telegram Login Widget, loaded only into an open panel and only when the server names its bot.
  function loadTg(box,bot){ var s=document.createElement("script"); s.async=true; s.src=TG_WIDGET;
    s.setAttribute("data-telegram-login",bot); s.setAttribute("data-size","large"); s.setAttribute("data-radius","10");
    s.setAttribute("data-userpic","false"); s.setAttribute("data-request-access","write"); s.setAttribute("data-onauth","SmartTelegramAuth(user)");
    box.appendChild(s); }
  // The same person on another device: the server joins the two conversations, may give another sessionId and the whole
  // conversation back, so it is drawn again from the server's copy.
  window.SmartTelegramAuth=function(user){ if(!S.id||!user) return;
    api("telegram-auth",{sessionId:S.id,auth:user},15000).then(function(d){ if(!d.ok) throw 0;
      if(d.session&&d.session.sessionId) apply(d.session);
      else if(d.sessionId){ S.id=String(d.sessionId); store("l","ss-smart-sid",S.id); }
      S.tgUser=d.user||user;
      if(d.session&&d.session.messages) redraw();
      var nm=[user.first_name,user.last_name].filter(Boolean).join(" ");
      contactDone(thread.querySelector(".as-card"),"Вы вошли через Telegram"+(nm?" как "+nm:"")+". Михаил ответит вам лично."); })
      .catch(function(e){ setStatus(limited(e)? RATE : e&&e.status===503? "Вход через Telegram сейчас недоступен. Оставьте телефон или ник." :
        "Не получилось войти через Telegram. Оставьте телефон или ник.",true); }); };

  /* ---------- Mikhail: joins when the server says the task is collected ---------- */
  var handing=false;
  function setHuman(){
    // no server, or the server cannot reach Mikhail in Telegram: the direct link to him
    var srv=mode==="api"&&!S.direct;
    humanA.hidden=srv; humanB.hidden=!srv||S.handedOff;
    if(!srv){ humanT.textContent="Михаил отвечает в Telegram"; return; }
    if(S.handedOff){ humanT.textContent="Михаил получил разговор и скоро ответит"; return; }
    humanB.setAttribute("aria-disabled",String(!S.canHandoff));
    humanT.textContent=S.canHandoff? "Михаил готов подключиться" : "Михаил подключится, когда соберём задачу";
  }
  var TG_LINK='<a href="'+TG+'" target="_blank" rel="noopener">@michael_welly</a>';
  function handoff(){ if(S.handedOff||handing||!S.id) return; handing=true;
    api("handoff",{sessionId:S.id},20000).then(function(d){ handing=false; if(!d.ok) throw {status:409,data:d};
      S.handedOff=true; S.canHandoff=false; setHuman();
      addBot(d.reply&&d.reply.text? fmt(d.reply.text) : "Передал наш разговор Михаилу. Он ответит вам лично."); })
      .catch(function(e){ handing=false; var d=e&&e.data, st=e&&e.status;
        if(st===409&&d){
          if(d.needContact){ pendingHandoff=true; addBot("Чтобы Михаил мог ответить, оставьте, пожалуйста, контакт."); contactCard(); }
          else { S.canHandoff=false; setHuman(); addBot("Михаил подключится чуть позже. Расскажите ещё немного о задаче, я соберу её для него."); } }
        else if(st===503||st===502){ S.direct=true; setHuman();
          addBot((st===502?"Извините, не получилось передать разговор. ":"")+"Напишите Михаилу напрямую в Telegram: "+TG_LINK); }
        else setStatus(limited(e)? RATE : "Не получилось позвать Михаила. Попробуйте ещё раз.",true); });
  }
  humanB.addEventListener("click",function(){
    if(humanB.getAttribute("aria-disabled")==="true"){ setStatus("Михаил подключится, когда Смарт соберёт задачу. Расскажите о ней подробнее."); return; }
    handoff(); });

  /* ---------- Status line: listening, voice errors, retries ---------- */
  var statusTimer=0;
  function setStatus(text,isErr){ clearTimeout(statusTimer); statusEl.textContent=text||""; statusEl.classList.toggle("err",!!isErr);
    if(text&&text!=="Слушаю…") statusTimer=setTimeout(function(){ statusEl.textContent=""; },7000); }

  /* ---------- Voice: Web Speech API, Russian; interim words go into the field, the final phrase is sent ---------- */
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition, rec=null;
  if(SR&&window.isSecureContext!==false){ mic.hidden=false; pinMic.hidden=false; }
  else SR=null;
  var VOICE_ERR={"not-allowed":"Нет доступа к микрофону. Разрешите его в браузере или напишите текстом.",
    "service-not-allowed":"Голосовой ввод выключен в этом браузере. Напишите текстом.",
    "no-speech":"Не расслышал. Нажмите на микрофон и скажите ещё раз.",
    "audio-capture":"Микрофон не найден. Напишите текстом.",
    "network":"Голосовой ввод сейчас недоступен. Напишите текстом.",
    "language-not-supported":"Браузер не распознаёт русскую речь. Напишите текстом."};
  function listening(on){ panel.classList.toggle("listening",on); pill.classList.toggle("listening",on);
    [mic,pinMic].forEach(function(b){ b.setAttribute("aria-pressed",String(on)); });
    mic.setAttribute("aria-label",on?"Остановить запись":"Сказать голосом");
    ainput.placeholder=on?"Говорите, я слушаю…":PH;
    if(on) setStatus("Слушаю…"); else if(statusEl.textContent==="Слушаю…") setStatus(""); }
  function stopVoice(){ if(rec){ try{ rec.abort(); }catch(e){} rec=null; listening(false); } }
  function listen(){
    if(!SR) return;
    if(rec){ try{ rec.stop(); }catch(e){} return; }
    var r; try{ r=new SR(); }catch(e){ setStatus("Голосовой ввод недоступен. Напишите текстом.",true); return; }
    rec=r; var base=ainput.value.trim(), sent=false;
    r.lang="ru-RU"; r.interimResults=true; r.continuous=false; r.maxAlternatives=1;
    r.onresult=function(e){ var fin="", tmp="";
      for(var i=0;i<e.results.length;i++){ var x=e.results[i]; if(x.isFinal) fin+=x[0].transcript; else tmp+=x[0].transcript; }
      ainput.value=((base?base+" ":"")+(fin+tmp)).trim(); syncSend();
      if(fin.trim()&&!sent){ sent=true; try{ r.stop(); }catch(_){}
        if(ask((base?base+" ":"")+fin.trim(),"voice")){ ainput.value=""; syncSend(); } } };
    r.onerror=function(e){ var m=VOICE_ERR[e.error]; if(rec===r){ rec=null; listening(false); } if(m) setStatus(m,true); };
    r.onend=function(){ if(rec===r){ rec=null; listening(false); } };
    try{ r.start(); listening(true); }catch(e){ rec=null; listening(false); setStatus("Голосовой ввод недоступен. Напишите текстом.",true); }
  }
  mic.addEventListener("click",listen);
  pinMic.addEventListener("click",function(){ openP({focus:"mic"}); listen(); });

  /* ---------- Opening and closing ---------- */
  var open=false, begun=null;
  function greet(){ var a=A.hello; addBot(a.text+(SR?" Можно писать или говорить голосом.":"")); quickFor(a); }
  // The first time the panel opens on a page: the conversation so far. With the server a new conversation already starts
  // with its hello and hints (they are not added here a second time); without it the hello is the site's own.
  function begin(){ if(begun) return begun;
    var local=loadLocal();
    if(local.length){ quietly(function(){ local.forEach(renderLocal); }); return (begun=Promise.resolve()); }
    var t=typing();
    return (begun=session().then(function(){ t.remove();
      if(mode!=="api"||!S.msgs.length){ greet(); return; }
      redraw(); serverQuick(S.quick);
      if(!hasContact()&&S.userCount>0) contactCard(); })
      .catch(function(e){ t.remove(); begun=null; throw e; })); }
  function lock(on){ var p=phone.matches&&on; back.hidden=!p; document.body.classList.toggle("as-lock",p); panel.setAttribute("aria-modal",String(p)); }
  function openP(o){ o=o||{};
    if(!open){ open=true; hideNote(); panel.classList.remove("out"); panel.classList.toggle("still",!!o.still); panel.hidden=false;
      pin.setAttribute("aria-expanded","true"); pill.classList.add("on"); lock(true); store("s","ss-smart-open","1"); fitKeyboard(); }
    begin().catch(function(){ setStatus(RATE,true); });
    if(o.focus==="mic") mic.focus({preventScroll:true});
    else if(o.focus==="input"||(o.focus!==false&&fine.matches)) ainput.focus({preventScroll:true});
    else if(o.focus!==false) closeB.focus({preventScroll:true});
    toBottom(); }
  function closeP(giveBack){ if(!open) return; open=false; stopVoice();
    pin.setAttribute("aria-expanded","false"); pill.classList.remove("on"); lock(false); store("s","ss-smart-open",null);
    if(reduce) panel.hidden=true;
    else { panel.classList.add("out"); setTimeout(function(){ if(!open){ panel.hidden=true; panel.classList.remove("out"); } },200); }
    if(giveBack!==false) pin.focus({preventScroll:true}); }
  pin.addEventListener("click",function(){ if(open) closeP(); else openP({focus:"input"}); });
  // Typing on the pill goes straight into the chat.
  pin.addEventListener("keydown",function(e){ if(e.ctrlKey||e.metaKey||e.altKey||!e.key||e.key.length!==1||e.key===" ") return;
    e.preventDefault(); openP({focus:"input"}); ainput.value+=e.key; syncSend(); });
  back.addEventListener("click",function(){ closeP(); });
  closeB.addEventListener("click",function(){ closeP(); });
  document.addEventListener("keydown",function(e){ if(e.key!=="Escape") return;
    if(rec){ stopVoice(); return; }
    if(open) closeP(); else if(!note.hidden) hideNote(); });
  // On a phone the sheet is modal: Tab goes round inside it.
  panel.addEventListener("keydown",function(e){ if(e.key!=="Tab"||!phone.matches) return;
    var f=[].filter.call(panel.querySelectorAll("button,a[href],input"),function(x){ return !x.disabled&&x.offsetParent!==null; });
    if(!f.length) return; var a=f[0], z=f[f.length-1];
    if(e.shiftKey&&document.activeElement===a){ e.preventDefault(); z.focus(); } else if(!e.shiftKey&&document.activeElement===z){ e.preventDefault(); a.focus(); } });
  window.addEventListener("ss:ask",function(e){ var k=e.detail; openP({}); if(LABEL[k]) ask(LABEL[k],"text",k); });
  function syncSend(){ aform.classList.toggle("has",!!ainput.value.trim()); }
  ainput.addEventListener("input",syncSend);
  aform.addEventListener("submit",function(e){ e.preventDefault(); stopVoice(); if(ask(ainput.value,"text")){ ainput.value=""; syncSend(); } });
  // iOS keeps the layout under the keyboard: the sheet follows the visible part of the screen.
  var vv=window.visualViewport;
  function fitKeyboard(){ if(!vv) return; var kb=open&&phone.matches? Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop)) : 0;
    panel.style.bottom=kb?kb+"px":""; panel.style.maxHeight=kb?Math.round(vv.height-8)+"px":""; }
  (vv||window).addEventListener("resize",function(){ if(open){ fitKeyboard(); toBottom(); } });
  if(vv) vv.addEventListener("scroll",function(){ if(open) fitKeyboard(); });
  if(phone.addEventListener) phone.addEventListener("change",function(){ if(open) lock(true); fitKeyboard(); hintsShown(); });

  /* ---------- Moving around the page from the chat ---------- */
  // Scroll there for real (the hash may already be the same) and put focus there.
  function goTo(hash){
    var el=document.getElementById(hash.slice(1)); if(!el) return; history.pushState(null,"",hash);
    el.scrollIntoView({behavior:reduce?"auto":"smooth"}); var h=el.querySelector("h2"); if(h){ h.setAttribute("tabindex","-1"); setTimeout(function(){ h.focus({preventScroll:true}); },reduce?0:500); } }
  function pick(kind){ closeP(false); goTo("#contact"); if(!form) return;
    var r=[].slice.call(form.querySelectorAll(".choose label")).find(function(l){ return l.textContent.trim()===kind; }); if(r) r.querySelector("input").checked=true;
    setTimeout(function(){ var c=$("f-contact"); if(c) c.focus({preventScroll:true}); },reduce?0:600); }
  thread.addEventListener("click",function(e){ var g=e.target.closest("[data-go]"); if(g){ e.preventDefault(); closeP(false); goTo(g.getAttribute("data-go")); } });

  /* ---------- The pill on phones ---------- */
  // It steps aside while the contact form is on screen, so it never covers the submit button,
  // and shrinks to the sign while the page is scrolled down (it comes back on the way up).
  if(form&&"IntersectionObserver" in window){ new IntersectionObserver(function(es){ es.forEach(function(e){ pill.classList.toggle("away",e.isIntersecting&&phone.matches); }); },{threshold:.15}).observe(form); }
  var lastY=window.scrollY||0;
  window.addEventListener("scroll",function(){ var y=window.scrollY||0, d=y-lastY; if(Math.abs(d)<10) return; lastY=y;
    pill.classList.toggle("mini",phone.matches&&d>0&&y>160); },{passive:true});
  function setPh(){ ph.textContent=mode==="api"&&S.id? "Продолжим разговор…" : PH; }

  /* ---------- Notes: a short line above the pill about the part of the home page on screen ---------- */
  // Three per visit at most, 25 s apart; closing two in a row or the switch silences them. A click asks the question.
  var NOTES=[{id:"services",q:"Что выбрать: сайт или ИИ-бота?",text:"Сайт или ИИ-бот? Помогу выбрать."},
             {id:"apps",q:"С кем вы работали?",text:"Покажу, с кем мы работали и что сделали."},
             {id:"format",q:"Сколько времени займёт проект?",text:"Сколько займёт проект? Расскажу, от чего это зависит."}];
  var seen=(store("s","ss-notes")||"").split(",").filter(Boolean), off=store("l","ss-notes-off")==="1", quiet=store("s","ss-notes-quiet")==="1",
      closed=0, lastAt=Date.now(), noteNow=null, noteAt=null, noteTimer=0, held=false;
  function showNote(n){ noteAt=document.getElementById(n.id); noteNow=n; noteT.textContent=n.text; note.hidden=false; pill.classList.add("has-note");
    seen.push(n.id); store("s","ss-notes",seen.join(",")); lastAt=Date.now(); clearTimeout(noteTimer);
    noteTimer=setTimeout(function wait(){ if(held) noteTimer=setTimeout(wait,2000); else hideNote(); },12000); }
  function hideNote(){ note.hidden=true; pill.classList.remove("has-note"); noteNow=null; noteAt=null; clearTimeout(noteTimer); }
  document.addEventListener("focusin",function(e){ if(note.hidden||note.contains(e.target)) return; var r=e.target.getBoundingClientRect(), q=note.getBoundingClientRect();
    if(r.bottom>q.top&&r.top<q.bottom&&r.right>q.left&&r.left<q.right) hideNote(); });
  note.addEventListener("pointerenter",function(){ held=true; }); note.addEventListener("pointerleave",function(){ held=false; });
  note.addEventListener("focusin",function(){ held=true; }); note.addEventListener("focusout",function(){ held=false; });
  // a note is about the part of the page on screen: once that part has scrolled away, the note goes too
  window.addEventListener("scroll",function(){ if(note.hidden||!noteAt||held) return; var r=noteAt.getBoundingClientRect(); if(r.bottom<innerHeight*.15||r.top>innerHeight*.85) hideNote(); },{passive:true});
  noteT.addEventListener("click",function(){ var n=noteNow; closed=0; hideNote(); openP({}); if(n) ask(n.q,"text"); });
  document.addEventListener("click",function(e){ if(!note.hidden&&!e.target.closest("#as-note,#as-pill")) hideNote(); });
  $("as-note-x").addEventListener("click",function(){ hideNote(); if(++closed>=2){ quiet=true; store("s","ss-notes-quiet","1"); } });
  function setOff(v){ off=v; store("l","ss-notes-off",v?"1":null); hintsBtn.textContent=v?"Показывать подсказки":"Не показывать подсказки"; if(v) hideNote(); }
  hintsBtn.addEventListener("click",function(){ setOff(!off); }); setOff(off);
  // the switch only where notes can come: the home page on a computer
  function hintsShown(){ foot.hidden=!home||phone.matches; } hintsShown();
  setInterval(function(){
    if(off||quiet||phone.matches||open||!note.hidden||document.hidden||seen.length>=3||Date.now()-lastAt<25000||!home) return;
    var H=innerHeight, n=NOTES.find(function(x){ if(seen.indexOf(x.id)>=0) return false; var el=document.getElementById(x.id); if(!el) return false; var r=el.getBoundingClientRect(); return r.top<H*.5&&r.bottom>H*.4; });
    if(n) showNote(n);
  },1500);
  lastAt=Date.now()-17000; // the first note may come about 8 s after the page opens

  /* ---------- On load ---------- */
  setHuman();
  // A returning visitor: find out early whether the server is there, so the pill can offer to go on.
  if(S.id) probe();
  // On a computer the chat stays open from page to page within a visit.
  if(store("s","ss-smart-open")==="1"&&!phone.matches) openP({focus:false,still:true});
})();
