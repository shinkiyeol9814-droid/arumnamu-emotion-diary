# AGENTS.md — 아름나무반 감정일기

AI 코딩 에이전트(Claude Code 등)와 사람이 **어느 PC에서든** 이어서 작업할 수 있도록 정리한 작업 안내서입니다.
사용자 안내는 [README.md](README.md)에, 구글 시트 최초 설정은 [SETUP.md](SETUP.md)에 있습니다.

## 프로젝트 한 줄 요약
어린이집 **아름나무반** 아이들(23명)이 노트북 한 대로 돌아가며 감정을 고르고 이유를 적는 웹 앱입니다.
화면은 **GitHub Pages**(정적), 데이터는 **구글 시트**(Apps Script 웹 앱)에 저장합니다.
감정 그림 30개와 앱 아이콘은 아이가 직접 그린 그림입니다.

- 앱: https://shinkiyeol9814-droid.github.io/arumnamu-emotion-diary/
- 저장소: https://github.com/shinkiyeol9814-droid/arumnamu-emotion-diary (**공개 저장소**)

## ⚠️ 꼭 지킬 것 (개인정보)
1. **아이 실명은 절대 커밋하지 않습니다.** 코드, README, 테스트 데이터, 커밋 메시지, 이슈 모두 해당합니다.
   - 실명 명단은 비공개 구글 시트의 `친구목록` 탭에만 있습니다.
   - 로컬 사본 `private/친구목록.tsv`는 `.gitignore`로 제외되어 있습니다. 다른 PC에는 없으니 필요하면 시트에서 받으세요.
   - 개발과 테스트에는 가짜 이름 "친구 1~23"만 씁니다(`tools/dev_server.py`).
2. **반 비밀번호(`CLASS_KEY`)는 코드에 넣지 않습니다.** Apps Script의 스크립트 속성에만 있습니다.
3. **커밋 작성자는 GitHub noreply 이메일**을 씁니다. 회사 이메일이 공개 저장소에 남으면 안 됩니다. 아래 "새 PC 설정"을 보세요.
4. 대화나 로그에 아이 이름이 보이면 다시 적지 말고 가립니다. 사용자의 사내 AI 사용 정책입니다.
5. push 전에 `git diff --cached`로 실명과 회사 이메일이 없는지 확인합니다.

## 구조
```
src/                    ← GitHub Pages 로 배포되는 웹 앱 (빌드 없음, 순수 HTML/CSS/JS)
  index.html            화면(home, pick, write, done, board, kid, settings)을 <section> 으로 전환
                        settings 는 메뉴에 없음: 로고(.brand) 2.5초 안에 5번 클릭 → 관리자 화면 (아이들에게 숨김)
  app.js                전체 로직 (IIFE 하나, 프레임워크 없음)
  style.css             디자인 (Jua/Gaegu 폰트, 노란 책 테마, ≤560px 휴대폰 대응)
  config.js             API_URL = Apps Script /exec 주소 (공개돼도 됨)
  img/emotions/e01~e30.webp   감정 그림 (순서 = app.js EMOTIONS 배열 = Code.gs EMOTIONS)
  img/icon-*.png, original-*.webp   아이콘, 원본 그림
apps-script/Code.gs     구글 시트 저장소 (사용자가 Apps Script 편집기에 수동으로 붙여 넣고 배포)
tools/dev_server.py     로컬 개발 서버: src/ 제공 + /api 로 Code.gs 를 흉내 냄 (비밀번호 0000)
tools/crop_emotions.py  원본 그림에서 감정 그림 30개와 아이콘을 잘라 냄
.github/workflows/pages.yml   main 에 push(src/**)하면 Pages 자동 배포, __VERSION__ → 커밋 SHA
private/                (gitignore) 실명 명단 등 비공개 파일
```

## 데이터 흐름 / API
- 브라우저는 `POST {API_URL}`로 요청합니다. 본문은 JSON `{ key, action, ... }`입니다.
  - **`Content-Type: text/plain`** 이어야 합니다. 그래야 CORS 사전요청이 생기지 않고 Apps Script가 받습니다. 바꾸지 마세요.
  - 비밀번호는 URL에 넣지 않고 본문에만 넣습니다.
- action 목록: `init`(명단 + 오늘 기록), `day`(date), `kid`(no), `month`('YYYY-MM' → 날짜별 인원), `save`(entries[])
- 시트 구성:
  - `친구목록`: `번호 | 이름`
  - `기록`: `날짜 | 번호 | 이름 | 감정 | 날씨 | 이유 | 저장시각 | 감정ID | 날씨ID`
  - 같은 (날짜, 번호)는 덮어쓰기(upsert)합니다. 날짜, 번호, 시각은 글자 형식으로 저장합니다.
- 아이는 **번호**로 식별합니다. 이름은 화면 표시용입니다.
- 브라우저 localStorage(`arum.*`) 항목:
  - `key`: 반 비밀번호
  - `kids`: 명단 캐시
  - `pending`: 아직 못 보낸 기록. 오프라인일 때 쌓였다가 `online` 이벤트나 30초마다 다시 보냅니다.
- 감정이나 날씨를 추가하거나 바꿀 때는 `app.js`(EMOTIONS, WEATHER), `Code.gs`(EMOTIONS, WEATHER), `dev_server.py`(EMO)를 **모두** 맞춰야 합니다.

## 새 PC에서 시작하기
```bash
git clone https://github.com/shinkiyeol9814-droid/arumnamu-emotion-diary.git
cd arumnamu-emotion-diary
gh auth login
git config user.name  "shinkiyeol9814-droid"
git config user.email "$(gh api user --jq '.id')+shinkiyeol9814-droid@users.noreply.github.com"
```
- `gh auth login`은 아직 로그인하지 않은 경우에만 합니다.
- `git config` 두 줄은 **이 저장소에만** noreply 이메일을 설정합니다. 반드시 실행하세요.
- 필요한 것: Git, Python 3(개발 서버용), GitHub CLI(`gh`)

## 개발 / 확인
```bash
python tools/dev_server.py
```
- http://localhost:8765 에서 열립니다. 반 비밀번호는 `0000`이고, 데이터는 `tools/dev-db.json`(gitignore)에 저장됩니다.
- localhost에서는 `config.js` 대신 자동으로 `/api`(가짜 서버)를 씁니다.
- Claude Code 데스크톱에서는 `.claude/launch.json`의 `emotion-app`으로 미리보기를 띄울 수 있습니다.
- 바꾼 뒤에는 데스크톱(1280px)과 **휴대폰(360px)** 둘 다 가로 넘침이 없는지 확인합니다.
  예전에 `white-space: nowrap` 때문에 휴대폰 화면이 깨진 적이 있습니다.
- **CSS 순서 주의**: `@media (max-width: 560px)` 휴대폰 블록은 `style.css` **맨 아래쪽**에 있어야 합니다.
  기본 규칙이 그 뒤에 오면 휴대폰 규칙을 덮어씁니다. 예전에 로딩 표시가 세로로 길게 늘어난 적이 있습니다.

## 배포
| 바꾼 것 | 반영 방법 |
|---|---|
| `src/**` | `main`에 push → Actions가 Pages 배포(약 30초) → 노트북에서 새로고침 |
| `apps-script/Code.gs` | **자동 배포 안 됨.** 사용자가 Apps Script 편집기에 붙여 넣고 **배포 → 배포 관리 → ✏️ → 새 버전**을 해야 합니다. 이렇게 하면 주소는 그대로입니다. 변경 사항을 사용자에게 꼭 안내하세요. |
| 친구 명단 | 구글 시트 `친구목록` 탭에서 직접 고칩니다(코드 변경 없음) |

- GitHub Pages는 파일을 10분 캐시합니다. 그래서 워크플로가 `index.html`의 `?v=__VERSION__`을 커밋 SHA로 바꿉니다. `index.html`에서 CSS/JS를 불러올 때 이 쿼리를 유지하세요.
- 배포 확인 명령: `gh run list --limit 1`
- 실제 사이트 확인: `curl -s https://shinkiyeol9814-droid.github.io/arumnamu-emotion-diary/ | grep -o 'app.js?v=[a-z0-9]*'`

## 알려진 사항
- **회사망에서는 `script.google.com`이 막혀 있습니다**(TLS에서 끊김). 회사 PC에서는 실제 시트에 연결해 테스트할 수 없습니다.
  로컬 개발 서버로 확인하고, 실제 연결은 휴대폰 데이터나 어린이집 인터넷에서 사용자가 확인합니다. 회사 보안 정책을 우회하는 방법은 쓰지 않습니다.
- 카카오톡 인앱 브라우저는 localStorage가 따로라서 비밀번호를 다시 물어봅니다. 크롬으로 열도록 안내하세요.
- '아쉬워요'(e14) 그림은 원본에서 왼쪽이 조금 잘려 있습니다. 원본 사진을 다시 받으면 `tools/crop_emotions.py`로 다시 자릅니다.

## 커밋 규칙
- 커밋 메시지는 한국어로, 첫 줄에 요약, 본문에 변경점을 씁니다.
- `main`에 바로 커밋하고 push합니다(혼자 쓰는 저장소). 강제 push는 하지 않습니다.
