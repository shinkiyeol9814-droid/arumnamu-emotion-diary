// 아름나무반 감정일기 — 노트북 한 대로 친구들이 돌아가며 쓰는 감정일기
// 기록은 구글 시트(앱스 스크립트)에 저장됩니다. 인터넷이 끊기면 노트북에 잠시 보관했다가 다시 올립니다.
(function () {
  'use strict';

  const EMOTIONS = [
    '졸려요', '질투나요', '뿌듯해요', '화나요', '기뻐요',
    '무서워요', '설레요', '자신있어요', '느긋해요', '무기력해요',
    '외로워요', '속상해요', '행복해요', '아쉬워요', '억울해요',
    '든든해요', '놀라요', '서운해요', '감동이에요', '기대돼요',
    '부끄러워요', '두려워요', '편안해요', '그리워요', '불쾌해요',
    '불안해요', '불편해요', '피곤해요', '실망스러워요', '짜증나요',
  ].map((name, i) => ({ id: 'e' + String(i + 1).padStart(2, '0'), name }));
  const EMO = Object.fromEntries(EMOTIONS.map(e => [e.id, e]));
  const imgOf = id => `img/emotions/${id}.webp`;

  const WEATHER = [
    { id: 'sun', icon: '☀️', name: '맑음' },
    { id: 'partly', icon: '⛅', name: '구름 조금' },
    { id: 'cloud', icon: '☁️', name: '흐림' },
    { id: 'rain', icon: '🌧️', name: '비' },
    { id: 'snow', icon: '❄️', name: '눈' },
  ];

  // ---------- 노트북에 보관하는 것 (반 비밀번호, 명단 캐시, 못 보낸 기록) ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('arum.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('arum.' + k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
    del(k) { try { localStorage.removeItem('arum.' + k); } catch (e) { /* 무시 */ } },
  };
  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API_URL = isLocalDev ? '/api' : ((window.APP_CONFIG || {}).API_URL || '');

  let classKey = LS.get('key', '');
  let kids = LS.get('kids', []);           // [{no, name}]
  let pending = LS.get('pending', []);      // 아직 시트에 못 올린 기록
  const dayCache = {};                      // date -> { no: entry }

  // ---------- 서버 호출 ----------
  async function api(action, body = {}) {
    if (!API_URL) throw new Error('no_api');
    const res = await fetch(API_URL, {
      method: 'POST',
      // text/plain 이어야 앱스 스크립트가 CORS 사전요청 없이 받아요
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: classKey, action, ...body }),
      redirect: 'follow',
    });
    const data = await res.json();
    if (!data.ok) { const err = new Error(data.error || 'error'); err.code = data.error; throw err; }
    return data;
  }

  // ---------- 날짜 ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => ymd(new Date());
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const parse = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const prettyDate = key => { const dt = parse(key); return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DAYS[dt.getDay()]}요일`; };
  const nowStamp = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const timeOf = at => (String(at || '').match(/(\d{1,2}):(\d{2})/) || []).slice(1, 3).join(':');

  // ---------- 화면 도우미 ----------
  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  };
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  let loadingCount = 0;
  function loading(on) { loadingCount = Math.max(0, loadingCount + (on ? 1 : -1)); $('#loading').hidden = loadingCount === 0; }

  let current = { no: null, emotion: null, weather: null, text: '' };
  let boardDate = todayKey();
  let calMonth = todayKey().slice(0, 7);

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
    window.scrollTo(0, 0);
    if (id === 'home') renderHome(true);
    if (id === 'board') renderBoard();
    if (id === 'settings') renderSettings();
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
  });

  const kidName = no => (kids.find(k => k.no === String(no)) || {}).name || `${no}번`;

  // 하루 기록 = 시트 기록 + 아직 못 보낸 기록
  function mergedDay(date) {
    const map = Object.assign({}, dayCache[date] || {});
    pending.filter(p => p.date === date).forEach(p => { map[p.no] = Object.assign({}, p, { pending: true }); });
    return map;
  }
  async function loadDay(date) {
    try {
      const { entries } = await api('day', { date });
      dayCache[date] = Object.fromEntries(entries.map(e => [String(e.no), e]));
      return true;
    } catch (e) { handleError(e); return false; }
  }

  function handleError(e) {
    if (e.code === 'bad_key') { toast('반 비밀번호가 맞지 않아요. 설정에서 다시 연결해 주세요.'); show('settings'); }
    else if (e.message !== 'no_api') console.warn(e);
  }

  // ---------- 못 보낸 기록 올리기 ----------
  let flushing = false;
  async function flush() {
    if (flushing || !pending.length || !classKey || !API_URL) return renderStatus();
    flushing = true;
    try {
      const batch = pending.slice();
      await api('save', { entries: batch });
      pending = pending.filter(p => !batch.includes(p));
      LS.set('pending', pending);
      batch.forEach(p => { (dayCache[p.date] ||= {})[p.no] = Object.assign({}, p); });
    } catch (e) { handleError(e); }
    finally { flushing = false; renderStatus(); }
  }
  window.addEventListener('online', flush);
  setInterval(flush, 30 * 1000);

  function renderStatus() {
    const s = $('#syncStatus');
    if (!classKey || !API_URL) { s.hidden = false; s.textContent = '⚙️ 아직 구글 시트에 연결되지 않았어요. 선생님이 "설정"에서 연결해 주세요.'; return; }
    if (pending.length) { s.hidden = false; s.textContent = `📡 인터넷 연결을 기다리는 기록 ${pending.length}개 · 연결되면 자동으로 올라가요`; return; }
    s.hidden = true;
  }

  // ---------- 1. 친구 고르기 ----------
  async function renderHome(refresh) {
    $('#todayLabel').textContent = prettyDate(todayKey());
    renderStatus();
    drawHome();
    if (refresh && classKey && API_URL) {
      if (await loadDay(todayKey())) drawHome();
    }
  }
  function drawHome() {
    const today = mergedDay(todayKey());
    const grid = $('#kidGrid'); grid.innerHTML = '';
    let done = 0;
    if (!kids.length) grid.append(el('p', { class: 'sub' }, '친구 명단을 불러오지 못했어요. 설정을 확인해 주세요.'));
    kids.forEach(k => {
      const ent = today[k.no];
      if (ent) done++;
      grid.append(el('button', { class: 'kid' + (ent ? ' done' : ''), onclick: () => startKid(k.no) },
        el('span', { class: 'num' }, k.no),
        ent ? el('img', { src: imgOf(ent.emotion), alt: EMO[ent.emotion]?.name || '' })
          : el('span', { class: 'face' }, '🙂'),
        el('span', {}, k.name)));
    });
    $('#doneCount').textContent = kids.length ? `· 오늘 ${done} / ${kids.length}명 썼어요` : '';
  }

  function startKid(no) {
    const ent = mergedDay(todayKey())[no];
    current = { no, emotion: ent?.emotion || null, weather: ent?.weather || null, text: ent?.text || '' };
    renderPick();
    show('pick');
  }

  // ---------- 2. 감정 고르기 ----------
  function renderPick() {
    $('#pickName').textContent = kidName(current.no);
    const grid = $('#emotionGrid'); grid.innerHTML = '';
    EMOTIONS.forEach(e => {
      grid.append(el('button', {
        class: 'emo' + (current.emotion === e.id ? ' selected' : ''),
        onclick: () => { current.emotion = e.id; renderWrite(); show('write'); },
      }, el('img', { src: imgOf(e.id), alt: e.name }), el('span', {}, e.name)));
    });
  }

  // ---------- 3. 일기 쓰기 ----------
  function renderWrite() {
    const e = EMO[current.emotion];
    $('#writeEmotionImg').src = imgOf(e.id);
    $('#writeEmotionImg').alt = e.name;
    $('#writeEmotionName').textContent = e.name;
    $('#writeName').textContent = kidName(current.no);
    $('#writeDate').textContent = prettyDate(todayKey());
    $('#reason').value = current.text || '';
    const w = $('#weather'); w.innerHTML = '';
    WEATHER.forEach(x => {
      w.append(el('button', {
        class: current.weather === x.id ? 'on' : '', title: x.name, 'aria-label': x.name, 'data-w': x.id,
        onclick: () => {
          current.weather = current.weather === x.id ? null : x.id;
          w.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.w === current.weather));
        },
      }, x.icon));
    });
    setTimeout(() => $('#reason').focus(), 50);
  }
  $('#reason').addEventListener('input', e => { current.text = e.target.value; });
  $('#changeEmotion').addEventListener('click', () => { renderPick(); show('pick'); });
  $('#backToPick').addEventListener('click', () => { renderPick(); show('pick'); });

  $('#saveBtn').addEventListener('click', async () => {
    const entry = {
      date: todayKey(), no: current.no, name: kidName(current.no),
      emotion: current.emotion, weather: current.weather,
      text: ($('#reason').value || '').trim(), at: nowStamp(),
    };
    // 먼저 노트북에 보관 → 바로 완료 화면 → 뒤에서 시트로 올림
    pending = pending.filter(p => !(p.date === entry.date && p.no === entry.no));
    pending.push(entry);
    LS.set('pending', pending);
    $('#doneImg').src = imgOf(entry.emotion);
    $('#doneName').textContent = kidName(entry.no);
    $('#doneNote').textContent = '저장하는 중…';
    show('done');
    await flush();
    $('#doneNote').textContent = pending.includes(entry)
      ? '인터넷이 연결되면 자동으로 저장돼요. 다음 친구에게 넘겨 주세요 🌱'
      : '일기가 저장되었어요. 다음 친구에게 넘겨 주세요 🌱';
  });

  // ---------- 4. 모아보기 (달력 + 하루 기록) ----------
  function tallyChips(list, container) {
    const counts = {};
    list.forEach(ent => { if (EMO[ent.emotion]) counts[ent.emotion] = (counts[ent.emotion] || 0) + 1; });
    container.innerHTML = '';
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => {
      container.append(el('span', { class: 'chip' },
        el('img', { src: imgOf(id), alt: '' }), EMO[id].name, ' ', el('b', {}, n + '명')));
    });
  }

  function entryCard(name, ent, onclick) {
    if (!ent) {
      return el('button', { class: 'card empty', onclick },
        el('div', { class: 'head' }, el('span', { class: 'name' }, name)),
        el('div', { class: 'meta' }, '아직 안 썼어요'));
    }
    const w = WEATHER.find(x => x.id === ent.weather);
    const t = timeOf(ent.at);
    return el('button', { class: 'card', onclick },
      el('div', { class: 'head' },
        el('img', { src: imgOf(ent.emotion), alt: '' }),
        el('div', {},
          el('div', { class: 'name' }, name),
          el('div', { class: 'emo-label' }, (EMO[ent.emotion]?.name || '') + (w ? '  ' + w.icon : '')))),
      ent.text ? el('div', { class: 'text' }, ent.text) : null,
      el('div', { class: 'meta' }, (t ? `${t}에 씀` : '') + (ent.pending ? ' · 📡 올리는 중' : '')));
  }

  const monthCounts = {}; // 'YYYY-MM' -> { date: n }
  async function loadMonth(month) {
    try { monthCounts[month] = (await api('month', { month })).days; } catch (e) { handleError(e); }
  }
  function drawCalendar() {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const counts = monthCounts[calMonth] || {};
    const cal = $('#calendar'); cal.innerHTML = '';
    const head = el('div', { class: 'cal-head' },
      el('button', { class: 'btn small ghost', onclick: () => moveMonth(-1) }, '◀'),
      el('b', {}, `${y}년 ${m}월`),
      el('button', { class: 'btn small ghost', onclick: () => moveMonth(1) }, '▶'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn small ghost', onclick: () => pickDate(todayKey()) }, '오늘'),
      el('button', { class: 'btn small ghost', onclick: () => window.print() }, '🖨️ 인쇄'));
    const grid = el('div', { class: 'cal-grid' });
    DAYS.forEach((d, i) => grid.append(el('div', { class: 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, d)));
    for (let i = 0; i < first.getDay(); i++) grid.append(el('div'));
    for (let d = 1; d <= daysIn; d++) {
      const key = `${calMonth}-${pad(d)}`;
      const n = counts[key] || 0;
      const cls = ['cal-day'];
      if (key === boardDate) cls.push('sel');
      if (key === todayKey()) cls.push('today');
      if (n) cls.push('has');
      grid.append(el('button', { class: cls.join(' '), onclick: () => pickDate(key) },
        el('span', {}, String(d)), n ? el('small', {}, `${n}명`) : null));
    }
    cal.append(head, grid);
  }
  async function moveMonth(n) {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    drawCalendar();
    loading(true); await loadMonth(calMonth); loading(false);
    drawCalendar();
  }
  async function pickDate(key) {
    boardDate = key;
    calMonth = key.slice(0, 7);
    drawCalendar(); drawBoardDay();
    loading(true);
    await Promise.all([loadDay(key), monthCounts[calMonth] ? null : loadMonth(calMonth)]);
    loading(false);
    drawCalendar(); drawBoardDay();
  }
  function drawBoardDay() {
    $('#boardTitle').textContent = prettyDate(boardDate);
    const day = mergedDay(boardDate);
    tallyChips(Object.values(day), $('#tally'));
    const grid = $('#boardGrid'); grid.innerHTML = '';
    const shown = new Set();
    kids.forEach(k => { shown.add(k.no); grid.append(entryCard(k.name, day[k.no], () => openKid(k.no))); });
    Object.keys(day).filter(no => !shown.has(no))
      .forEach(no => grid.append(entryCard(day[no].name || kidName(no), day[no], () => openKid(no))));
  }
  async function renderBoard() {
    drawCalendar(); drawBoardDay();
    loading(true);
    await Promise.all([loadDay(boardDate), loadMonth(calMonth)]);
    loading(false);
    drawCalendar(); drawBoardDay();
  }

  async function openKid(no) {
    $('#kidTitle').textContent = `${kidName(no)}의 감정일기`;
    $('#kidTally').innerHTML = ''; $('#kidHistory').innerHTML = '';
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'kid'; });
    window.scrollTo(0, 0);
    loading(true);
    let list = [];
    try { list = (await api('kid', { no })).entries; } catch (e) { handleError(e); }
    loading(false);
    pending.filter(p => p.no === no).forEach(p => {
      list = list.filter(x => x.date !== p.date); list.push(Object.assign({ pending: true }, p));
    });
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    tallyChips(list, $('#kidTally'));
    const box = $('#kidHistory');
    if (!list.length) box.append(el('p', { class: 'sub' }, '아직 기록이 없어요.'));
    list.forEach(ent => {
      const w = WEATHER.find(x => x.id === ent.weather);
      box.append(el('div', { class: 'card' },
        el('img', { src: imgOf(ent.emotion), alt: '' }),
        el('div', {},
          el('div', { class: 'meta' }, prettyDate(ent.date) + (w ? '  ' + w.icon : '')),
          el('div', { class: 'name emo-label' }, EMO[ent.emotion]?.name || ''),
          ent.text ? el('div', { class: 'text' }, ent.text) : null)));
    });
  }

  // ---------- 설정 (구글 시트 연결) ----------
  function renderSettings() {
    $('#classKey').value = '';
    $('#connectErr').textContent = '';
    $('#connectInfo').textContent = !API_URL
      ? '⚠️ config.js 에 앱스 스크립트 주소(API_URL)가 아직 없어요. SETUP.md 를 보세요.'
      : classKey ? `✅ 연결됨 · 친구 ${kids.length}명` : '아직 연결되지 않았어요.';
  }
  async function connect() {
    const key = $('#classKey').value.trim();
    if (!key) return;
    const prev = classKey; classKey = key;
    loading(true);
    try {
      const data = await api('init', { date: todayKey() });
      kids = data.kids; LS.set('kids', kids); LS.set('key', classKey);
      dayCache[todayKey()] = Object.fromEntries(data.entries.map(e => [String(e.no), e]));
      toast(`연결됐어요! 친구 ${kids.length}명`);
      flush();
      show('home');
    } catch (e) {
      classKey = prev;
      $('#connectErr').textContent = e.code === 'bad_key' ? '반 비밀번호가 달라요.' : '연결하지 못했어요. 인터넷과 주소를 확인해 주세요.';
    } finally { loading(false); }
  }
  $('#connectBtn').addEventListener('click', connect);
  $('#classKey').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('#disconnectBtn').addEventListener('click', () => {
    if (pending.length && !confirm(`아직 올라가지 않은 기록 ${pending.length}개가 있어요. 그래도 연결을 해제할까요?`)) return;
    classKey = ''; LS.del('key'); renderSettings(); renderStatus(); toast('연결을 해제했어요');
  });
  $('#reloadBtn').addEventListener('click', () => location.reload());

  // 명단 새로 받기 (시트의 친구목록을 고치면 반영)
  async function refreshKids() {
    try {
      const data = await api('init', { date: todayKey() });
      kids = data.kids; LS.set('kids', kids);
      dayCache[todayKey()] = Object.fromEntries(data.entries.map(e => [String(e.no), e]));
      if (!$('#home').hidden) drawHome();
    } catch (e) { handleError(e); }
  }

  // 첫 화면에 머무는 동안 1분마다 오늘 기록·날짜 갱신
  setInterval(() => { if (!$('#home').hidden) renderHome(true); }, 60 * 1000);

  if (!classKey || !API_URL) show('settings');
  else { show('home'); refreshKids(); flush(); }
})();
