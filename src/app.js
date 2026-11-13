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

  const ymdNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- 노트북에 보관하는 것 (반 비밀번호, 명단 캐시, 못 보낸 기록) ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('arum.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('arum.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('arum.' + k); } catch (e) { /* 무시 */ } },
  };
  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API_URL = isLocalDev ? '/api' : ((window.APP_CONFIG || {}).API_URL || '');

  // apps-script/Code.gs 의 SERVER_VERSION 과 맞춤 (2 = 사진 기능)
  const NEED_SERVER_VERSION = 2;
  let serverVersion = null;        // 마지막 응답의 서버 버전 (예전 Code.gs 는 버전이 없어서 1로 봄)
  let homeLoadFailed = false;

  let classKey = LS.get('key', '');
  let kids = LS.get('kids', []);           // [{no, name}]
  let pending = LS.get('pending', []);      // 아직 시트에 못 올린 기록
  const dayCache = {};                      // date -> { no: entry }
  // 오늘 기록은 기기에도 보관 → 앱을 열자마자 ✔ 표시 (서버 응답은 뒤에 와서 갱신)
  // 날짜별 기록·친구별 기록·월 인원도 기기에 보관 → 화면을 바로 그리고, 서버 응답으로 갱신
  const slimEnt = e => { const c = Object.assign({}, e); delete c.thumbData; delete c.photoData; delete c.pending; return c; };
  const savedDays = LS.get('days', {});          // date -> { no: entry }  (최근 40일)
  Object.assign(dayCache, savedDays);
  const kidHist = LS.get('kidHist', {});         // no -> [entry]
  function setDay(date, map) {
    dayCache[date] = map;
    const slim = {};
    for (const [no, e] of Object.entries(map)) slim[no] = slimEnt(e);
    savedDays[date] = slim;
    Object.keys(savedDays).sort().reverse().slice(40).forEach(d => delete savedDays[d]);
    LS.set('days', savedDays);
  }
  function setKidHist(no, list) {
    kidHist[no] = list.slice(0, 120).map(slimEnt);
    LS.set('kidHist', kidHist);
  }
  const toMap = entries => Object.fromEntries(entries.map(e => [String(e.no), e]));

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
    serverVersion = data.version || 1;
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

  // ---------- 뒤로가기(휴대폰 < 버튼) ----------
  // 화면을 옮길 때마다 브라우저 기록에 남겨서, < 를 누르면 앱이 꺼지지 않고 이전 화면으로 감.
  // 맨 처음 화면에서 < 를 누르면 "한 번 더 누르면 나가요" 안내 후, 2초 안에 한 번 더 눌러야 나감.
  let curScreen = null;
  let curDepth = 0;
  let goingHome = false;
  let lastGuard = 0;
  function pushScreen(st) {
    curDepth += 1;
    history.pushState(Object.assign({ depth: curDepth }, st), '');
  }
  window.addEventListener('popstate', e => {
    let st = e.state || { screen: 'home', depth: 0, guard: true };
    // 사진 크게 보기가 열려 있으면 닫기만
    if (!$('#viewer').hidden) { $('#viewer').hidden = true; curDepth = st.depth || 0; if (st.screen === curScreen && !st.guard) return; }
    if (st.viewer) { history.back(); return; }
    if (st.guard) {
      if (Date.now() - lastGuard < 2000) { history.back(); return; } // 정말 나가기
      lastGuard = Date.now();
      toast('한 번 더 누르면 앱에서 나가요');
      curDepth = 1;
      history.pushState({ screen: curScreen || 'home', depth: 1, no: st.no }, '');
      return;
    }
    curDepth = st.depth || 1;
    if (goingHome) {
      goingHome = false;
      if (st.screen !== 'home') { history.replaceState({ screen: 'home', depth: curDepth }, ''); st = { screen: 'home' }; }
    }
    if (st.screen === 'kid') openKid(st.no, { fromHistory: true });
    else if (st.screen !== curScreen) show(st.screen, { fromHistory: true });
  });

  function show(id, opts = {}) {
    if (!opts.fromHistory) {
      if (opts.initial) {
        history.replaceState({ screen: 'home', depth: 0, guard: true }, '');
        curDepth = 0; pushScreen({ screen: id });
      } else if (id === 'home' && curDepth > 1) {
        // 쌓인 화면을 한 번에 되돌아가 첫 화면으로 (뒤로가기 기록이 끝없이 쌓이지 않게)
        goingHome = true; history.go(-(curDepth - 1)); return;
      } else if (opts.replace || (id === 'home' && curDepth <= 1)) {
        curDepth = Math.max(curDepth, 1);
        history.replaceState({ screen: id, depth: curDepth }, '');
      } else if (id !== curScreen) {
        pushScreen({ screen: id });
      }
    }
    curScreen = id;
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
    window.scrollTo(0, 0);
    if (id === 'home') renderHome(opts.refresh !== false);
    if (id === 'board') renderBoard();
    if (id === 'settings') renderSettings();
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
  });

  // 설정 화면은 아이들에게 숨김: 로고를 2.5초 안에 5번 누르면 열림 (관리자용)
  let logoTaps = [];
  $('.brand').addEventListener('click', () => {
    const now = Date.now();
    logoTaps = logoTaps.filter(t => now - t < 2500);
    logoTaps.push(now);
    if (logoTaps.length >= 5) { logoTaps = []; setTimeout(() => show('settings'), 0); }
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
      setDay(date, toMap(entries));
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
      const res = await api('save', { entries: batch });
      pending = pending.filter(p => !batch.includes(p));
      LS.set('pending', pending);
      const lostPhoto = batch.some(p => p.photoData) && !(res.items || []).some(x => x.photoId);
      if (lostPhoto) toast('⚠️ 글은 저장됐지만 사진은 저장되지 않았어요. 구글 Apps Script를 새 버전으로 배포해야 해요.');
      batch.forEach(p => {
        const done = (res.items || []).find(x => x.date === p.date && String(x.no) === String(p.no)) || {};
        const ent = Object.assign({}, p, { photoId: done.photoId || null, thumbId: done.thumbId || null });
        delete ent.photoData; delete ent.photoRemove;
        setDay(p.date, Object.assign({}, dayCache[p.date] || {}, { [p.no]: ent })); // thumbData 는 화면 표시용
        // 방금 올린 사진은 기기 사진 보관함에 넣어 두면 다시 받을 필요가 없음
        if (done.photoId && p.photoData) photoStore.set(done.photoId, p.photoData);
        if (done.thumbId && p.thumbData) photoStore.set(done.thumbId, p.thumbData);
      });
    } catch (e) { handleError(e); }
    finally { flushing = false; renderStatus(); }
  }
  window.addEventListener('online', flush);
  setInterval(flush, 30 * 1000);

  function renderStatus() {
    const s = $('#syncStatus');
    if (!classKey || !API_URL) { s.hidden = false; s.textContent = '⚙️ 아직 구글 시트에 연결되지 않았어요. 선생님이 "설정"에서 연결해 주세요.'; return; }
    if (serverVersion !== null && serverVersion < NEED_SERVER_VERSION) {
      s.hidden = false;
      s.textContent = '⚠️ 구글 Apps Script가 예전 버전이라 사진이 저장되지 않아요. 선생님: 배포 관리 → ✏️ → 새 버전으로 배포해 주세요.';
      return;
    }
    if (homeLoadFailed) { s.hidden = false; s.textContent = '📡 오늘 기록을 불러오지 못했어요. 인터넷을 확인해 주세요.'; return; }
    if (pending.length) { s.hidden = false; s.textContent = `📡 인터넷 연결을 기다리는 기록 ${pending.length}개 · 연결되면 자동으로 올라가요`; return; }
    s.hidden = true;
  }

  // ---------- 1. 친구 고르기 ----------
  async function renderHome(refresh) {
    $('#todayLabel').textContent = prettyDate(todayKey());
    renderStatus();
    drawHome();
    if (refresh && classKey && API_URL) {
      homeLoadFailed = !(await loadDay(todayKey()));
      drawHome(); renderStatus();
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
    current = {
      no, emotion: ent?.emotion || null, weather: ent?.weather || null, text: ent?.text || '',
      photoId: ent?.photoId || null, thumbId: ent?.thumbId || null,
      photoData: ent?.photoData || null, thumbData: ent?.thumbData || null, photoRemove: false,
    };
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
    renderPhoto();
    setTimeout(() => $('#reason').focus(), 50);
  }

  // ---------- 사진 ----------
  // 사진 ID 는 바뀌지 않으므로(새 사진 = 새 ID) 한 번 받은 사진은 기기에 계속 보관
  const photoStore = (() => {
    let dbp = null;
    const open = () => (dbp ||= new Promise((ok, bad) => {
      const r = indexedDB.open('arum-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    }));
    return {
      async get(id) {
        try {
          const db = await open();
          return await new Promise(ok => { const q = db.transaction('p').objectStore('p').get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
        } catch (e) { return null; }
      },
      async set(id, data) { try { (await open()).transaction('p', 'readwrite').objectStore('p').put(data, id); } catch (e) { /* 무시 */ } },
    };
  })();
  const photoCache = new Map(); // id -> Promise<dataURL>
  function photoSrc(id) {
    if (!photoCache.has(id)) {
      photoCache.set(id, (async () => {
        const saved = await photoStore.get(id);
        if (saved) return saved;
        const data = (await api('photo', { id })).data;
        photoStore.set(id, data);
        return data;
      })().catch(e => { photoCache.delete(id); throw e; }));
    }
    return photoCache.get(id);
  }
  // 화면에 나온 사진의 큰 사진을 뒤에서 미리 받아 둠 (2개씩) → 눌렀을 때 바로 열림
  const prefetchQueue = [];
  let prefetching = 0;
  function prefetchFull(ents) {
    if (navigator.connection && navigator.connection.saveData) return;
    ents.forEach(e => { if (e && e.photoId && e.photoId !== e.thumbId && !photoCache.has(e.photoId) && !prefetchQueue.includes(e.photoId)) prefetchQueue.push(e.photoId); });
    pump();
  }
  function pump() {
    while (prefetching < 2 && prefetchQueue.length) {
      const id = prefetchQueue.shift(); prefetching++;
      photoSrc(id).catch(() => {}).finally(() => { prefetching--; pump(); });
    }
  }
  const hasPhoto = ent => !!(ent && (ent.thumbData || ent.photoData || ent.thumbId || ent.photoId));
  // 사진 img: 이미 있는 data 면 바로, 아니면 서버에서 받아서
  function photoImg(ent, cls) {
    if (!hasPhoto(ent)) return null;
    const img = el('img', { class: cls, alt: '사진' });
    const data = ent.thumbData || ent.photoData;
    const id = ent.thumbId || ent.photoId;
    if (data) img.src = data;
    else photoSrc(id).then(src => { img.src = src; }).catch(() => {
      img.replaceWith(el('div', { class: 'photo-missing' }, '📷 사진을 불러오지 못했어요'));
    });
    return img;
  }
  let viewerToken = 0;
  function openViewer(ent) {
    const v = $('#viewer'); const img = $('#viewerImg');
    const token = ++viewerToken;
    let gotFull = false;
    img.removeAttribute('src');
    if (v.hidden) pushScreen(Object.assign({}, history.state, { viewer: true }));
    v.hidden = false;
    if (ent.photoData) { img.src = ent.photoData; return; }
    // 1) 작은 사진을 먼저 크게 띄우고 (보통 이미 받아 둠) 2) 큰 사진이 오면 바꿔 끼움
    if (ent.thumbData) img.src = ent.thumbData;
    else if (ent.thumbId) photoSrc(ent.thumbId).then(s => { if (token === viewerToken && !gotFull) img.src = s; }).catch(() => {});
    const id = ent.photoId || ent.thumbId;
    if (!id) return;
    loading(true);
    photoSrc(id).then(s => { gotFull = true; if (token === viewerToken) img.src = s; })
      .catch(() => toast('사진을 불러오지 못했어요')).finally(() => loading(false));
  }
  $('#viewer').addEventListener('click', () => { history.back(); }); // popstate 에서 닫힘

  function renderPhoto() {
    const box = $('#photoPreview'); const img = $('#photoImg');
    const on = hasPhoto(current) && !current.photoRemove;
    box.hidden = !on;
    $('.photo-btn').firstChild.textContent = on ? '📷 사진 바꾸기' : '📷 사진 올리기';
    img.removeAttribute('src');
    if (!on) return;
    if (current.thumbData) img.src = current.thumbData;
    else photoSrc(current.thumbId || current.photoId).then(s => { img.src = s; }).catch(() => {});
  }

  // 사진 줄이기 (긴 변 max px, JPEG)
  async function shrink(file, max, quality) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      src = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
    }
    const w0 = src.width, h0 = src.height, k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  $('#photoInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요'); return; }
    loading(true);
    try {
      current.photoData = await shrink(f, 1280, 0.8);
      current.thumbData = await shrink(f, 360, 0.75);
      current.photoRemove = false;
      renderPhoto();
    } catch (err) { toast('사진을 읽지 못했어요'); }
    finally { loading(false); }
  });
  $('#photoImg').addEventListener('click', () => openViewer(current));
  $('#photoDel').addEventListener('click', () => {
    current.photoData = null; current.thumbData = null;
    if (current.photoId || current.thumbId) current.photoRemove = true;
    renderPhoto();
  });

  $('#reason').addEventListener('input', e => { current.text = e.target.value; });
  const backToPick = () => { renderPick(); history.back(); };
  $('#changeEmotion').addEventListener('click', backToPick);
  $('#backToPick').addEventListener('click', backToPick);

  $('#saveBtn').addEventListener('click', async () => {
    const entry = {
      date: todayKey(), no: current.no, name: kidName(current.no),
      emotion: current.emotion, weather: current.weather,
      text: ($('#reason').value || '').trim(), at: nowStamp(),
    };
    if (current.photoData) { entry.photoData = current.photoData; entry.thumbData = current.thumbData; }
    else if (current.photoRemove) entry.photoRemove = true;
    else if (current.photoId) { entry.photoId = current.photoId; entry.thumbId = current.thumbId; }
    // 먼저 노트북에 보관 → 바로 완료 화면 → 뒤에서 시트로 올림
    pending = pending.filter(p => !(p.date === entry.date && p.no === entry.no));
    pending.push(entry);
    // 사진이 커서 노트북에 임시 보관을 못 하면, 바로 올리기만 시도함
    if (!LS.set('pending', pending)) console.warn('pending 보관 실패(용량)');
    // 친구별 기록 사본에도 바로 반영
    if (kidHist[entry.no]) setKidHist(entry.no, [slimEnt(entry)].concat(kidHist[entry.no].filter(x => x.date !== entry.date)));
    $('#doneImg').src = imgOf(entry.emotion);
    $('#doneName').textContent = kidName(entry.no);
    // 기록은 이미 기기에 안전하게 보관됨 → 아이는 바로 다음 친구에게. 구글 시트 저장은 뒤에서.
    $('#doneNote').textContent = '다음 친구에게 넘겨 주세요 🌱';
    const sync = $('#doneSync');
    sync.className = 'done-sync'; sync.textContent = entry.photoData ? '☁️ 사진과 함께 올리는 중…' : '☁️ 올리는 중…';
    show('done', { replace: true });
    await flush();
    if (pending.includes(entry)) { sync.className = 'done-sync wait'; sync.textContent = '📡 인터넷이 연결되면 자동으로 올라가요'; }
    else { sync.className = 'done-sync ok'; sync.textContent = '✅ 구글 시트에 저장됐어요'; }
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

  function cardPhoto(ent) {
    const img = photoImg(ent, 'card-photo');
    if (img) img.addEventListener('click', ev => { ev.stopPropagation(); openViewer(ent); });
    return img;
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
      cardPhoto(ent),
      el('div', { class: 'meta' }, (t ? `${t}에 씀` : '') + (ent.pending ? ' · 📡 올리는 중' : '')));
  }

  const monthCounts = LS.get('months', {}); // 'YYYY-MM' -> { date: n }
  async function loadMonth(month) {
    try {
      monthCounts[month] = (await api('month', { month })).days;
      LS.set('months', monthCounts);
    } catch (e) { handleError(e); }
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
      el('button', { class: 'btn small ghost print-btn', onclick: () => window.print() }, '🖨️ 인쇄'));
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
    prefetchFull(Object.values(day));
  }
  async function renderBoard() {
    drawCalendar(); drawBoardDay();
    loading(true);
    await Promise.all([loadDay(boardDate), loadMonth(calMonth)]);
    loading(false);
    drawCalendar(); drawBoardDay();
  }

  async function openKid(no, opts = {}) {
    if (!opts.fromHistory) pushScreen({ screen: 'kid', no });
    curScreen = 'kid';
    $('#kidTitle').textContent = `${kidName(no)}의 감정일기`;
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'kid'; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === 'board'));
    window.scrollTo(0, 0);
    // 1) 기기에 있는 것으로 바로 그림
    let cached = kidHist[no];
    if (!cached) cached = Object.keys(dayCache).filter(d => dayCache[d][no]).map(d => Object.assign({ date: d }, dayCache[d][no]));
    drawKid(no, cached);
    // 2) 서버에서 최신을 받아 다시 그림
    loading(true);
    try {
      const list = (await api('kid', { no })).entries;
      setKidHist(no, list);
      if (curScreen === 'kid' && history.state && String(history.state.no) === String(no)) drawKid(no, list);
    } catch (e) { handleError(e); }
    finally { loading(false); }
  }
  function drawKid(no, list) {
    list = list.slice();
    $('#kidTally').innerHTML = ''; $('#kidHistory').innerHTML = '';
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
          ent.text ? el('div', { class: 'text' }, ent.text) : null,
          cardPhoto(ent))));
    });
    prefetchFull(list);
  }

  // ---------- 설정 (구글 시트 연결) ----------
  function renderSettings() {
    $('#classKey').value = '';
    $('#connectErr').textContent = '';
    $('#connectInfo').textContent = !API_URL
      ? '⚠️ config.js 에 앱스 스크립트 주소(API_URL)가 아직 없어요. SETUP.md 를 보세요.'
      : classKey
        ? `✅ 연결됨 · 친구 ${kids.length}명` + (serverVersion === null ? '' : ` · 서버 v${serverVersion}`
          + (serverVersion < NEED_SERVER_VERSION ? ' ⚠️ 사진 안 됨: Apps Script 새 버전 배포 필요' : ' (사진 OK)'))
        : '아직 연결되지 않았어요.';
  }
  async function connect() {
    const key = $('#classKey').value.trim();
    if (!key) return;
    const prev = classKey; classKey = key;
    loading(true);
    try {
      const data = await api('init', { date: todayKey() });
      kids = data.kids; LS.set('kids', kids); LS.set('key', classKey);
      setDay(todayKey(), toMap(data.entries));
      toast(`연결됐어요! 친구 ${kids.length}명`);
      flush();
      show('home');
    } catch (e) {
      classKey = prev;
      $('#connectErr').textContent = e.code === 'bad_key' ? '반 비밀번호가 달라요.' : '구글 서버에 연결하지 못했어요. 인터넷을 확인해 주세요. (회사망처럼 script.google.com 이 막힌 곳에서는 안 돼요)';
    } finally { loading(false); }
  }
  $('#connectBtn').addEventListener('click', connect);
  $('#classKey').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('#disconnectBtn').addEventListener('click', () => {
    const msg = pending.length
      ? `아직 올라가지 않은 기록 ${pending.length}개가 있어요. 그래도 이 기기의 연결을 해제할까요?`
      : '이 기기의 연결을 해제할까요? 다시 쓰려면 반 비밀번호가 필요해요.';
    if (!confirm(msg)) return;
    classKey = ''; LS.del('key'); renderSettings(); renderStatus(); toast('연결을 해제했어요');
  });
  $('#reloadBtn').addEventListener('click', () => location.reload());

  // 명단 새로 받기 (시트의 친구목록을 고치면 반영)
  async function refreshKids() {
    try {
      const data = await api('init', { date: todayKey() });
      kids = data.kids; LS.set('kids', kids);
      setDay(todayKey(), toMap(data.entries));
      homeLoadFailed = false;
      if (!$('#home').hidden) { drawHome(); renderStatus(); }
    } catch (e) { homeLoadFailed = true; renderStatus(); handleError(e); }
  }

  // 첫 화면에 머무는 동안 1분마다 오늘 기록·날짜 갱신
  setInterval(() => { if (!$('#home').hidden) renderHome(true); }, 60 * 1000);

  if (!classKey || !API_URL) show('settings', { initial: true });
  else { show('home', { initial: true, refresh: false }); refreshKids(); flush(); }
})();
