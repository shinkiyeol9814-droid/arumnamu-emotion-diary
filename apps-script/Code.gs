/**
 * 아름나무반 감정일기 — 구글 시트 저장소 (Google Apps Script)
 *
 * 이 스크립트는 "구글 시트 → 확장 프로그램 → Apps Script" 에 붙여 넣어 사용합니다.
 * 자세한 순서는 저장소의 SETUP.md 를 보세요.
 *
 * 시트 구성
 *   - 친구목록 : 번호 | 이름            ← 반 친구 명단 (여기서 고치면 앱에 반영)
 *   - 기록     : 날짜 | 번호 | 이름 | 감정 | 날씨 | 이유 | 저장시각 | 감정ID | 날씨ID | 사진ID | 썸네일ID
 *   - 사진     : 구글 드라이브 '아름나무반 감정일기 사진' 폴더 (비공개, 시트 주인만 볼 수 있음)
 *
 * 보안
 *   - 스크립트 속성 CLASS_KEY (반 비밀번호) 가 맞아야만 읽기/쓰기가 됩니다.
 *   - 반 비밀번호는 코드나 GitHub 에 넣지 않습니다.
 *   - 사진은 공유 링크 없이 비공개로 두고, 반 비밀번호가 맞을 때만 이 스크립트가 꺼내 줍니다.
 */

const SHEET_KIDS = '친구목록';
const SHEET_ENTRIES = '기록';
const ENTRY_HEADERS = ['날짜', '번호', '이름', '감정', '날씨', '이유', '저장시각', '감정ID', '날씨ID', '사진ID', '썸네일ID'];
const PHOTO_FOLDER_NAME = '아름나무반 감정일기 사진';
const MAX_PHOTO_CHARS = 4 * 1024 * 1024; // data URL 길이 제한 (약 3MB 사진)

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
  // 예전 버전 시트에도 새 열(사진ID, 썸네일ID) 머리글을 채움
  entries.getRange(1, 1, 1, ENTRY_HEADERS.length).setValues([ENTRY_HEADERS]).setFontWeight('bold');
  entries.getRange('J:K').setNumberFormat('@');
  photoFolder(); // 사진 폴더 준비 (드라이브 권한 승인도 이때 받음)
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
      case 'save': { const items = saveEntries(req.entries || [req.entry]); return json({ ok: true, saved: items.length, items }); }
      case 'photo': return json({ ok: true, data: readPhoto(req.id) });
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
  return {
    date: r[0], no: String(r[1]), name: r[2], emotion: r[7], weather: r[8] || null, text: r[5], at: r[6],
    photoId: r[9] || null, thumbId: r[10] || null,
  };
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
    const saved = [];
    list.forEach(ent => {
      if (!ent || !/^\d{4}-\d{2}-\d{2}$/.test(ent.date) || !EMOTIONS[ent.emotion]) return;
      const no = String(ent.no);
      const kid = kids.find(k => k.no === no);
      const idx = rows.findIndex(r => r[0] === ent.date && String(r[1]) === no);
      // 사진: 새 사진이면 저장(예전 사진은 휴지통), 빼기면 휴지통, 아니면 그대로
      let photoId = idx >= 0 ? (rows[idx][9] || '') : '';
      let thumbId = idx >= 0 ? (rows[idx][10] || '') : '';
      if (ent.photoData || ent.photoRemove) {
        trashFile(photoId);
        if (thumbId !== photoId) trashFile(thumbId);
        photoId = ''; thumbId = '';
      }
      if (ent.photoData) {
        const base = `${ent.date}_${no}`;
        photoId = savePhoto(ent.photoData, base + '.jpg');
        thumbId = ent.thumbData ? savePhoto(ent.thumbData, base + '_thumb.jpg') : photoId;
      }
      const row = [
        ent.date, no, kid ? kid.name : (ent.name || ''),
        EMOTIONS[ent.emotion], WEATHER[ent.weather] || '',
        String(ent.text || '').slice(0, 400),
        ent.at || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
        ent.emotion, ent.weather || '', photoId, thumbId,
      ];
      if (idx >= 0) {
        s.getRange(idx + 2, 1, 1, row.length).setValues([row]);
        rows[idx] = row.map(String);
      } else {
        s.appendRow(row);
        rows.push(row.map(String));
      }
      saved.push({ date: ent.date, no, photoId: photoId || null, thumbId: thumbId || null });
    });
    return saved;
  } finally {
    lock.releaseLock();
  }
}

// ---------- 사진 (구글 드라이브, 비공개) ----------
function photoFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 새로 만듦 */ } }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function savePhoto(dataUrl, name) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || dataUrl.length > MAX_PHOTO_CHARS) throw new Error('사진 형식이나 크기가 맞지 않아요');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  return photoFolder().createFile(blob).getId();
}

function trashFile(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없음 */ }
}

/** 기록에 들어 있는 사진만 꺼내 줌 (다른 드라이브 파일은 절대 안 됨) */
function readPhoto(id) {
  id = String(id || '');
  if (!id || !allEntryRows().some(r => r[9] === id || r[10] === id)) throw new Error('사진을 찾을 수 없어요');
  const blob = DriveApp.getFileById(id).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}
