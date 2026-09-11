-- =============================================================
-- bible_versions.is_active 를 실제 서빙 상태와 맞춘다
--
--   NKRV는 20260911 "feat(bible): serve NKRV text from R2" 부터 R2(bible/NKRV/*.json)
--   에서 직접 서빙되고 있다(app/api/bible/reference/route.ts, bible_verses 테이블 안 씀).
--   그런데 bible_versions.is_active 는 예전 계획(bible_verses 테이블에 절 데이터를 채운 뒤
--   켜기)대로 아직 false로 남아 있었다 — 실제로는 이미 성도들에게 보이고 있는데
--   list_bible_versions() 호출 시 목록에 안 잡히는 상태.
--
--   지금 list_bible_versions() 를 쓰는 곳은 저작권 안내 연결(copyright_slug)뿐이라
--   이 값을 바로잡아도 기존 화면(성경책 메뉴 자체는 이 RPC를 안 씀)에 영향이 없다.
-- =============================================================

update public.bible_versions
set is_active = true
where code = 'NKRV';
