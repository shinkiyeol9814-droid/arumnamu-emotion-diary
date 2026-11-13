"""로컬 개발용 서버: src/ 를 보여 주고, /api 로 구글 앱스 스크립트(Code.gs)를 흉내 냅니다.

    python tools/dev_server.py        →  http://localhost:8765  (반 비밀번호: 0000)

데이터는 tools/dev-db.json 에 저장됩니다 (git 에 올라가지 않음). 실제 명단이 아닌 '친구 N' 을 씁니다.
"""
import json
import os
import sys
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DB = os.path.join(ROOT, 'tools', 'dev-db.json')
KEY = '0000'
EMO = {f'e{i:02d}' for i in range(1, 31)}


def load():
    if os.path.exists(DB):
        with open(DB, encoding='utf-8') as f:
            return json.load(f)
    return {'kids': [{'no': str(i), 'name': f'친구 {i}'} for i in range(1, 24)], 'entries': []}


PHOTOS = os.path.join(ROOT, 'tools', 'dev-photos')


def save_photo(data_url):
    if not str(data_url).startswith('data:image/'):
        raise ValueError('bad photo')
    os.makedirs(PHOTOS, exist_ok=True)
    pid = uuid.uuid4().hex
    with open(os.path.join(PHOTOS, pid + '.txt'), 'w', encoding='utf-8') as f:
        f.write(data_url)
    return pid


def store(db):
    with open(DB, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=1)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SRC, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api':
            self.send_error(404)
            return
        req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        self.reply(self.handle_api(req))

    def handle_api(self, req):
        if req.get('key') != KEY:
            return {'ok': False, 'error': 'bad_key'}
        db = load()
        a = req.get('action')
        day = lambda d: [e for e in db['entries'] if e['date'] == d]
        if a == 'init':
            return {'ok': True, 'kids': db['kids'], 'entries': day(req.get('date'))}
        if a == 'day':
            return {'ok': True, 'entries': day(req.get('date'))}
        if a == 'kid':
            rows = [e for e in db['entries'] if e['no'] == str(req.get('no'))]
            return {'ok': True, 'entries': sorted(rows, key=lambda e: e['date'], reverse=True)}
        if a == 'month':
            out = {}
            for e in db['entries']:
                if e['date'].startswith(req.get('month', '')):
                    out[e['date']] = out.get(e['date'], 0) + 1
            return {'ok': True, 'days': out}
        if a == 'save':
            items = []
            for src in req.get('entries') or [req.get('entry')]:
                if not src or src.get('emotion') not in EMO:
                    continue
                ent = {k: src.get(k) for k in ('date', 'no', 'name', 'emotion', 'weather', 'text', 'at')}
                ent['no'] = str(ent['no'])
                old = next((e for e in db['entries'] if e['date'] == ent['date'] and e['no'] == ent['no']), {})
                ent['photoId'], ent['thumbId'] = old.get('photoId'), old.get('thumbId')
                if src.get('photoData') or src.get('photoRemove'):
                    ent['photoId'] = ent['thumbId'] = None  # (실제 Code.gs 는 예전 파일을 휴지통으로)
                if src.get('photoData'):
                    ent['photoId'] = save_photo(src['photoData'])
                    ent['thumbId'] = save_photo(src.get('thumbData') or src['photoData'])
                db['entries'] = [e for e in db['entries'] if not (e['date'] == ent['date'] and e['no'] == ent['no'])]
                db['entries'].append(ent)
                items.append({'date': ent['date'], 'no': ent['no'], 'photoId': ent['photoId'], 'thumbId': ent['thumbId']})
            store(db)
            return {'ok': True, 'saved': len(items), 'items': items}
        if a == 'photo':
            pid = str(req.get('id') or '')
            known = any(pid and pid in (e.get('photoId'), e.get('thumbId')) for e in db['entries'])
            path = os.path.join(PHOTOS, pid + '.txt')
            if not known or not os.path.exists(path):
                return {'ok': False, 'error': '사진을 찾을 수 없어요'}
            with open(path, encoding='utf-8') as f:
                return {'ok': True, 'data': f.read()}
        return {'ok': False, 'error': 'unknown_action'}

    def reply(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'http://localhost:{port}  (반 비밀번호 {KEY})')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
