"""
명성교회 요람 PDF → 전체 데이터 추출 (V3 최종)

처리:
1. 사진 페이지 (PDF p.1-43): 이름, 배우자, 휴대폰, 평원-초원-목장
2. 목장 페이지 (PDF p.44-111): 가족 단위 정보 (직분, 주소, 자녀, 자택전화)
3. Cross-reference: 이름+휴대폰 매칭
4. 회원 사진 추출
5. 검수용 엑셀 생성 (의심 항목 빨간색)
"""
import sys, io, re, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import fitz
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from collections import defaultdict

PDF = 'c:/csh/project/chflow/자료/데이터베이스 추출용(ocr을 텍스트버전으로변경).pdf'
OUT_DIR = 'C:/csh/project/chflow/MS_AX/parsed-data'
os.makedirs(OUT_DIR, exist_ok=True)
PHOTOS_DIR = os.path.join(OUT_DIR, 'photos')
os.makedirs(PHOTOS_DIR, exist_ok=True)

PHOTO_PAGE_RANGE = (0, 43)   # PDF index 0-42
PASTURE_PAGE_RANGE = (43, 111)  # PDF index 43-110


# ============================================================
# 직분 정의
# ============================================================
ROLES_KNOWN = sorted([
    '담임목사', '부목사', '은퇴목사', '목사',
    '선교사', '전도사', '사모',
    '시무장로', '원로장로', '은퇴장로', '명예장로', '장로',
    '교육사', '간사',
    '명예시무집사', '은퇴시무집사', '시무집사',
    '명예시무권사', '은퇴시무권사', '시무권사',
    '명예집사', '은퇴집사', '집사',
    '명예권사', '은퇴권사', '권사',
    '청년', '청소년', '어린이', '유아',
], key=len, reverse=True)

ADDRESS_KEYWORDS = ['동구', '북구', '남구', '중구', '울주군', '경북', '서울', '경기',
                    '부산', '대구', '광주', '대전', '인천', '울산', '동부']

# 알려진 OCR 오류 보정 (점진적으로 늘릴 것)
OCR_FIXES = {
    '권Af': '권사', '권f': '권사',
    '시T집사': '시무집사', '지T집사': '시무집사',
    'X[': '자',
    '0 1': '01',
    '검': '김', 'O|': '이', '7|': '기',
    '이懿': '이동은',
}


def fix_ocr(text):
    if not text:
        return ''
    return text


def normalize_phone(text):
    if not text:
        return ''
    cleaned = re.sub(r'\s+', '', text)
    m = re.search(r'(\d{2,3})-?(\d{3,4})-?(\d{4})', cleaned)
    return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else ''


def is_phone(text):
    return bool(re.search(r'\d{2,3}\s*-\s*\d{3,4}\s*-\s*\d{4}', text))


def is_korean_name(text):
    """2-4자 한글 이름 패턴"""
    return bool(re.match(r'^[가-힣]{2,4}$', text.strip()))


def parse_pasture_label(text):
    """3-신위식-장영국목장 → (3, 신위식, 장영국)"""
    text = text.strip()
    text = re.sub(r'^\d+_\s*', '', text)  # leading "3_"
    parts = re.split(r'[-_]', text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 3:
        # 첫 번째가 평원 번호 (1자리 숫자)
        if re.match(r'^\d$', parts[0]):
            return parts[0], parts[1], parts[2].replace('목장', '')
    if len(parts) == 2:
        return None, parts[0], parts[1].replace('목장', '')
    return None, None, text.replace('목장', '')


def parse_name_spouse(text):
    """장영국(곽순이) → (장영국, 곽순이)"""
    text = text.strip()
    m = re.match(r'([가-힣]{2,4})\s*[\(\[]\s*([가-힣]{2,4})\s*[\)\]]', text)
    if m:
        return m.group(1), m.group(2)
    if is_korean_name(text):
        return text, None
    return None, None


def get_spans(page):
    spans = []
    d = page.get_text("dict")
    for block in d['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            for span in line['spans']:
                text = span['text'].strip()
                if text:
                    bbox = span['bbox']
                    spans.append({
                        'text': text,
                        'x': bbox[0], 'y': bbox[1],
                        'x2': bbox[2], 'y2': bbox[3],
                    })
    return sorted(spans, key=lambda s: (s['y'], s['x']))


# ============================================================
# 사진 페이지 파서
# ============================================================
def parse_photo_page(page, page_num):
    """사진 페이지에서 회원 정보 추출"""
    spans = get_spans(page)
    if not spans:
        return []

    members = []

    # 이름 패턴 (한글 + 괄호) anchor
    name_anchors = [s for s in spans
                    if re.match(r'[가-힣]{2,4}\s*[\(\[]', s['text'])
                    and s['y'] > 200]

    for anchor in name_anchors:
        y_anchor = anchor['y']
        x_anchor = anchor['x']

        # 같은 컬럼 내의 nearby spans (y 범위 30, x 범위 70)
        nearby = [s for s in spans
                  if abs(s['x'] - x_anchor) < 70
                  and -2 <= s['y'] - y_anchor <= 35]

        name, spouse = parse_name_spouse(anchor['text'])
        if not name:
            continue

        home_phone = None
        mobile = None
        plain = grassland = pasture = None

        for s in nearby:
            t = s['text']
            if t == anchor['text']:
                continue
            if is_phone(t):
                cleaned = re.sub(r'\s+', '', t)
                if cleaned.startswith('010'):
                    if not mobile:
                        mobile = normalize_phone(t)
                else:
                    if not home_phone:
                        home_phone = normalize_phone(t)
            elif re.match(r'^\d{3}\s*-\s*\d{4}', t):
                if not home_phone:
                    home_phone = normalize_phone(t)
            elif '목장' in t:
                p, g, ps = parse_pasture_label(t)
                if p:
                    plain = p
                if g:
                    grassland = g
                if ps:
                    pasture = ps

        # 평원-초원-목장이 연속 두 셀에 나뉘어 있을 수도 있음
        # "3_" + "심방부" 같은 분리
        for s in nearby:
            t = s['text']
            if t == anchor['text']:
                continue
            # leading "1_", "2_" 등은 평원 숫자
            if re.match(r'^\d_\s*$', t.strip()):
                if not plain:
                    plain = t.strip().rstrip('_')

        members.append({
            'name': name,
            'spouse': spouse,
            'home_phone': home_phone,
            'mobile': mobile,
            'plain': plain,
            'grassland': grassland,
            'pasture': pasture,
            'page': page_num,
            'source': 'photo',
        })

    return members


# ============================================================
# 목장 페이지 파서
# ============================================================
def is_address_line(text):
    text = text.strip()
    return any(text.startswith(k) for k in ADDRESS_KEYWORDS)


def extract_role(text):
    text = text.strip()
    for role in ROLES_KNOWN:
        if role in text:
            return role
    return None


def parse_pasture_page(page, page_num):
    spans = get_spans(page)
    if not spans:
        return None

    body = [s for s in spans if s['y'] >= 230]
    header = [s for s in spans if s['y'] < 230]

    addr_col_x = 245

    # 주소 라인을 가족 경계로
    address_anchors = []
    for s in body:
        if 235 <= s['x'] < 370 and is_address_line(s['text']):
            address_anchors.append(s)
    address_anchors.sort(key=lambda a: a['y'])

    unique_anchors = []
    for a in address_anchors:
        if not unique_anchors or a['y'] - unique_anchors[-1]['y'] > 20:
            unique_anchors.append(a)

    # 헤더(목자/목녀) 파싱
    shepherd = shepherdess = shepherd_phone = shepherdess_phone = None
    for s in header:
        t = s['text']
        if is_korean_name(t) and t not in ('목자', '목녀'):
            if s['x'] < 350 and not shepherd:
                shepherd = t
            elif s['x'] >= 350 and not shepherdess:
                shepherdess = t
        elif is_phone(t):
            cleaned = re.sub(r'\s+', '', t)
            if cleaned.startswith('010'):
                if s['x'] < 350 and not shepherd_phone:
                    shepherd_phone = normalize_phone(t)
                elif s['x'] >= 350 and not shepherdess_phone:
                    shepherdess_phone = normalize_phone(t)

    households = []
    for i, anchor in enumerate(unique_anchors):
        y_start = anchor['y'] - 12
        y_end = unique_anchors[i + 1]['y'] - 12 if i + 1 < len(unique_anchors) else 1000
        block = [s for s in body if y_start <= s['y'] < y_end]

        names = []
        roles = []
        addr_parts = []
        children_parts = []
        home_phone = None
        mobile_phones = []

        for s in block:
            x, t = s['x'], s['text']

            # 전화 컬럼 (x > 365)
            if x >= 365:
                if 'T.' in t or t.startswith('T '):
                    home_phone = normalize_phone(t.replace('T.', '').replace('T', ''))
                elif is_phone(t):
                    m = re.search(r'(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})', t)
                    if m:
                        mobile_phones.append(normalize_phone(m.group(1)))
                continue

            # 주소/가족 컬럼 (x ≈ 245-365)
            if 235 <= x < 365:
                t_clean = t.strip()
                if is_address_line(t_clean) or any(k in t_clean[:6] for k in ['(', '아파트', '빌라', '동', '호', '번지', '로 ', '길 ']):
                    addr_parts.append(t_clean)
                else:
                    children_parts.append(t_clean)
                continue

            # 직분 + 이름 컬럼 (x < 245)
            if x < 235:
                t_clean = t.strip()
                # "1 |" 같은 번호 제거
                t_clean = re.sub(r'^\d+\s*[\|\.]?\s*', '', t_clean)
                # "|" 분리
                for part in re.split(r'[\|]', t_clean):
                    part = part.strip()
                    if not part:
                        continue
                    role = extract_role(part)
                    if role:
                        if role not in roles:
                            roles.append(role)
                        # 직분 뒤 이름이 더 있을 수 있음
                        rest = part.replace(role, '').strip()
                        if is_korean_name(rest) and rest not in names:
                            names.append(rest)
                    elif is_korean_name(part) and part not in names:
                        names.append(part)

        # 자녀 정리: 한 셀에 붙어있는 이름들 분리
        children = []
        for cp in children_parts:
            tokens = cp.split()
            for tok in tokens:
                tok = tok.strip(',.|')
                if not tok:
                    continue
                # 같은 성씨 반복 패턴 ("홍은숙홍동호홍민호")
                if len(tok) >= 6 and len(tok) % 3 == 0:
                    chunks = [tok[i:i+3] for i in range(0, len(tok), 3)]
                    # 첫 글자가 같으면 (성씨 반복) 분리
                    if len(set(c[0] for c in chunks)) == 1:
                        children.extend(chunks)
                        continue
                if is_korean_name(tok):
                    children.append(tok)
                elif len(tok) >= 2:
                    children.append(tok)

        households.append({
            'no': i + 1,
            'names': names[:2],
            'roles': roles[:2],
            'address': ' '.join(addr_parts).strip(),
            'children': children,
            'phone_home': home_phone,
            'phone_mobiles': mobile_phones,
            'page': page_num,
        })

    return {
        'page': page_num,
        'shepherd': shepherd,
        'shepherdess': shepherdess,
        'shepherd_phone': shepherd_phone,
        'shepherdess_phone': shepherdess_phone,
        'households': households,
    }


# ============================================================
# 회원 사진 추출
# ============================================================
def extract_photos(doc, photo_page_indices):
    """사진 페이지에서 모든 사진 이미지를 잘라서 저장"""
    photos = []  # [(page, photo_idx, file_path)]
    for page_idx in photo_page_indices:
        page = doc[page_idx]
        images = page.get_images(full=True)
        # 페이지 배경 이미지(1275x1650)는 제외, 회원 사진(528x552 정도)만
        photo_count = 0
        for img in images:
            xref = img[0]
            w = img[2]
            h = img[3]
            if not (400 < w < 700 and 400 < h < 700):
                continue
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                fname = f'p{page_idx + 1:03d}_photo{photo_count:02d}.png'
                pix.save(os.path.join(PHOTOS_DIR, fname))
                photos.append({
                    'page': page_idx + 1,
                    'idx': photo_count,
                    'file': fname,
                })
                photo_count += 1
                pix = None
            except Exception as e:
                pass
    return photos


# ============================================================
# 메인 실행
# ============================================================
def main():
    doc = fitz.open(PDF)
    print(f'Total pages: {doc.page_count}')

    # 1. 사진 페이지 처리
    print('\n=== Phase 1: 사진 페이지 (p.1-43) ===')
    photo_members = []
    for i in range(*PHOTO_PAGE_RANGE):
        members = parse_photo_page(doc[i], i + 1)
        photo_members.extend(members)
        if members:
            print(f'  p{i+1}: {len(members)}명')

    print(f'\n총 사진 페이지 회원: {len(photo_members)}')

    # 2. 목장 페이지 처리
    print('\n=== Phase 2: 목장 페이지 (p.44-111) ===')
    pasture_pages = []
    total_households = 0
    for i in range(*PASTURE_PAGE_RANGE):
        result = parse_pasture_page(doc[i], i + 1)
        if result and result['households']:
            pasture_pages.append(result)
            total_households += len(result['households'])
            print(f'  p{i+1}: 목자={result["shepherd"]} ({len(result["households"])}가족)')

    print(f'\n총 목장 페이지: {len(pasture_pages)}')
    print(f'총 가족 수: {total_households}')

    # 3. 사진 추출
    print('\n=== Phase 3: 회원 사진 추출 ===')
    photos = extract_photos(doc, range(*PHOTO_PAGE_RANGE))
    print(f'추출한 사진 수: {len(photos)}')

    # 4. Save raw data
    raw_data = {
        'photo_members': photo_members,
        'pasture_pages': pasture_pages,
        'photos': photos,
    }
    with open(os.path.join(OUT_DIR, 'raw_data.json'), 'w', encoding='utf-8') as f:
        json.dump(raw_data, f, ensure_ascii=False, indent=2, default=str)
    print(f'\n💾 Raw data saved')


if __name__ == '__main__':
    main()
