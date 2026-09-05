-- =============================================================
-- 개역개정 역본 자리 등록 (본문은 아직 넣지 않는다)
--
-- [배경] 지금 성경 본문은 개역한글(KRV) 하나뿐이다. 보호기간이 끝나 자유롭게
--   쓸 수 있는 역본이기 때문이다. 교회에서 실제로 봉독하는 개역개정은
--   대한성서공회가 저작권을 갖고 있어 허락 없이는 넣을 수 없다.
--
-- [이 마이그레이션이 하는 일] 역본 행만 미리 만들어 둔다.
--   is_active = false 이므로 list_bible_versions() 에 나오지 않고,
--   화면에도 뜨지 않는다. 본문 데이터가 0절이라 조회해도 빈 결과다.
--
-- [허락받은 뒤 할 일]
--   1) scripts/import-bible-version.mjs 로 절 데이터를 넣는다
--   2) update public.bible_versions set is_active = true where code = 'NKRV';
--   그러면 화면 역본 선택에 자동으로 나타난다. 앱 코드는 고칠 것이 없다.
--
-- 본문을 넣기 전에 is_active 를 켜지 말 것 — 빈 역본이 화면에 뜬다.
-- =============================================================

insert into public.bible_versions
  (code, name_ko, name_en, language_code, source_url, copyright_note, is_public_domain, is_active)
values (
  'NKRV',
  '개역개정',
  'New Korean Revised Version',
  'ko',
  null,
  '대한성서공회 저작권 보호 중. 사용 허락을 받은 범위 안에서만 사용할 것. 허락 문서·범위를 교회가 보관한다.',
  false,
  false
)
on conflict (code) do update
  set name_ko = excluded.name_ko,
      name_en = excluded.name_en,
      copyright_note = excluded.copyright_note,
      is_public_domain = false;
