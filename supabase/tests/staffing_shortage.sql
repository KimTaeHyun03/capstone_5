-- 필요 인원 기준(8만/12만)과 인원 부족 알림 검증 — 끝에 rollback 하므로 데이터가 남지 않는다. 시스템 호출 + 점주 JWT 로 실행한다.
-- 기대 1) app.required_staff 경계: 79,999→1, 80,000→2, 119,999→2, 120,000→3
-- 기대 2) 인원이 부족한 초안을 만들면 점주·매니저에게 '인원 부족' 알림 1건씩(알바생 모집·점주 근무 안내 포함), 알바생에게는 없음
-- 기대 3) 같은 주 초안을 다시 만들어도 읽지 않은 알림은 늘지 않고 최신 값 1건만 남는다
begin;

do $$
declare
  v_store bigint; v_owner bigint; v_mgr bigint; v_staff bigint;
  v_auth uuid := gen_random_uuid();
  v_week date := date '2027-03-01';
begin
  assert app.required_staff(79999) = 1 and app.required_staff(80000) = 2 and app.required_staff(119999) = 2 and app.required_staff(120000) = 3, '필요 인원 경계값';

  insert into store (store_name) values ('인원 부족 테스트') returning store_id into v_store;
  insert into auth.users (id, email, email_confirmed_at) values (v_auth, 'short-owner@example.invalid', now());
  insert into user_account (store_id, login_id, password_hash, name, role, status, auth_user_id) values (v_store, 'sh-owner', 'x', '점주', '점주', '활성', v_auth) returning user_id into v_owner;
  insert into user_account (store_id, login_id, password_hash, name, role, max_weekly_hours, status) values (v_store, 'sh-mgr', 'x', '매니저', '매니저', 40, '활성') returning user_id into v_mgr;
  insert into user_account (store_id, login_id, password_hash, name, role, max_weekly_hours, status) values (v_store, 'sh-staff', 'x', '알바', '알바생', 40, '활성') returning user_id into v_staff;
  -- 두 직원 모두 월요일 오전만 가능 → 나머지 시프트는 전부 비게 된다(예측이 없어 시프트당 필요 1명)
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week) values
    (v_mgr, 0, '08:00', '12:00', now(), v_week), (v_staff, 0, '08:00', '12:00', now(), v_week);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  perform generate_schedule_draft(v_store, v_week);

  assert (select count(*) from notification where recipient_id = v_owner and type = '인원 부족') = 1, '점주 인원 부족 알림 1건';
  assert (select count(*) from notification where recipient_id = v_mgr and type = '인원 부족') = 1, '매니저 인원 부족 알림 1건';
  assert (select count(*) from notification where recipient_id = v_staff and type = '인원 부족') = 0, '알바생은 대상 아님';
  assert (select content from notification where recipient_id = v_owner and type = '인원 부족') like '3.01 주 %', '주차 표시: ' || (select content from notification where recipient_id = v_owner and type = '인원 부족');
  assert (select content from notification where recipient_id = v_owner and type = '인원 부족') like '%알바생을 추가로 모집하거나 점주가 직접 근무해야 합니다%', '안내 문구';
  assert (select content from notification where recipient_id = v_owner and type = '인원 부족') like '%20곳%', '부족 시프트 20곳(21칸 중 월요일 오전만 충족): ' || (select content from notification where recipient_id = v_owner and type = '인원 부족');

  perform generate_schedule_draft(v_store, v_week);
  assert (select count(*) from notification where recipient_id = v_owner and type = '인원 부족') = 1, '다시 생성해도 1건 유지';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'staffing_shortage: PASS';
end $$;

rollback;
