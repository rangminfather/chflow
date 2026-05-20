-- Dialog-confirmed corrections from the directory OCR review.

update public.members
set sub_role = '서리집사'
where id = '145a4035-222f-455e-bb25-098fa6eb4c89'::uuid
  and status = 'active'
  and name = '박동철'
  and source_page = 50;

update public.members
set sub_role = '은퇴권사'
where id = 'b3bcd192-e308-489c-b197-eb9e183002a5'::uuid
  and status = 'active'
  and name = '박명애'
  and source_page = 50;
