"""
PDF 요람의 사진페이지(1~43)에서 사진 bbox와 이름 anchor를 공간 매칭 →
같은 이름(+휴대폰)을 가진 members로 연결 → Storage 업로드 → members.photo_url UPDATE.

가정(실측 확인됨): 회원 사진 아래 0~30pt 범위에 "이름(배우자)" 텍스트 anchor가 배치.
"""
import sys, io, os, re, json, time, urllib.request, urllib.error, urllib.parse
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import fitz
from collections import defaultdict

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


def _enc(p):
    if '?' in p:
        b, q = p.split('?', 1); return b + '?' + urllib.parse.quote(q, safe='=&.,%*!')
    return p

def get_all_members():
    """전체 members fetch (1000 페이징)"""
    out, off, step = [], 0, 1000
    while True:
        path = f'/members?select=id,name,phone,is_child&offset={off}&limit={step}'
        req = urllib.request.Request(f'{URL}/rest/v1{_enc(path)}', headers=H)
        data = json.loads(urllib.request.urlopen(req, timeout=60).read())
        out.extend(data)
        if len(data) < step: break
        off += step
    return out

def norm_phone(s):
    if not s: return ''
    return re.sub(r'\D', '', s)

def normalize_phone_str(s):
    if not s: return ''
    m = re.search(r'(010)[-\s]?(\d{3,4})[-\s]?(\d{4})', s.replace(' ', ''))
    return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else ''


# ── 1. PDF 파싱 → photo-name 매칭 ──
print('=== PDF 파싱: 사진↔이름 공간 매칭 ===')
doc = fitz.open(PDF)
photo_matches = []  # [{name,spouse,mobile,page,photo_idx,file}]

for page_idx in range(43):  # PDF page 1~43
    page = doc[page_idx]

    # (a) 이미지 bbox
    img_bboxes = {inf['xref']: inf['bbox'] for inf in page.get_image_info(xrefs=True)}
    photos = []
    pcount = 0
    for img in page.get_images(full=True):
        xref, _sm, w, h = img[0], img[1], img[2], img[3]
        if not (400 < w < 700 and 400 < h < 700):
            continue  # 배경 제외 (회원 사진만)
        bb = img_bboxes.get(xref)
        if not bb: continue
        photos.append({'idx': pcount, 'bbox': bb, 'cx': (bb[0]+bb[2])/2, 'y_bottom': bb[3]})
        pcount += 1

    # (b) spans (text + bbox)
    spans = []
    for blk in page.get_text('dict')['blocks']:
        if 'lines' not in blk: continue
        for line in blk['lines']:
            for sp in line['spans']:
                t = sp['text'].strip()
                if not t: continue
                bbx = sp['bbox']
                spans.append({'text': t, 'x': bbx[0], 'y': bbx[1]})

    # (c) 이름 anchor 찾기
    anchors = []
    for s in spans:
        m = re.match(r'([가-힣]{2,4})\s*[\(\[]\s*([가-힣]{2,4})', s['text'])
        if not m: continue
        if s['y'] < 200: continue
        anchors.append({'name': m.group(1), 'spouse': m.group(2),
                        'x': s['x'], 'y': s['y']})

    # (d) anchor별 근접 mobile 찾기
    for a in anchors:
        mob = None
        for s in spans:
            if abs(s['x'] - a['x']) < 70 and -2 <= s['y'] - a['y'] <= 40:
                mm = re.search(r'010[-\s]?\d{3,4}[-\s]?\d{4}', s['text'].replace(' ', ''))
                if mm:
                    mob = normalize_phone_str(mm.group(0)); break
        a['mobile'] = mob

    # (e) anchor ↔ photo 매칭 (사진 바로 아래 anchor)
    for a in anchors:
        best, best_dy = None, 999
        for ph in photos:
            # 같은 컬럼 (x 오차 40pt 내)
            if abs(a['x'] - ph['cx']) > 40: continue
            dy = a['y'] - ph['y_bottom']
            if dy < -5 or dy > 30: continue
            if dy < best_dy:
                best_dy = dy; best = ph
        if best:
            photo_matches.append({
                'name': a['name'], 'spouse': a['spouse'], 'mobile': a['mobile'],
                'page': page_idx + 1, 'photo_idx': best['idx'],
                'file': f'p{page_idx+1:03d}_photo{best["idx"]:02d}.png',
            })

print(f'  매칭된 (사진↔이름): {len(photo_matches)}')


# ── 2. DB members 로드 & name+mobile 매칭 ──
print('\n=== DB members 매칭 ===')
members = get_all_members()
print(f'  DB members: {len(members)}')

by_name = defaultdict(list)
for m in members:
    by_name[m['name']].append(m)

ready = []  # [(member_id, photo_file, name, mobile)]
ambig, miss = 0, 0
for pm in photo_matches:
    cands = by_name.get(pm['name'], [])
    if not cands:
        miss += 1; continue
    # is_child=False 우선
    adults = [c for c in cands if not c['is_child']]
    pool = adults or cands
    # mobile 정확 일치 우선
    if pm['mobile']:
        exact = [c for c in pool if norm_phone(c['phone']) == norm_phone(pm['mobile'])]
        if exact:
            ready.append((exact[0]['id'], pm['file'], pm['name'], pm['mobile'])); continue
        last4 = [c for c in pool if norm_phone(c['phone'])[-4:] == norm_phone(pm['mobile'])[-4:]]
        if len(last4) == 1:
            ready.append((last4[0]['id'], pm['file'], pm['name'], pm['mobile'])); continue
    # mobile 없거나 매칭 안 되면 이름 1개뿐이어야 허용
    if len(pool) == 1:
        ready.append((pool[0]['id'], pm['file'], pm['name'], pm['mobile'])); continue
    ambig += 1

print(f'  업로드 준비: {len(ready)} | 이름없음: {miss} | 동명이인 모호: {ambig}')


# ── 3. Storage 업로드 + photo_url UPDATE ──
print('\n=== Storage 업로드 + photo_url UPDATE ===')
ok, fail = 0, 0
for i, (mid, fname, name, mob) in enumerate(ready, 1):
    fpath = os.path.join(PHOTOS_DIR, fname)
    if not os.path.exists(fpath):
        fail += 1; continue
    with open(fpath, 'rb') as f:
        data = f.read()
    obj_path = f'{mid}/profile.png'
    # 1) upload to storage (upsert)
    up_url = f'{URL}/storage/v1/object/{BUCKET}/{obj_path}'
    req = urllib.request.Request(up_url, data=data, method='POST',
        headers={**H, 'Content-Type': 'image/png', 'x-upsert': 'true'})
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        # upsert가 안 먹으면 PUT로 재시도
        try:
            req2 = urllib.request.Request(up_url, data=data, method='PUT',
                headers={**H, 'Content-Type': 'image/png', 'x-upsert': 'true'})
            urllib.request.urlopen(req2, timeout=30).read()
        except Exception as e2:
            print(f'  업로드 실패 {name}: {e2}')
            fail += 1; continue

    # 2) members.photo_url UPDATE
    public_url = f'{URL}/storage/v1/object/public/{BUCKET}/{obj_path}'
    patch_url = f'{URL}/rest/v1/members?id=eq.{mid}'
    req = urllib.request.Request(patch_url,
        data=json.dumps({'photo_url': public_url}).encode('utf-8'),
        method='PATCH',
        headers={**H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        ok += 1
    except Exception as e:
        print(f'  PATCH 실패 {name}: {e}')
        fail += 1
    if i % 50 == 0:
        print(f'  진행: {i}/{len(ready)} (성공 {ok}, 실패 {fail})')

print(f'\n=== 완료 ===')
print(f'성공: {ok}, 실패: {fail}')
