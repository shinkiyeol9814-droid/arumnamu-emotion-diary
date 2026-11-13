/**
 * 아름나무반 감정일기 — 구글 시트 저장소 (Google Apps Script)
 *
 * 이 스크립트는 "구글 시트 → 확장 프로그램 → Apps Script" 에 붙여 넣어 사용합니다.
 * 자세한 순서는 저장소의 SETUP.md 를 보세요.
 *
 * 시트 구성
 *   - 친구목록 : 번호 | 이름            ← 반 친구 명단 (여기서 고치면 앱에 반영)
 *   - 기록     : 날짜 | 번호 | 이름 | 감정 | 날씨 | 이유 | 저장시각 | 감정ID | 날씨ID
 *
 * 보안
 *   - 스크립트 속성 CLASS_KEY (반 비밀번호) 가 맞아야만 읽기/쓰기가 됩니다.
 *   - 반 비밀번호는 코드나 GitHub 에 넣지 않습니다.
 */

const SHEET_KIDS = '친구목록';
const SHEET_ENTRIES = '기록';
const ENTRY_HEADERS = ['날짜', '번호', '이름', '감정', '날씨', '이유', '저장시각', '감정ID', '날씨ID'];

const EMOTIONS = {
  e01: '졸려요', e02: '질투나요', e03: '뿌듯해요', e04: '화나요', e05: '기뻐요',
  e06: '무서워요', e07: '설레요', e08: '자신있어요', e09: '느긋해요', e10: '무기력해요',
  e11: '외로워요', e12: '속상해요', e13: '행복해요', e14: '아쉬워요', e15: '억울해요',
  e16: '든든해요', e17: '놀라요', e18: '서운해요', e19: '감동이에요', e20: '기대돼요',
  e21: '부끄러워요', e22: '두려워요', e23: '편안해요', e24: '그리워요', e25: '불쾌해요',
  e26: '불안해요', e27: '불편해요', e28: '피곤해요', e29: '실망스러워요', e30: '짜증나요',
};
const WEATHER = { sun: '맑음', partly: '구름 조금', cloud: '흐림', rain: '비', snow: '눈' };

/** 처음 한 번 편집기에서 실행: 시트와 반 비밀번호를 준비합니다. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let kids = ss.getSheetByName(SHEET_KIDS);
  if (!kids) {
    kids = ss.insertSheet(SHEET_KIDS);
    kids.getRange(1, 1, 1, 2).setValues([['번호', '이름']]).setFontWeight('bold');
    kids.setFrozenRows(1);
  }
  let entries = ss.getSheetByName(SHEET_ENTRIES);
  if (!entries) {
    entries = ss.insertSheet(SHEET_ENTRIES);
    entries.getRange(1, 1, 1, ENTRY_HEADERS.length).setValues([ENTRY_HEADERS]).setFontWeight('bold');
    entries.setFrozenRows(1);
    entries.getRange('A:B').setNumberFormat('@'); // 날짜·번호를 글자로 보관
    entries.getRange('G:G').setNumberFormat('@');
    entries.setColumnWidth(6, 360);
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLASS_KEY')) {
    const key = String(Math.floor(100000 + Math.random() * 900000));
    props.setProperty('CLASS_KEY', key);
  }
  Logger.log('준비 완료! 반 비밀번호(CLASS_KEY): ' + props.getProperty('CLASS_KEY'));
  Logger.log('비밀번호를 바꾸려면: 프로젝트 설정(톱니바퀴) → 스크립트 속성 → CLASS_KEY 수정');
}

function doGet() {
  return json({ ok: true, app: '아름나무반 감정일기', hint: 'POST 로 요청하세요' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }
  const key = PropertiesService.getScriptProperties().getProperty('CLASS_KEY');
  if (!key || String(req.key || '') !== key) return json({ ok: false, error: 'bad_key' });

  try {
    switch (req.action) {
      case 'init': return json({ ok: true, kids: readKids(), entries: readDay(req.date) });
      case 'day': return json({ ok: true, entries: readDay(req.date) });
      case 'kid': return json({ ok: true, entries: readKid(req.no) });
      case 'month': return json({ ok: true, days: readMonth(req.month) });
      case 'save': return json({ ok: true, saved: saveEntries(req.entries || [req.entry]) });
      default: return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('시트가 없어요: ' + name + ' (setup 을 먼저 실행하세요)');
  return s;
}

function readKids() {
  const s = sheet(SHEET_KIDS);
  const n = s.getLastRow() - 1;
  if (n < 1) return [];
  return s.getRange(2, 1, n, 2).getDisplayValues()
    .filter(r => r[0] !== '' && r[1] !== '')
    .map(r => ({ no: String(r[0]).trim(), name: String(r[1]).trim() }));
}

function allEntryRows() {
  const s = sheet(SHEET_ENTRIES);
  const n = s.getLastRow() - 1;
  if (n < 1) return [];
  return s.getRange(2, 1, n, ENTRY_HEADERS.length).getDisplayValues();
}

function rowToEntry(r) {
  return { date: r[0], no: String(r[1]), name: r[2], emotion: r[7], weather: r[8] || null, text: r[5], at: r[6] };
}

function readDay(date) {
  if (!date) return [];
  return allEntryRows().filter(r => r[0] === date).map(rowToEntry);
}

function readKid(no) {
  return allEntryRows().filter(r => String(r[1]) === String(no)).map(rowToEntry)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** month: 'YYYY-MM' → { 'YYYY-MM-DD': 기록 수 } */
function readMonth(month) {
  const out = {};
  allEntryRows().forEach(r => { if (String(r[0]).indexOf(month) === 0) out[r[0]] = (out[r[0]] || 0) + 1; });
  return out;
}

/** 같은 날짜·같은 번호는 덮어쓰기, 없으면 새 줄 추가 */
function saveEntries(list) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = sheet(SHEET_ENTRIES);
    const kids = readKids();
    const rows = allEntryRows();
    let saved = 0;
    list.forEach(ent => {
      if (!ent || !/^\d{4}-\d{2}-\d{2}$/.test(ent.date) || !EMOTIONS[ent.emotion]) return;
      const no = String(ent.no);
      const kid = kids.find(k => k.no === no);
      const row = [
        ent.date, no, kid ? kid.name : (ent.name || ''),
        EMOTIONS[ent.emotion], WEATHER[ent.weather] || '',
        String(ent.text || '').slice(0, 400),
        ent.at || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
        ent.emotion, ent.weather || '',
      ];
      const idx = rows.findIndex(r => r[0] === ent.date && String(r[1]) === no);
      if (idx >= 0) {
        s.getRange(idx + 2, 1, 1, row.length).setValues([row]);
        rows[idx] = row.map(String);
      } else {
        s.appendRow(row);
        rows.push(row.map(String));
      }
      saved++;
    });
    return saved;
  } finally {
    lock.releaseLock();
  }
}
