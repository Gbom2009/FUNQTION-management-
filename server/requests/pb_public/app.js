// Funqtion Requests – guest page. No framework, no tracking, works on 3G.
(function () {
  'use strict';
  var NL = {
    now: 'Nu draaiend', ask: 'Wat moet de dansvloer horen?', search: 'Zoek een nummer of artiest…', more: 'Shout-out of code toevoegen',
    shout: 'Shout-out (optioneel, de DJ keurt eerst goed)', name: 'Je voornaam (optioneel)', prio: 'Code van het bruidspaar (optioneel)',
    shoutHint: 'Geen namen of berichten zonder dat de DJ ze goedkeurt.', top: 'Meest gevraagd', mine: 'Mijn verzoekjes', privacy: 'Privacy',
    request: 'Vraag aan', asked: 'Aangevraagd ✓', merged: 'Stond er al: je stem is erbij geteld ✓', none: 'Nog geen verzoekjes. Jij eerst!',
    noResults: 'Niets gevonden. Vraag het gewoon aan:', free: 'Vraag "{q}" aan', played: 'Gedraaid 🎉', accepted: 'In de wachtrij', later: 'Later vanavond',
    declined: 'Past vanavond niet', new: 'Aangevraagd', paused: 'Even geen verzoekjes', pausedFor: 'Even geen verzoekjes: {l} 💛',
    closed: 'De verzoekjes voor dit feest zijn gesloten. Bedankt!', notFound: 'Deze code kennen we niet. Scan de QR-code nog eens.',
    filtered: 'Dat bericht kunnen we niet plaatsen.', not_tonight: 'Dit nummer past vanavond niet, sorry!', limit: 'Je hebt al genoeg verzoekjes open staan. Even wachten!',
    slow_down: 'Rustig aan 🙂 probeer het zo nog eens.', offline: 'Geen verbinding: we sturen het zodra je weer online bent.', voted: 'Gestemd!', couple: 'Het bruidspaar wil graag:',
  };
  var EN = {
    now: 'Now playing', ask: 'What should the dancefloor hear?', search: 'Search a song or artist…', more: 'Add a shout-out or code',
    shout: 'Shout-out (optional, the DJ approves first)', name: 'Your first name (optional)', prio: "Couple's code (optional)",
    shoutHint: 'No names or messages are shown without the DJ approving them.', top: 'Most requested', mine: 'My requests', privacy: 'Privacy',
    request: 'Request', asked: 'Requested ✓', merged: 'Already on the list: your vote was added ✓', none: 'No requests yet. You go first!',
    noResults: 'Nothing found. Just request it:', free: 'Request "{q}"', played: 'Played 🎉', accepted: 'In the queue', later: 'Later tonight',
    declined: "Doesn't fit tonight", new: 'Requested', paused: 'Requests paused', pausedFor: 'Requests paused: {l} 💛',
    closed: 'Requests for this party are closed. Thank you!', notFound: "We don't know this code. Scan the QR code again.",
    filtered: "We can't post that message.", not_tonight: "This one doesn't fit tonight, sorry!", limit: 'You have enough open requests. Hang on!',
    slow_down: 'Easy 🙂 try again in a moment.', offline: "No connection: we'll send it when you're back online.", voted: 'Voted!', couple: 'The couple would love:',
  };
  var L = /^nl\b/i.test(navigator.language || 'nl') ? NL : EN;
  document.documentElement.lang = L === NL ? 'nl' : 'en';
  var T = function (k, p) { var s = L[k] || k; for (var x in (p || {})) s = s.split('{' + x + '}').join(p[x]); return s; };
  var $ = function (id) { return document.getElementById(id); };
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = T(el.getAttribute('data-t')); });
  $('q').placeholder = T('search');

  var params = new URLSearchParams(location.search);
  var code = (params.get('c') || location.hash.slice(1) || (location.pathname.match(/\/r\/([A-Za-z0-9]+)/) || [])[1] || '').toUpperCase();
  var device = (function () {
    try {
      var d = localStorage.getItem('fq-device');
      if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()) + '-' + Date.now(); localStorage.setItem('fq-device', d); }
      return d;
    } catch (e) { return 'nostore-' + String(Math.random()).slice(2) + '-' + Date.now(); }
  })();
  var session = null, voted = {}, mineIds = {};

  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 3200); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); });
  }

  // Offline queue: requests made without a connection are sent later.
  function queue() { try { return JSON.parse(localStorage.getItem('fq-queue') || '[]'); } catch (e) { return []; } }
  function setQueue(q) { try { localStorage.setItem('fq-queue', JSON.stringify(q)); } catch (e) { /* ignore */ } }
  function flushQueue() {
    var q = queue(); if (!q.length || !navigator.onLine) return;
    setQueue([]);
    q.forEach(function (b) { send(b, true); });
  }
  window.addEventListener('online', flushQueue);

  function send(body, silent) {
    return api('/api/fq/request', body).then(function (r) {
      if (r.id) { if (!silent) toast(r.merged ? T('merged') : T('asked')); mineIds[r.id] = true; voted[r.id] = true; refresh(); return true; }
      if (!silent) toast(T(r.error === 'paused' ? 'paused' : r.error) || T('filtered'));
      return false;
    }).catch(function () { var q = queue(); q.push(body); setQueue(q); if (!silent) toast(T('offline')); });
  }

  function ask(item) {
    send({ c: code, device: device, artist: item.artist, title: item.title, cover: item.cover || '', ref: item.ref || '', explicit: !!item.explicit,
      shoutout: $('shout').value, name: $('name').value, priorityCode: $('prio').value }).then(function (ok) { if (ok) { $('shout').value = ''; $('q').value = ''; $('results').innerHTML = ''; } });
  }

  // Search (debounced; at least 3 letters)
  var st;
  $('q').addEventListener('input', function () {
    clearTimeout(st);
    var q = $('q').value.trim();
    if (q.length < 3) { $('results').innerHTML = ''; return; }
    st = setTimeout(function () {
      api('/api/fq/search?c=' + encodeURIComponent(code) + '&q=' + encodeURIComponent(q)).then(function (r) {
        var box = $('results'); box.innerHTML = '';
        (r.results || []).forEach(function (it) {
          var row = document.createElement('div'); row.className = 'row';
          row.innerHTML = (it.cover ? '<img src="' + esc(it.cover) + '" alt="" loading="lazy">' : '') + '<div class="t"><b>' + esc(it.title) + '</b><span>' + esc(it.artist) + (it.inLibrary ? ' · ✓' : '') + '</span></div>';
          var b = document.createElement('button'); b.className = 'ask'; b.textContent = T('request'); b.onclick = function () { ask(it); };
          row.appendChild(b); box.appendChild(row);
        });
        if (!(r.results || []).length) {
          var p = document.createElement('div'); p.className = 'empty'; p.textContent = T('noResults'); box.appendChild(p);
        }
        var parts = q.split(/\s+-\s+/);
        var free = document.createElement('button'); free.className = 'ask'; free.style.marginTop = '6px'; free.textContent = T('free', { q: q });
        free.onclick = function () { ask(parts.length > 1 ? { artist: parts[0], title: parts.slice(1).join(' - ') } : { artist: '?', title: q }); };
        box.appendChild(free);
      }).catch(function () { /* offline: nothing */ });
    }, 350);
  });

  function vote(id, btn) {
    btn.disabled = true; btn.classList.add('pop'); voted[id] = true;
    var n = btn.querySelector('span'); n.textContent = String(Number(n.textContent) + 1);
    api('/api/fq/vote', { id: id, device: device }).then(function (r) { if (r.votes != null) n.textContent = String(r.votes); }).catch(function () { /* will show on refresh */ });
  }

  function renderTop(items) {
    var box = $('top'); box.innerHTML = '';
    var list = items.filter(function (i) { return i.status !== 'played'; }).concat(items.filter(function (i) { return i.status === 'played'; }));
    list.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'row';
      var badge = it.status === 'played' ? '<span class="badge played">' + T('played') + '</span>' : it.status === 'accepted' ? '<span class="badge">' + T('accepted') + '</span>' : it.status === 'later' ? '<span class="badge">' + T('later') + '</span>' : '';
      row.innerHTML = (it.cover ? '<img src="' + esc(it.cover) + '" alt="" loading="lazy">' : '') + '<div class="t"><b>' + esc(it.title) + '</b><span>' + esc(it.artist) + '</span>' + badge + (it.shoutPublic ? '<span class="shout">“' + esc(it.shoutPublic) + '”</span>' : '') + '</div>';
      var b = document.createElement('button'); b.className = 'vote'; b.innerHTML = '<b>▲</b><span>' + (it.votes || 0) + '</span>';
      b.disabled = !!voted[it.id] || it.status === 'played'; b.onclick = function () { vote(it.id, b); };
      b.setAttribute('aria-label', '+1 ' + it.title);
      row.appendChild(b); box.appendChild(row);
    });
    if (!list.length) box.innerHTML = '<div class="empty">' + T('none') + '</div>';
  }

  function refresh() {
    if (!session) return;
    var f = encodeURIComponent('session="' + session.id + '"');
    api('/api/collections/requests/records?perPage=60&sort=-priority,-votes,created&fields=id,artist,title,cover,votes,status,shoutPublic&filter=' + f)
      .then(function (r) { renderTop(r.items || []); }).catch(function () { /* keep the last list */ });
    api('/api/fq/mine?c=' + encodeURIComponent(code) + '&device=' + encodeURIComponent(device)).then(function (r) {
      (r.voted || []).forEach(function (id) { voted[id] = true; });
      var box = $('mine'); box.innerHTML = '';
      (r.mine || []).forEach(function (m) {
        var row = document.createElement('div'); row.className = 'row';
        row.innerHTML = '<div class="t"><b>' + esc(m.title) + '</b><span>' + esc(m.artist) + '</span></div><span class="badge' + (m.status === 'played' ? ' played' : '') + '">' + T(m.status) + '</span>';
        box.appendChild(row);
      });
      $('mineBox').hidden = !(r.mine || []).length;
    }).catch(function () { /* ignore */ });
  }

  // Live updates via PocketBase realtime (SSE), with polling as a fallback.
  var lastLive = 0, rt;
  function live() {
    if (!window.EventSource || !session) return;
    try { if (rt) rt.close(); } catch (e) { /* ignore */ }
    rt = new EventSource('/api/realtime');
    var topic = 'requests?options=' + encodeURIComponent(JSON.stringify({ query: { filter: 'session="' + session.id + '"', fields: 'id' } }));
    var deb;
    rt.addEventListener('PB_CONNECT', function (ev) {
      var id = JSON.parse(ev.data).clientId;
      fetch('/api/realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id, subscriptions: [topic] }) });
    });
    rt.addEventListener(topic, function () { lastLive = Date.now(); clearTimeout(deb); deb = setTimeout(refresh, 400); });
    rt.onerror = function () { /* the browser reconnects by itself */ };
  }

  function loadSession() {
    if (!code) { $('paused').hidden = false; $('paused').textContent = T('notFound'); return; }
    api('/api/fq/s/' + encodeURIComponent(code)).then(function (s) {
      if (s.__status === 404 || s.__status === 410) { $('paused').hidden = false; $('paused').textContent = s.__status === 410 ? T('closed') : T('notFound'); return; }
      var first = !session;
      session = s;
      $('title').textContent = s.wedding && s.wedding.names ? s.wedding.names : s.title || 'Team Funqtion';
      $('paused').hidden = !s.paused;
      $('paused').textContent = s.pausedLabel ? T('pausedFor', { l: s.pausedLabel }) : T('paused');
      $('now').hidden = !s.nowPlaying;
      if (s.nowPlaying) $('nowText').textContent = ' ' + s.nowPlaying.artist + ' – ' + s.nowPlaying.title;
      $('extra').hidden = !s.allowShoutouts && !s.wedding;
      if (s.wedding && s.wedding.wishes && s.wedding.wishes.length) {
        $('wedding').hidden = false;
        $('wedding').innerHTML = '<span class="small">' + T('couple') + '</span><br><b>' + s.wedding.wishes.map(esc).join(' · ') + '</b>';
      }
      if (first) { refresh(); live(); flushQueue(); }
    }).catch(function () { setTimeout(loadSession, 5000); });
  }

  loadSession();
  setInterval(function () { if (Date.now() - lastLive > 12000) refresh(); }, 15000);
  setInterval(loadSession, 30000);
})();
