"""
배우자 이름 기반 보완 매칭:
- 기존 공간매칭에서 본인 이름은 OCR 오류로 DB와 안 맞지만, 괄호 안 배우자 이름은 정상 파싱된 경우가 있음
- (부인이름) → DB members 역조회 → 그 사람의 spouse → 본인 member_id 추정
- 단, 동명이인 배우자 많으면 위험 → 페이지 context + 동일 휴대폰 보조 확인
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
def get_all(path):
    out, off, step = [], 0, 1000
    while True:
        sep = '&' if '?' in path else '?'
        for i in range(4):
            try:
                req = urllib.request.Request(f'{URL}/rest/v1{path}{sep}offset={off}&limit={step}', headers=H)
                chunk = json.loads(urllib.request.urlopen(req, timeout=60).read())
                break
            except Exception:
                if i == 3: raise
                _time.sleep(2 ** i)
        out.extend(chunk)
        if len(chunk) < step: break
        off += step
    return out

def norm_phone(s):
    return re.sub(r'\D', '', s or '')


members = get_all('/members?select=id,name,phone,spouse_name,is_child,photo_url,household_id')
by_name = defaultdict(list)
for m in members:
    by_name[m['name']].append(m)


doc = fitz.open(PDF)
ready = []
stats = {'queued':0, 'no_anchor':0, 'no_spouse_match':0, 'ambig':0, 'already_has':0, 'no_reverse':0}

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
        photos.append({'idx': pcount, 'bbox': bb, 'cx': (bb[0]+bb[2])/2, 'y_bottom': bb[3]})
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

    # 이름 anchor 전체 (본인+배우자 포함) + 근처 휴대폰
    for ph in photos:
        # 사진 아래 0~45pt, 같은 컬럼의 "X(Y)" 패턴 찾기
        anchor_text = None
        anchor_y = None
        for s in spans:
            if abs(s['x'] - ph['bbox'][0]) > 60: continue
            dy = s['y'] - ph['y_bottom']
            if dy < 0 or dy > 45: continue
            m = re.match(r'([가-힣]{2,4})\s*[\(\[]\s*([가-힣]{2,4})', s['text'])
            if m:
                anchor_text = s['text']
                anchor_spouse = m.group(2)
                anchor_name = m.group(1)
                anchor_y = s['y']
                break
        if not anchor_text:
            stats['no_anchor'] += 1; continue

        # 이미 by_name에 본인이 있고, 그 중 적절한 member에 이미 photo_url이 있으면 skip 안 하고 재업로드 안 함
        # 우선 본인 이름으로 찾을 수 있으면 그쪽으로 (기존 공간매칭이 놓친 case 재시도)
        target = None
        if anchor_name in by_name:
            pool = [m for m in by_name[anchor_name] if not m['is_child']]
            if len(pool) == 1:
                target = pool[0]
            elif len(pool) > 1 and anchor_spouse:
                narrowed = [m for m in pool if m.get('spouse_name') == anchor_spouse]
                if len(narrowed) == 1:
                    target = narrowed[0]

        # 본인 이름으로 못 찾으면 배우자 이름 역매칭
        if not target and anchor_spouse in by_name:
            spouse_candidates = [m for m in by_name[anchor_spouse] if not m['is_child']]
            # 그 배우자의 household에 있는 다른 성인 성별 반대쪽
            inverted = []
            for sp_m in spouse_candidates:
                if not sp_m.get('household_id'): continue
                mates = [m for m in members
                         if m['household_id'] == sp_m['household_id']
                         and not m['is_child']
                         and m['id'] != sp_m['id']]
                inverted.extend(mates)
            if len(inverted) == 1:
                target = inverted[0]
            else:
                stats['ambig'] += 1; continue
        elif not target:
            stats['no_reverse'] += 1; continue

        if not target:
            stats['no_spouse_match'] += 1; continue

        if target.get('photo_url'):
            stats['already_has'] += 1; continue

        fname = f'p{page_idx+1:03d}_photo{ph["idx"]:02d}.png'
        fpath = os.path.join(PHOTOS_DIR, fname)
        if not os.path.exists(fpath): continue
        ready.append((target['id'], fpath, target['name']))
        stats['queued'] += 1

print(f'통계: {stats}')
print(f'추가 업로드 대상: {len(ready)}')


ok, fail = 0, 0
for i, (mid, fpath, name) in enumerate(ready, 1):
    with open(fpath, 'rb') as f: data = f.read()
    obj = f'{mid}/profile.png'
    uploaded = False
    for method in ('POST','PUT'):
        req = urllib.request.Request(f'{URL}/storage/v1/object/{BUCKET}/{obj}',
            data=data, method=method,
            headers={**H, 'Content-Type': 'image/png', 'x-upsert': 'true'})
        try:
            urllib.request.urlopen(req, timeout=30).read(); uploaded=True; break
        except urllib.error.HTTPError:
            continue
    if not uploaded:
        fail += 1; continue

    public_url = f'{URL}/storage/v1/object/public/{BUCKET}/{obj}'
    req = urllib.request.Request(f'{URL}/rest/v1/members?id=eq.{mid}',
        data=json.dumps({'photo_url': public_url}).encode('utf-8'),
        method='PATCH',
        headers={**H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=30).read(); ok += 1
    except Exception:
        fail += 1

print(f'\n성공 {ok}, 실패 {fail}')
