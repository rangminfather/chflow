"""
v3 raw_data → Supabase 일괄 import

사용법:
  python import_to_supabase.py

다음을 import:
  1. plains (평원)
  2. grasslands (초원)
  3. directory_pastures (목장)
  4. households (가족)
  5. members (회원) - 부부 + 자녀
"""
import sys, io, json, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import urllib.request
import urllib.error
from collections import defaultdict

OUT_DIR = 'C:/csh/project/chflow/MS_AX/parsed-data'
RAW_PATH = os.path.join(OUT_DIR, 'raw_data_v3.json')

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

if not SUPABASE_URL or not SERVICE_KEY:
    print('환경변수를 설정하세요:')
    print('  SUPABASE_URL=https://your-project.supabase.co')
    print('  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key')
    sys.exit(1)

HEADERS = {
    'apikey': SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}


def http(method, path, body=None):
    url = f'{SUPABASE_URL}/rest/v1{path}'
    data = json.dumps(body).encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f'HTTP {e.code} {method} {path}: {body[:300]}')
        return None


def insert(table, rows):
    """Bulk insert"""
    if not rows:
        return []
    return http('POST', f'/{table}', rows) or []


def delete_all(table):
    """Delete all rows in a table"""
    http('DELETE', f'/{table}?id=neq.00000000-0000-0000-0000-000000000000')


# ============================================================
# 데이터 로드
# ============================================================
with open(RAW_PATH, 'r', encoding='utf-8') as f:
    raw = json.load(f)

photo_members = raw['photo_members']
pasture_pages = raw['pasture_pages']

print(f'사진 페이지 회원: {len(photo_members)}')
print(f'목장 페이지: {len(pasture_pages)}')


# ============================================================
# Step 1: 정리 - 사진 페이지에서 평원/초원/목장 정보 수집
# ============================================================
plain_grass_pasture = set()  # (plain, grassland, pasture) tuples

for pm in photo_members:
    if pm['plain'] and pm['grassland'] and pm['pasture']:
        plain_grass_pasture.add((pm['plain'], pm['grassland'], pm['pasture']))

# 목장 페이지의 목자 이름도 추가 (평원/초원 모르면 분류 안 됨)
for page in pasture_pages:
    if page['shepherd']:
        # 사진 페이지에서 같은 목자 이름 찾기
        for pm in photo_members:
            if pm['pasture'] == page['shepherd'] and pm['plain'] and pm['grassland']:
                plain_grass_pasture.add((pm['plain'], pm['grassland'], page['shepherd']))
                break

print(f'\n수집된 (평원, 초원, 목장) 조합: {len(plain_grass_pasture)}')


# ============================================================
# Step 2: plains/grasslands/pastures 생성
# ============================================================
print('\n=== Step 1: Plains 삽입 ===')
delete_all('plains')

plains_set = sorted(set(p for p, _, _ in plain_grass_pasture))
plain_rows = [
    {
        'name': p,
        'display_name': f'{p}평원' if p != '젊은이' else '젊은이평원',
        'order_no': i,
    }
    for i, p in enumerate(plains_set)
]
inserted_plains = insert('plains', plain_rows)
plain_id_map = {r['name']: r['id'] for r in inserted_plains}
print(f'Plains: {len(inserted_plains)}')

print('\n=== Step 2: Grasslands 삽입 ===')
delete_all('grasslands')
grassland_seen = set()
grassland_rows = []
for p, g, ps in plain_grass_pasture:
    if (p, g) in grassland_seen:
        continue
    grassland_seen.add((p, g))
    grassland_rows.append({
        'plain_id': plain_id_map[p],
        'name': g,
        'order_no': 0,
    })
inserted_grass = insert('grasslands', grassland_rows)
grass_id_map = {(r['plain_id'], r['name']): r['id'] for r in inserted_grass}
print(f'Grasslands: {len(inserted_grass)}')

print('\n=== Step 3: Pastures 삽입 ===')
delete_all('directory_pastures')
pasture_seen = set()
pasture_rows = []
for p, g, ps in plain_grass_pasture:
    key = (p, g, ps)
    if key in pasture_seen:
        continue
    pasture_seen.add(key)
    grass_id = grass_id_map.get((plain_id_map[p], g))
    if not grass_id:
        continue
    pasture_rows.append({
        'grassland_id': grass_id,
        'name': ps,
        'order_no': 0,
    })

# Insert in batches of 100
inserted_past = []
for i in range(0, len(pasture_rows), 100):
    batch = pasture_rows[i:i+100]
    result = insert('directory_pastures', batch)
    if result:
        inserted_past.extend(result)

# Build map: (plain, grassland, pasture_name) → pasture_id
past_id_map = {}
for r in inserted_past:
    # Find plain_name and grassland_name from grass_id_map
    grass_id = r['grassland_id']
    for (pid, gname), gid in grass_id_map.items():
        if gid == grass_id:
            for pname, pl_id in plain_id_map.items():
                if pl_id == pid:
                    past_id_map[(pname, gname, r['name'])] = r['id']
                    break
            break
print(f'Pastures: {len(inserted_past)}')

# 목장 이름만으로도 찾을 수 있게 (목장 페이지에서 평원/초원 모르는 경우 대비)
past_by_name = {}
for k, v in past_id_map.items():
    past_by_name.setdefault(k[2], []).append(v)


# ============================================================
# Step 3: households + members 생성
# ============================================================
print('\n=== Step 4: Households + Members 삽입 ===')

# 기존 데이터 삭제
print('  기존 데이터 삭제...')
http('DELETE', '/members?id=neq.00000000-0000-0000-0000-000000000000')
delete_all('households')

# 사진 페이지를 이름으로 인덱싱 (직분/평원 정보 가져오기 위해)
photo_by_name = defaultdict(list)
for pm in photo_members:
    if pm['name']:
        photo_by_name[pm['name']].append(pm)


def find_photo(name, mobile):
    """이름+휴대폰으로 사진 페이지 매칭"""
    candidates = photo_by_name.get(name, [])
    if not candidates:
        return None
    if mobile:
        for pm in candidates:
            if pm['mobile'] and re.sub(r'[^\d]', '', pm['mobile'])[-4:] == re.sub(r'[^\d]', '', mobile)[-4:]:
                return pm
    return candidates[0]


def find_pasture_id(shepherd_name):
    """목자 이름으로 pasture_id 찾기"""
    if not shepherd_name:
        return None
    # 사진 페이지에서 같은 사람 찾기
    for pm in photo_by_name.get(shepherd_name, []):
        if pm['plain'] and pm['grassland']:
            key = (pm['plain'], pm['grassland'], pm['pasture'] or shepherd_name)
            if key in past_id_map:
                return past_id_map[key]
    # 이름만으로 시도
    if shepherd_name in past_by_name and past_by_name[shepherd_name]:
        return past_by_name[shepherd_name][0]
    return None


# 가족 단위로 처리
households_to_insert = []
members_to_insert = []  # (household_idx, member_data)

for page in pasture_pages:
    shepherd = page['shepherd']
    if not shepherd:
        continue
    pasture_id = find_pasture_id(shepherd)
    if not pasture_id:
        continue  # 평원/초원 모르는 목장은 일단 skip

    # 목자/목녀 가족
    leader_household_idx = len(households_to_insert)
    households_to_insert.append({
        'pasture_id': pasture_id,
        'address': '',
        'home_phone': '',
        'order_no': 0,
    })
    if page['shepherd']:
        members_to_insert.append((leader_household_idx, {
            'name': page['shepherd'],
            'phone': page['shepherd_phone'] or '',
            'family_church': '목자',
            'sub_role': '',
            'spouse_name': page['shepherdess'] or '',
            'guard_status': '비회원',
            'source_page': page['page'],
        }))
    if page['shepherdess']:
        members_to_insert.append((leader_household_idx, {
            'name': page['shepherdess'],
            'phone': page['shepherdess_phone'] or '',
            'family_church': '목녀',
            'sub_role': '',
            'spouse_name': page['shepherd'] or '',
            'guard_status': '비회원',
            'source_page': page['page'],
        }))

    # 일반 가족
    for h in page['households']:
        names = [n for n in h['names'] if n not in ('번호', '성명', '직분', '주소', '가족', '자택', '휴대폰')]
        if not names:
            continue

        h_idx = len(households_to_insert)
        # Address (울산광역시 prefix는 이미 들어있음)
        addr = h.get('address', '')
        households_to_insert.append({
            'pasture_id': pasture_id,
            'address': addr or '',
            'home_phone': h.get('phone_home') or '',
            'order_no': h['no'],
        })

        roles = h['roles']
        mobiles = h['phone_mobiles']
        for i, name in enumerate(names):
            mobile = mobiles[i] if i < len(mobiles) else ''
            spouse = names[1 - i] if len(names) > 1 else None
            sub_role = roles[i] if i < len(roles) else ''
            members_to_insert.append((h_idx, {
                'name': name,
                'phone': mobile,
                'family_church': '목원',
                'sub_role': sub_role,
                'spouse_name': spouse or '',
                'guard_status': '비회원',
                'source_page': h['page'],
            }))

        # 자녀들
        for child in h.get('children', []):
            if not child:
                continue
            members_to_insert.append((h_idx, {
                'name': child,
                'phone': '',
                'family_church': '목원',
                'sub_role': '',
                'spouse_name': '',
                'guard_status': '비회원',
                'source_page': h['page'],
                'is_child': True,
            }))


# Insert households in batches
print(f'  Households to insert: {len(households_to_insert)}')
inserted_households = []
for i in range(0, len(households_to_insert), 100):
    batch = households_to_insert[i:i+100]
    result = insert('households', batch)
    if result:
        inserted_households.extend(result)

print(f'  Inserted households: {len(inserted_households)}')

# Now build members with actual household_id - ensure all have same keys
DEFAULT_KEYS = {
    'name': '',
    'phone': '',
    'family_church': '목원',
    'sub_role': '',
    'spouse_name': '',
    'guard_status': '비회원',
    'source_page': None,
    'is_child': False,
    'household_id': None,
}

members_final = []
for h_idx, member_data in members_to_insert:
    if h_idx >= len(inserted_households):
        continue
    # Merge with defaults to ensure all keys present
    full = {**DEFAULT_KEYS, **member_data}
    full['household_id'] = inserted_households[h_idx]['id']
    members_final.append(full)

# Insert members in batches
print(f'  Members to insert: {len(members_final)}')
inserted_members = []
for i in range(0, len(members_final), 100):
    batch = members_final[i:i+100]
    result = insert('members', batch)
    if result:
        inserted_members.extend(result)

print(f'  Inserted members: {len(inserted_members)}')


# ============================================================
# 통계
# ============================================================
print('\n=== 최종 통계 ===')
print(f'Plains: {len(inserted_plains)}')
print(f'Grasslands: {len(inserted_grass)}')
print(f'Pastures: {len(inserted_past)}')
print(f'Households: {len(inserted_households)}')
print(f'Members: {len(inserted_members)}')
