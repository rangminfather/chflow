"""
명성교회 요람 PDF → 회원 DB (V3)

V2 대비 개선:
- OCR 사전 확장 (사용자 수정본 기반)
- 평원/초원/목장 정규화
- 주소 자동 prefix (울산광역시)
- 부부 단위 매칭 향상
- 자녀 별도 row
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

PHOTO_PAGE_RANGE = (0, 43)
PASTURE_PAGE_RANGE = (43, 111)


# ============================================================
# OCR 오류 보정 사전 (사용자 수정본 분석 기반)
# ============================================================

# 다중 글자 패턴만 보정 (단일 한글은 위험해서 제외)
CHAR_FIXES = {
    'X[': '자',  # 목X[ → 목자
    '7|': '기',  # 박7|용 → 박기용
    'O|': '이',  # O|상정 → 이상정
    '0|': '이',
    '0 |': '0',
    '0 1': '01',
}

# 단어 단위 보정
WORD_FIXES = {
    '심기옥': '심기욱',
    '남모영': '남묘영',
    '남동회': '남동희',
    '검철수': '김철수',
    '검진우': '김진우',
    '검동수': '김동수',
    '검용철': '김용철',
    '앙종일': '양종일',
    '0 1': '01',
    '0 |': '0',
    '권Af': '권사',
    '권f': '권사',
    '시T집사': '시무집사',
    '지T집사': '시무집사',
    'O|명진': '이명진',
    'O|주한': '이주한',
    'O|상정': '이상정',
    '0|명진': '이명진',
    '0|주한': '이주한',
    '심71욱': '심기욱',
    '박7|용': '박기용',
    '박둘연': '박옥연',  # 박둘연 → 박옥연 (?)
    '신영이': '신연이',  # 추정
    '손창명': '손창영',  # 추정
    '문영수': '문성수',  # 추정 - 보류
    '국민호': '송민호',  # 2국민호 → 송민호
    '국송민호': '송민호',
    '간정진화': '정진화',
    '건남성윤': '남성윤',
    '건이상경': '이상경',
    '건정준수': '정준수',
    '권위식': '신위식',
    '양신위식': '신위식',
    '양정진화': '정진화',
    '명진': '이명진',  # 컨텍스트 필요
    '상경': '이상경',
    '상정': '이상정',
    '분선': '이분선',
    '은이펑윈': '젊은이평원',
    '젊철': '안종철',  # ??
    '김효원핼': '김효원할',
}

# 평원 정규화
PLAIN_NORMALIZE = {
    '1평원': '1',
    '2평원': '2',
    '3평원': '3',
    '젊은이평원': '젊은이',
    '젊은이': '젊은이',
    '은이펑윈': '젊은이',
    '1': '1',
    '2': '2',
    '3': '3',
}


def fix_text(text):
    """OCR 오류 단어 단위 보정 (단어 사전만 사용, 글자 단위 보정은 위험)"""
    if not text:
        return ''
    text = text.strip()
    if text in WORD_FIXES:
        return WORD_FIXES[text]
    # 다중 글자 패턴만 보정 (단일 한글은 위험)
    for bad, good in CHAR_FIXES.items():
        if len(bad) > 1 and bad in text:
            text = text.replace(bad, good)
    return text


def normalize_plain(text):
    if not text:
        return None
    text = str(text).strip()
    return PLAIN_NORMALIZE.get(text, text.replace('평원', ''))


def normalize_pasture(text):
    """목장 이름 정규화: '심기욱목장' → '심기욱'"""
    if not text:
        return None
    text = fix_text(text)
    text = text.strip().replace('목장', '').strip()
    return text if text else None


def normalize_address(addr):
    """주소에 울산광역시 prefix 자동 추가"""
    if not addr:
        return ''
    addr = addr.strip()
    if not addr:
        return ''
    if '울산광역시' in addr:
        return addr
    # 동구/북구/남구/중구/울주군은 울산
    ULSAN_DISTRICTS = ['동구', '북구', '남구', '중구', '울주군']
    for d in ULSAN_DISTRICTS:
        if addr.startswith(d):
            return f'울산광역시 {addr}'
    return addr  # 외지 주소는 그대로


def normalize_phone(text):
    """전화번호에서 OCR 공백/특수문자 제거 후 표준 형식으로"""
    if not text:
        return ''
    # 공백, 점, 콜론, 한글 모두 제거
    cleaned = re.sub(r'[\s가-힣:.]+', '', text)
    # "010-1234-5678" 패턴
    m = re.search(r'(0\d{1,2})-?(\d{3,4})-?(\d{4})', cleaned)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    # 지역번호 + 4자리 (예: 233-3812)
    m = re.search(r'(\d{3})-?(\d{4})', cleaned)
    if m:
        return f'{m.group(1)}-{m.group(2)}'
    return ''


def is_phone(text):
    """공백 제거 후 전화 패턴 확인"""
    if not text:
        return False
    cleaned = re.sub(r'\s+', '', text)
    # 010-xxxx-xxxx (휴대폰)
    if re.search(r'0\d{1,2}-?\d{3,4}-?\d{4}', cleaned):
        return True
    # xxx-xxxx (자택)
    if re.match(r'^\d{3}-?\d{4}$', cleaned):
        return True
    return False


def is_korean_name(text):
    return bool(re.match(r'^[가-힣]{2,4}$', (text or '').strip()))


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


def extract_role(text):
    if not text:
        return None
    text = text.strip()
    for role in ROLES_KNOWN:
        if role in text:
            return role
    return None


ADDRESS_KEYWORDS = ['동구', '북구', '남구', '중구', '울주군', '경북', '서울', '경기',
                    '부산', '대구', '광주', '대전', '인천', '울산', '동부']

HEADER_WORDS = {'번호', '성명', '직분', '주소', '가족', '자택', '휴대폰', '목자', '목녀'}


def is_address_line(text):
    text = (text or '').strip()
    return any(text.startswith(k) for k in ADDRESS_KEYWORDS)


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
def parse_pasture_label(text):
    """3-신위식-장영국목장 → (3, 신위식, 장영국)"""
    text = text.strip()
    text = re.sub(r'^\d+_\s*', '', text)
    parts = re.split(r'[-_]', text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 3:
        if re.match(r'^\d$', parts[0]):
            return parts[0], fix_text(parts[1]), normalize_pasture(parts[2])
    if len(parts) == 2:
        return None, fix_text(parts[0]), normalize_pasture(parts[1])
    return None, None, normalize_pasture(text)


def parse_name_spouse(text):
    """장영국(곽순이) → (장영국, 곽순이)"""
    text = text.strip()
    m = re.match(r'([가-힣]{2,4})\s*[\(\[]\s*([가-힣]{2,4})\s*[\)\]]', text)
    if m:
        return fix_text(m.group(1)), fix_text(m.group(2))
    if is_korean_name(text):
        return fix_text(text), None
    return None, None


def parse_photo_page(page, page_num):
    spans = get_spans(page)
    if not spans:
        return []

    members = []
    name_anchors = [s for s in spans
                    if re.match(r'[가-힣]{2,4}\s*[\(\[]', s['text'])
                    and s['y'] > 200]

    for anchor in name_anchors:
        y_anchor = anchor['y']
        x_anchor = anchor['x']

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

        members.append({
            'name': name,
            'spouse': spouse,
            'home_phone': home_phone,
            'mobile': mobile,
            'plain': normalize_plain(plain),
            'grassland': fix_text(grassland) if grassland else None,
            'pasture': pasture,
            'page': page_num,
            'source': 'photo',
        })

    return members


# ============================================================
# 목장 페이지 파서
# ============================================================
def parse_pasture_page(page, page_num):
    spans = get_spans(page)
    if not spans:
        return None

    body = [s for s in spans if s['y'] >= 230]
    header = [s for s in spans if s['y'] < 230]

    addr_col_x = 245

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
        t_fixed = fix_text(t)
        if is_korean_name(t_fixed) and t_fixed not in HEADER_WORDS:
            if s['x'] < 350 and not shepherd:
                shepherd = t_fixed
            elif s['x'] >= 350 and not shepherdess:
                shepherdess = t_fixed
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

            # 전화 컬럼
            if x >= 365:
                if 'T.' in t or t.startswith('T '):
                    home_phone = normalize_phone(t)
                elif is_phone(t):
                    normalized = normalize_phone(t)
                    if normalized and normalized.startswith('01') and normalized not in mobile_phones:
                        mobile_phones.append(normalized)
                continue

            # 주소/가족 컬럼
            if 235 <= x < 365:
                t_clean = t.strip()
                if is_address_line(t_clean) or any(k in t_clean[:6] for k in ['(', '아파트', '빌라', '동', '호', '번지', '로 ', '길 ']):
                    addr_parts.append(t_clean)
                else:
                    children_parts.append(t_clean)
                continue

            # 직분 + 이름 컬럼
            if x < 235:
                t_clean = re.sub(r'^\d+\s*[\|\.]?\s*', '', t.strip())
                for part in re.split(r'[\|]', t_clean):
                    part = part.strip()
                    if not part:
                        continue
                    role = extract_role(part)
                    if role:
                        if role not in roles:
                            roles.append(role)
                        rest = fix_text(part.replace(role, '').strip())
                        if is_korean_name(rest) and rest not in names and rest not in HEADER_WORDS:
                            names.append(rest)
                    elif is_korean_name(fix_text(part)) and fix_text(part) not in HEADER_WORDS:
                        n = fix_text(part)
                        if n not in names:
                            names.append(n)

        # 자녀 정리
        children = []
        for cp in children_parts:
            tokens = cp.split()
            for tok in tokens:
                tok = fix_text(tok.strip(',.|'))
                if not tok:
                    continue
                if len(tok) >= 6 and len(tok) % 3 == 0:
                    chunks = [tok[i:i+3] for i in range(0, len(tok), 3)]
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
            'address': normalize_address(' '.join(addr_parts).strip()),
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
# 메인
# ============================================================
def main():
    doc = fitz.open(PDF)
    print(f'Total pages: {doc.page_count}')

    print('\n=== Phase 1: 사진 페이지 ===')
    photo_members = []
    for i in range(*PHOTO_PAGE_RANGE):
        members = parse_photo_page(doc[i], i + 1)
        photo_members.extend(members)
    print(f'사진 페이지 회원: {len(photo_members)}')

    print('\n=== Phase 2: 목장 페이지 ===')
    pasture_pages = []
    total_h = 0
    for i in range(*PASTURE_PAGE_RANGE):
        result = parse_pasture_page(doc[i], i + 1)
        if result and result['households']:
            pasture_pages.append(result)
            total_h += len(result['households'])
    print(f'목장 페이지: {len(pasture_pages)} (총 {total_h} 가족)')

    raw_data = {
        'photo_members': photo_members,
        'pasture_pages': pasture_pages,
    }
    with open(os.path.join(OUT_DIR, 'raw_data_v3.json'), 'w', encoding='utf-8') as f:
        json.dump(raw_data, f, ensure_ascii=False, indent=2, default=str)
    print(f'\n💾 Saved: raw_data_v3.json')


if __name__ == '__main__':
    main()
