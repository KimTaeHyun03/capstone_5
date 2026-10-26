-- 스케줄 초안의 가능시간 규칙 검증(대상 주차 제출분 우선, 미제출은 모두 가능, 불가 표시는 제외) — 끝에 rollback 하므로 데이터가 남지 않는다. 시스템 호출(JWT 없음)로 실행한다.
-- 기대 1) 그 주에 월요일만 낸 직원은 월요일에만 배정된다(다른 요일 배정 없음)
-- 기대 2) 그 주에 아무것도 안 낸 직원(과거·다른 주 가능시간만 있음)은 모든 시간 가능으로 보고 배정된다
-- 기대 3) "불가" 표시를 낸 직원은 배정되지 않는다
-- 기대 4) get_schedule 의 staff: 제출 true, 미제출 false(가능시간은 전 요일), 불가 표시는 제출 true·가능시간 없음
begin;

do $$
declare
  v_store bigint;
  v_a bigint; v_b bigint; v_c bigint; v_owner bigint; v_auth uuid := gen_random_uuid();
  v_week date := date '2027-02-01';
  r jsonb;
begin
  insert into store (store_name) values ('가능시간 주차 테스트') returning store_id into v_store;
  insert into auth.users (id, email, email_confirmed_at) values (v_auth, 'wk-owner@example.invalid', now());
  insert into user_account (store_id, login_id, password_hash, name, role, status, auth_user_id) values (v_store, 'wk-owner', 'x', '테스트점주', '점주', '활성', v_auth) returning user_id into v_owner;
  insert into user_account (store_id, login_id, password_hash, name, role, max_weekly_hours, status) values (v_store, 'wk-a', 'x', '제출', '알바생', 40, '활성') returning user_id into v_a;
  insert into user_account (store_id, login_id, password_hash, name, role, max_weekly_hours, status) values (v_store, 'wk-b', 'x', '미제출', '알바생', 40, '활성') returning user_id into v_b;
  insert into user_account (store_id, login_id, password_hash, name, role, max_weekly_hours, status) values (v_store, 'wk-c', 'x', '불가', '알바생', 40, '활성') returning user_id into v_c;

  insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week) values (v_a, 0, '08:00', '22:00', now(), v_week);
  -- 미제출: 주차 없는 과거 가능시간만 있음 / 다른 주 가능시간만 있음 (둘 다 이 주에는 쓰면 안 됨)
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at) values (v_b, 0, '08:00', '22:00', now());
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week) values (v_b, 0, '08:00', '22:00', now(), v_week - 7);
  -- 불가 표시
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week, is_unavailable) values (v_c, 0, '00:00', '00:00', now(), v_week, true);

  -- 점주로 로그인한 상태(JWT)에서 화면과 같은 경로(래퍼)로 호출한다
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  perform generate_schedule_draft(v_store, v_week);

  assert (select count(*) from shift_assignment sa join work_schedule w using (schedule_id) where w.store_id = v_store and sa.user_id = v_a) > 0, '월요일을 낸 직원은 배정되어야 함';
  assert (select count(*) from shift_assignment sa join work_schedule w using (schedule_id) where w.store_id = v_store and sa.user_id = v_a and sa.work_date <> v_week) = 0, '월요일만 낸 직원은 다른 요일에 배정되면 안 됨';
  assert (select count(*) from shift_assignment sa join work_schedule w using (schedule_id) where w.store_id = v_store and sa.user_id = v_b and sa.work_date <> v_week) > 0, '미제출 직원은 모든 시간 가능으로 보고 다른 요일에도 배정되어야 함';
  assert (select count(*) from shift_assignment sa join work_schedule w using (schedule_id) where w.store_id = v_store and sa.user_id = v_c) = 0, '불가 표시 직원은 배정되면 안 됨';

  r := get_schedule(v_store, v_week);
  perform set_config('request.jwt.claims', '', true);
  assert (select (e->>'submitted')::boolean from jsonb_array_elements(r->'staff') e where (e->>'user_id')::bigint = v_a), '제출 직원 submitted = true';
  assert not (select (e->>'submitted')::boolean from jsonb_array_elements(r->'staff') e where (e->>'user_id')::bigint = v_b), '미제출 직원 submitted = false';
  assert (select (e->>'submitted')::boolean from jsonb_array_elements(r->'staff') e where (e->>'user_id')::bigint = v_c), '불가 표시도 제출로 봄';
  assert jsonb_array_length((select e->'ranges' from jsonb_array_elements(r->'staff') e where (e->>'user_id')::bigint = v_c)) = 0, '불가 표시 직원은 가능시간 없음';
  assert jsonb_array_length((select e->'ranges' from jsonb_array_elements(r->'staff') e where (e->>'user_id')::bigint = v_b)) = 7, '미제출 직원은 전 요일 가능으로 내려옴';

  raise notice 'availability_by_week: PASS';
end $$;

rollback;
