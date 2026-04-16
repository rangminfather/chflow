"""
휴대폰 기반 재매칭:
- 기존 PDF의 사진 페이지(1~43)에서 사진 bbox ↔ 근접 휴대폰 번호 공간 매칭
- 휴대폰 → DB phone (정확 일치 또는 뒤 4자리) → member_id
- 이미 photo_url 있는 회원은 skip
"""
import sys, io, os, re, json, urllib.request, urllib.error
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from collections import defaultdict
import fitz

PDF        = 'c:/csh/project/chflow/자료/데이터베이스 추출용(ocr을 텍스트버전으로변경).pdf'
PHOTOS_DIR = 'c:/csh/project/chflow/MS_AX/parsed-data/photos'
ENV        = 'c:/csh/project/chflow/chflow-app/.env.local'
BUCKET     = 'member-photos'

with open(ENV, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); os.environ[k] = v
URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
H   = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}


import time as _time
def _http_json(url, retries=4):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=H)
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except urllib.error.HTTPError as e:
            if e.code in (502, 503, 504) and i < retries - 1:
                _time.sleep(2 ** i)
                continue
            raise
        except Exception:
            if i < retries - 1:
                _time.sleep(2 ** i)
                continue
            raise

def get_all(path):
    out, off, step = [], 0, 1000
    while True:
        sep = '&' if '?' in path else '?'
        chunk = _http_json(f'{URL}/rest/v1{path}{sep}offset={off}&limit={step}')
        out.extend(chunk)
        if len(chunk) < step: break
        off += step
    return out

def norm_phone(s):
    return re.sub(r'\D', '', s or '')


# DB phone → [member,...]
members = get_all('/members?select=id,name,phone,is_child,photo_url')
by_phone_last8 = defaultdict(list)  # 뒤 8자리
by_phone_last4 = defaultdict(list)
for m in members:
    p = norm_phone(m['phone'])
    if not p: continue
    by_phone_last8[p[-8:]].append(m)
    by_phone_last4[p[-4:]].append(m)


# PDF 파싱: 사진 bbox + 그 아래 범위의 휴대폰 번호
doc = fitz.open(PDF)
ready = []
stats = {'no_phone':0, 'no_match':0, 'already_has':0, 'queued':0, 'ambiguous':0}

for page_idx in range(43):
    page = doc[page_idx]
    img_bboxes = {inf['xref']: inf['bbox'] for inf in page.get_image_info(xrefs=True)}
    photos = []
    pcount = 0
    for img in page.get_images(full=True):
        xref, _sm, w, h = img[0], img[1], img[2], img[3]
        if not (400 < w < 700 and 400 < h < 700): continue
        bb = img_bboxes.get(xref)
        if not bb: continue
        photos.append({'idx': pcount, 'bbox': bb, 'cx': (bb[0]+bb[2])/2, 'y_bottom': bb[3], 'y_top': bb[1]})
        pcount += 1

    spans = []
    for blk in page.get_text('dict')['blocks']:
        if 'lines' not in blk: continue
        for line in blk['lines']:
            for sp in line['spans']:
                t = sp['text'].strip()
                if not t: continue
                bbx = sp['bbox']
                spans.append({'text': t, 'x': bbx[0], 'y': bbx[1]})

    # 각 사진 → 사진 아래 3~90pt 범위, 같은 컬럼(x±40)의 휴대폰 번호 찾기
    for ph in photos:
        mobile = None
        best_dy = 999
        for s in spans:
            # 같은 컬럼
            if abs(s['x'] - ph['bbox'][0]) > 60: continue
            dy = s['y'] - ph['y_bottom']
            if dy < 0 or dy > 95: continue  # 사진 아래 0~95pt
            mm = re.search(r'010[-\s]?(\d{3,4})[-\s]?(\d{4})', s['text'].replace(' ', ''))
            if mm and dy < best_dy:
                mobile = '010' + mm.group(1) + mm.group(2)
                best_dy = dy
        if not mobile:
            stats['no_phone'] += 1; continue

        p = norm_phone(mobile)
        # 정확 일치(뒤 8자리) 우선
        cands = by_phone_last8.get(p[-8:], [])
        if not cands:
            cands = by_phone_last4.get(p[-4:], [])
        if not cands:
            stats['no_match'] += 1; continue
        adults = [c for c in cands if not c['is_child']]
        pool = adults or cands
        if len(pool) > 1:
            stats['ambiguous'] += 1; continue
        m = pool[0]
        if m.get('photo_url'):
            stats['already_has'] += 1; continue
        fname = f'p{page_idx+1:03d}_photo{ph["idx"]:02d}.png'
        fpath = os.path.join(PHOTOS_DIR, fname)
        if not os.path.exists(fpath): continue
        ready.append((m['id'], fpath, m['name']))
        stats['queued'] += 1

print(f'통계: {stats}')
print(f'추가 업로드 대상: {len(ready)}')


# 업로드 + UPDATE
ok, fail = 0, 0
for i, (mid, fpath, name) in enumerate(ready, 1):
    with open(fpath, 'rb') as f: data = f.read()
    obj = f'{mid}/profile.png'
    for method in ('POST', 'PUT'):
        req = urllib.request.Request(f'{URL}/storage/v1/object/{BUCKET}/{obj}',
            data=data, method=method,
            headers={**H, 'Content-Type': 'image/png', 'x-upsert': 'true'})
        try:
            urllib.request.urlopen(req, timeout=30).read(); break
        except urllib.error.HTTPError:
            if method == 'PUT': fail += 1; continue
    else:
        continue

    public_url = f'{URL}/storage/v1/object/public/{BUCKET}/{obj}'
    req = urllib.request.Request(f'{URL}/rest/v1/members?id=eq.{mid}',
        data=json.dumps({'photo_url': public_url}).encode('utf-8'),
        method='PATCH',
        headers={**H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=30).read(); ok += 1
    except Exception:
        fail += 1
    if i % 25 == 0:
        print(f'  진행 {i}/{len(ready)} (성공 {ok})')

print(f'\n성공 {ok}, 실패 {fail}')
