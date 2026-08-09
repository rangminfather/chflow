-- 해외선교 후원목장 "목장일지"(UMS cell2021_XX 게시판) 조회 기능
--
-- 사용자 본인 UMS 계정(user_ums_credentials)으로 로그인해서 어느 게시판(id+category)이
-- 본인 목장인지 매번 60여개 후보를 다시 뒤지면 느리므로, 한 번 찾은 결과를 캐싱한다.
-- 못 찾은 경우도 캐싱한다(찾을 때까지 매번 60여개 후보 로그인 시도하는 낭비 방지).

alter table user_ums_credentials
  add column if not exists cell_board_id       text,
  add column if not exists cell_board_category integer,
  add column if not exists cell_board_label    text,
  add column if not exists cell_board_checked_at timestamptz;
