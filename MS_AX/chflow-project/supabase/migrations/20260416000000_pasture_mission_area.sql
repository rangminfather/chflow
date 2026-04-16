-- directory_pastures에 선교후원(mission_area) 컬럼 추가
ALTER TABLE public.directory_pastures
  ADD COLUMN IF NOT EXISTS mission_area text;

-- admin_search_members / find_member_for_signup 은 mission_area를 노출하지 않음 (필요 시 별도 RPC 추가)
