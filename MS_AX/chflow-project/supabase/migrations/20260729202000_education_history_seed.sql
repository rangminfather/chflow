-- Capability, course master, and current-policy seed.

insert into public.app_capabilities(capability_key, description)
values
  ('education_history.read', '로그인 성도의 공개 교육이력 조회'),
  ('education_history.manage', '교육이력 연결·수정·제외'),
  ('education_history.import', '교육 원본 자료 파싱 및 staging 적재'),
  ('education_history.approve', '검수 행 승인 및 승인 취소'),
  ('education_course.manage', '표준 과정·별칭·정책 관리'),
  ('education_history.audit.read', '민감 감사 로그 조회')
on conflict (capability_key) do update
set description = excluded.description, active = true;

insert into public.app_capability_grants(capability_key, principal_type, principal_key)
values ('education_history.read', 'authenticated', '*')
on conflict do nothing;

insert into public.app_capability_grants(capability_key, principal_type, principal_key)
select c.capability_key, 'system_role', r.role_key
from (
  values
    ('education_history.manage'),
    ('education_history.import'),
    ('education_history.approve'),
    ('education_course.manage')
) c(capability_key)
cross join (values ('admin'), ('office'), ('pastor')) r(role_key)
on conflict do nothing;

insert into public.app_capability_grants(capability_key, principal_type, principal_key)
select c.capability_key, 'member_sub_role', r.role_key
from (
  values
    ('education_history.manage'),
    ('education_history.import'),
    ('education_history.approve'),
    ('education_course.manage')
) c(capability_key)
cross join (values ('교육사'), ('간사'), ('삶공부강사')) r(role_key)
on conflict do nothing;

insert into public.app_capability_grants(capability_key, principal_type, principal_key)
values ('education_history.audit.read', 'system_role', 'admin')
on conflict do nothing;

insert into public.education_courses(name, normalized_name, category, default_audience, sort_order)
values
  ('생명의삶', '생명의삶', 'life_study', 'adult', 10),
  ('새로운삶', '새로운삶', 'life_study', 'adult', 20),
  ('확신의삶', '확신의삶', 'life_study', 'adult', 30),
  ('경건의삶', '경건의삶', 'life_study', 'adult', 40),
  ('하경의삶', '하경의삶', 'life_study', 'adult', 50),
  ('부부의삶', '부부의삶', 'life_study', 'couple', 60),
  ('부모의삶', '부모의삶', 'life_study', 'parent', 70),
  ('말씀의삶', '말씀의삶', 'life_study', 'adult', 80),
  ('목자목녀의삶', '목자목녀의삶', 'life_study', 'leader', 90),
  ('선교의삶', '선교의삶', 'life_study', 'adult', 100),
  ('자유케하는삶', '자유케하는삶', 'life_study', 'adult', 110),
  ('기도의삶', '기도의삶', 'life_study', 'adult', 120),
  ('통독의삶', '통독의삶', 'life_study', 'adult', 130),
  ('행복의삶', '행복의삶', 'life_study', 'adult', 140),
  ('싱글의삶', '싱글의삶', 'life_study', 'adult', 150),
  ('일터의삶', '일터의삶', 'life_study', 'adult', 160),
  ('교사의삶', '교사의삶', 'life_study', 'leader', 170),
  ('예비부부의삶', '예비부부의삶', 'life_study', 'couple', 180),
  ('영적전쟁과 자유케 하는 삶', '영적전쟁과자유케하는삶', 'life_study', 'adult', 190),
  ('관계전도의삶', '관계전도의삶', 'life_study', 'adult', 200),
  ('어린이생명의삶', '어린이생명의삶', 'life_study', 'child', 210),
  ('청소년생명의삶', '청소년생명의삶', 'life_study', 'youth', 220),
  ('어린이 삶공부', '어린이삶공부', 'life_study', 'child', 230),
  ('청소년 삶공부', '청소년삶공부', 'life_study', 'youth', 240),
  ('확신반', '확신반', 'discipleship', 'adult', 300),
  ('성장반', '성장반', 'discipleship', 'adult', 310),
  ('일대일제자양육', '일대일제자양육', 'discipleship', 'adult', 320),
  ('전도폭발', '전도폭발', 'mission_training', 'adult', 330),
  ('PET전도훈련', 'pet전도훈련', 'mission_training', 'adult', 340),
  ('MLTS', 'mlts', 'leadership_training', 'leader', 350),
  ('LMTC', 'lmtc', 'lmtc', 'adult', 360),
  ('어성경이읽어지네 구약', '어성경이읽어지네구약', 'bible_training', 'adult', 370),
  ('어성경이읽어지네 신약', '어성경이읽어지네신약', 'bible_training', 'adult', 380),
  ('부부성장학교', '부부성장학교', 'family_ministry', 'couple', 390),
  ('남편사랑교실', '남편사랑교실', 'family_ministry', 'couple', 400),
  ('크로스웨이', '크로스웨이', 'bible_training', 'adult', 410)
on conflict (normalized_name, default_audience) do update
set name = excluded.name, category = excluded.category,
    sort_order = excluded.sort_order, active = true, deleted_at = null;

insert into public.education_course_policies(
  course_id, requirement_type, effective_from, effective_to, policy_name, note
)
select
  c.id,
  case
    when c.normalized_name in ('생명의삶', '새로운삶', '확신의삶', '경건의삶', '하경의삶')
      and c.default_audience = 'adult'
    then 'basic_required'
    when c.category = 'life_study' and c.default_audience in ('adult', 'couple', 'parent', 'leader')
    then 'elective'
    when c.category = 'life_study' then 'not_applicable'
    else 'not_applicable'
  end,
  null,
  null,
  '현재 안내자료 기준',
  case
    when c.default_audience in ('child', 'youth')
    then '성인 기본필수과정으로 자동 인정하지 않음'
    else '정확한 시행일 미확인; 과거 수료 당시 정책 판정에는 사용하지 않음'
  end
from public.education_courses c
where not exists (
  select 1
  from public.education_course_policies p
  where p.course_id = c.id
    and p.policy_name = '현재 안내자료 기준'
    and p.effective_from is null
    and p.effective_to is null
);

