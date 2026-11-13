// 아름나무반 감정일기 — 한 대의 노트북에서 여러 친구가 돌아가며 쓰는 감정일기
// 기록은 이 브라우저의 localStorage 에만 저장됩니다 (인터넷으로 나가지 않음).
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

  const KEY = 'arumnamu-emotion-diary-v1';
  const DEFAULT_KIDS = Array.from({ length: 23 }, (_, i) => `친구 ${i + 1}`);

  // ---------- 저장소 ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.kids ||= []; d.entries ||= {}; d.pin ||= '1234'; d.nextId ||= 1000;
        return d;
      }
    } catch (e) { console.warn(e); }
    return {
      kids: DEFAULT_KIDS.map((name, i) => ({ id: 'k' + (i + 1), name })),
      entries: {}, // { 'YYYY-MM-DD': { kidId: { emotion, weather, text, at } } }
      pin: '1234',
      nextId: 24,
    };
  }
  let db = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { toast('저장하지 못했어요. 선생님께 알려 주세요.'); return false; }
  }

  // ---------- 날짜 ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => ymd(new Date());
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function prettyDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${m}월 ${d}일 ${DAYS[dt.getDay()]}요일`;
  }
  function shiftDate(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return ymd(new Date(y, m - 1, d + n));
  }

  // ---------- 화면 전환 ----------
  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  };

  let current = { kidId: null, emotion: null, weather: null };
  let boardDate = todayKey();
  let teacherOpen = false;

  function show(id) {
    if (id === 'teacher' && !teacherOpen) { $('#pin').value = ''; $('#pinErr').textContent = ''; }
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
    if (id === 'home') renderHome();
    if (id === 'board') renderBoard();
    if (id === 'teacher') renderTeacher();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { show(go.dataset.go); }
  });

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
  }

  const kidName = id => (db.kids.find(k => k.id === id) || {}).name || '(지난 친구)';

  // ---------- 1. 친구 고르기 ----------
  function renderHome() {
    $('#todayLabel').textContent = prettyDate(todayKey());
    const today = db.entries[todayKey()] || {};
    const grid = $('#kidGrid'); grid.innerHTML = '';
    let done = 0;
    db.kids.forEach((k, i) => {
      const ent = today[k.id];
      if (ent) done++;
      grid.append(el('button', { class: 'kid' + (ent ? ' done' : ''), onclick: () => startKid(k.id) },
        el('span', { class: 'num' }, String(i + 1)),
        ent ? el('img', { src: imgOf(ent.emotion), alt: EMO[ent.emotion]?.name || '' })
            : el('span', { class: 'face' }, '🙂'),
        el('span', {}, k.name)));
    });
    $('#doneCount').textContent = `· 오늘 ${done} / ${db.kids.length}명 썼어요`;
  }

  function startKid(kidId) {
    const ent = (db.entries[todayKey()] || {})[kidId];
    current = { kidId, emotion: ent?.emotion || null, weather: ent?.weather || null, text: ent?.text || '' };
    renderPick();
    show('pick');
  }

  // ---------- 2. 감정 고르기 ----------
  function renderPick() {
    $('#pickName').textContent = kidName(current.kidId);
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
    $('#writeName').textContent = kidName(current.kidId);
    $('#writeDate').textContent = prettyDate(todayKey());
    $('#reason').value = current.text || '';
    const w = $('#weather'); w.innerHTML = '';
    WEATHER.forEach(x => {
      w.append(el('button', {
        class: current.weather === x.id ? 'on' : '', title: x.name, 'aria-label': x.name,
        onclick: () => { current.weather = current.weather === x.id ? null : x.id; renderWeatherOnly(); },
        'data-w': x.id,
      }, x.icon));
    });
    setTimeout(() => $('#reason').focus(), 50);
  }
  function renderWeatherOnly() {
    document.querySelectorAll('#weather button').forEach(b => b.classList.toggle('on', b.dataset.w === current.weather));
  }
  $('#reason').addEventListener('input', e => { current.text = e.target.value; });
  $('#changeEmotion').addEventListener('click', () => { renderPick(); show('pick'); });
  $('#backToPick').addEventListener('click', () => { renderPick(); show('pick'); });

  $('#saveBtn').addEventListener('click', () => {
    const day = todayKey();
    db.entries[day] ||= {};
    db.entries[day][current.kidId] = {
      emotion: current.emotion,
      weather: current.weather,
      text: ($('#reason').value || '').trim(),
      at: new Date().toISOString(),
    };
    if (!save()) return;
    $('#doneImg').src = imgOf(current.emotion);
    $('#doneName').textContent = kidName(current.kidId);
    show('done');
  });

  // ---------- 4. 모아보기 ----------
  function tallyChips(list, container) {
    const counts = {};
    list.forEach(ent => { counts[ent.emotion] = (counts[ent.emotion] || 0) + 1; });
    container.innerHTML = '';
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => {
      container.append(el('span', { class: 'chip' },
        el('img', { src: imgOf(id), alt: '' }), EMO[id]?.name || id, ' ', el('b', {}, n + '명')));
    });
  }

  function entryCard(name, ent, onclick) {
    const w = WEATHER.find(x => x.id === ent?.weather);
    if (!ent) {
      return el('button', { class: 'card empty', onclick },
        el('div', { class: 'head' }, el('span', { class: 'name' }, name)),
        el('div', { class: 'meta' }, '아직 안 썼어요'));
    }
    const time = new Date(ent.at);
    return el('button', { class: 'card', onclick },
      el('div', { class: 'head' },
        el('img', { src: imgOf(ent.emotion), alt: '' }),
        el('div', {},
          el('div', { class: 'name' }, name),
          el('div', { class: 'emo-label' }, (EMO[ent.emotion]?.name || '') + (w ? '  ' + w.icon : '')))),
      ent.text ? el('div', { class: 'text' }, ent.text) : null,
      el('div', { class: 'meta' }, `${pad(time.getHours())}:${pad(time.getMinutes())}에 씀`));
  }

  function renderBoard() {
    $('#boardDate').value = boardDate;
    const day = db.entries[boardDate] || {};
    tallyChips(Object.values(day), $('#tally'));
    const grid = $('#boardGrid'); grid.innerHTML = '';
    const shown = new Set();
    db.kids.forEach(k => {
      shown.add(k.id);
      grid.append(entryCard(k.name, day[k.id], () => openKid(k.id)));
    });
    // 이름이 지워진 친구의 기록도 보여주기
    Object.keys(day).filter(id => !shown.has(id)).forEach(id => grid.append(entryCard(kidName(id), day[id], () => openKid(id))));
  }
  $('#boardDate').addEventListener('change', e => { if (e.target.value) { boardDate = e.target.value; renderBoard(); } });
  $('#prevDay').addEventListener('click', () => { boardDate = shiftDate(boardDate, -1); renderBoard(); });
  $('#nextDay').addEventListener('click', () => { boardDate = shiftDate(boardDate, 1); renderBoard(); });
  $('#todayBtn').addEventListener('click', () => { boardDate = todayKey(); renderBoard(); });
  $('#printBtn').addEventListener('click', () => window.print());

  function openKid(kidId) {
    $('#kidTitle').textContent = `${kidName(kidId)}의 감정일기`;
    const days = Object.keys(db.entries).filter(d => db.entries[d][kidId]).sort().reverse();
    const list = days.map(d => ({ d, ...db.entries[d][kidId] }));
    tallyChips(list, $('#kidTally'));
    const box = $('#kidHistory'); box.innerHTML = '';
    if (!list.length) box.append(el('p', { class: 'sub' }, '아직 기록이 없어요.'));
    list.forEach(ent => {
      const w = WEATHER.find(x => x.id === ent.weather);
      box.append(el('div', { class: 'card' },
        el('img', { src: imgOf(ent.emotion), alt: '' }),
        el('div', {},
          el('div', { class: 'meta' }, prettyDate(ent.d) + (w ? '  ' + w.icon : '')),
          el('div', { class: 'name emo-label' }, EMO[ent.emotion]?.name || ''),
          ent.text ? el('div', { class: 'text' }, ent.text) : null)));
    });
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'kid'; });
    window.scrollTo(0, 0);
  }

  // ---------- 5. 선생님 ----------
  function renderTeacher() {
    $('#lockBox').hidden = teacherOpen;
    $('#teacherBox').hidden = !teacherOpen;
    if (teacherOpen) $('#kidNames').value = db.kids.map(k => k.name).join('\n');
    else setTimeout(() => $('#pin').focus(), 50);
  }
  function unlock() {
    if ($('#pin').value === db.pin) { teacherOpen = true; renderTeacher(); }
    else $('#pinErr').textContent = '비밀번호가 달라요.';
  }
  $('#unlockBtn').addEventListener('click', unlock);
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  // 선생님 메뉴를 벗어나면 다시 잠금
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go && go.dataset.go !== 'teacher') teacherOpen = false;
  }, true);

  $('#saveKids').addEventListener('click', () => {
    const names = $('#kidNames').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) { toast('이름을 한 명 이상 적어 주세요.'); return; }
    // 같은 자리(순서)의 친구는 id를 유지해서 기록이 이어지게 함
    const old = db.kids;
    db.kids = names.map((name, i) => {
      const byName = old.find(k => k.name === name);
      if (byName) return { id: byName.id, name };
      if (old[i] && !names.includes(old[i].name)) return { id: old[i].id, name };
      return { id: 'k' + (db.nextId++), name };
    });
    // 중복 id 방지
    const seen = new Set();
    db.kids.forEach(k => { if (seen.has(k.id)) k.id = 'k' + (db.nextId++); seen.add(k.id); });
    save(); toast(`${db.kids.length}명 저장했어요`);
  });

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#exportJson').addEventListener('click', () => {
    download(`아름나무반-감정일기-백업-${todayKey()}.json`, JSON.stringify(db, null, 2), 'application/json');
  });
  $('#importJson').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.kids) || typeof d.entries !== 'object') throw new Error('형식 오류');
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요?')) return;
      db = d; db.pin ||= '1234'; db.nextId ||= 1000; save(); toast('백업을 불러왔어요'); renderTeacher();
    } catch (err) { toast('백업 파일을 읽지 못했어요'); }
    e.target.value = '';
  });
  $('#exportCsv').addEventListener('click', () => {
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const rows = [['날짜', '이름', '감정', '날씨', '이유', '쓴 시각'].map(q).join(',')];
    Object.keys(db.entries).sort().forEach(d => {
      Object.entries(db.entries[d]).forEach(([kid, ent]) => {
        rows.push([d, kidName(kid), EMO[ent.emotion]?.name, WEATHER.find(w => w.id === ent.weather)?.name,
          ent.text, new Date(ent.at).toLocaleTimeString('ko-KR')].map(q).join(','));
      });
    });
    download(`아름나무반-감정일기-${todayKey()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
  });
  $('#savePin').addEventListener('click', () => {
    const p = $('#newPin').value.trim();
    if (p.length < 4) { toast('4자리 이상으로 정해 주세요'); return; }
    db.pin = p; save(); $('#newPin').value = ''; toast('비밀번호를 바꿨어요');
  });
  $('#clearDay').addEventListener('click', () => {
    if (!db.entries[boardDate]) { toast(`${prettyDate(boardDate)} 기록이 없어요`); return; }
    if (!confirm(`${prettyDate(boardDate)} 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return;
    delete db.entries[boardDate]; save(); toast('지웠어요');
  });
  $('#clearAll').addEventListener('click', () => {
    if (!confirm('모든 날짜의 기록을 지울까요? 되돌릴 수 없어요. (먼저 백업을 받아 두세요)')) return;
    db.entries = {}; save(); toast('모든 기록을 지웠어요');
  });

  // 자정이 지나면 첫 화면 날짜 갱신
  setInterval(() => { if (!$('#home').hidden) renderHome(); }, 60 * 1000);

  show('home');
})();
