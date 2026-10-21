-- 인증 기준 권한 검증 — 20261028000100_auth_permissions.sql 적용 후. 끝에 rollback 하므로 데이터가 남지 않는다.
-- psql 전용 명령이 없어 SQL Editor / `supabase db query --linked -f` 로도 실행된다. 실패하면 assert 가 오류를 낸다.
-- 마지막에 'PASS' 한 줄이 나오면 모두 통과. (원격에는 Auth 사용자 3명이 이미 있어야 한다: owner·jang·jung @example.com)
begin;

-- ── 로그인 시뮬레이션 도우미 (이 트랜잭션 안에서만 존재) ──────────────────────────
create schema _t;
grant usage on schema _t to public;
create table _t.uid (email text primary key, id uuid not null);
grant select on _t.uid to public;

-- 로컬에는 Auth 사용자가 없어서 만든다(이미 있으면 건드리지 않는다). 연결은 0단계 트리거가 한다.
insert into auth.users (email, email_confirmed_at)
select e, now() from unnest(array['owner@example.com','jang@example.com','jung@example.com']) e
 where not exists (select 1 from auth.users a where lower(a.email) = e);
insert into _t.uid select lower(email), id from auth.users
 where lower(email) in ('owner@example.com','jang@example.com','jung@example.com');

create function _t.as_user(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  execute 'reset role';
  select id into v from _t.uid where email = p_email;
  if v is null then raise exception '테스트 사용자 없음: %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function _t.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create function _t.as_system() returns void language plpgsql as $$   -- 스케줄러처럼 JWT 가 없는 호출
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 실행해 보고 "권한 없음(42501)"이면 true, 성공하면 false, 다른 오류는 그대로 던진다
create function _t.denied(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then return true;
end $$;
-- 실행한 문장이 건드린 행 수(RLS 로 막힌 UPDATE/DELETE 는 오류 없이 0행)
create function _t.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- 읽을 수 있는 행 수(테이블 권한이 없으면 -1)
create function _t.rows(p_table text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s', p_table) into n;
  return n;
exception when insufficient_privilege then return -1;
end $$;

grant execute on all functions in schema _t to public;

-- 다른 매장 재료·발주 (같은 매장 검사용)
insert into store (store_id, store_name, address, phone, open_time, close_time, closed_days)
values (2, '다른 카페', '서울', '02-000-0002', '08:00', '22:00', '없음');
insert into ingredient (ingredient_id, store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock)
values (900, 2, '타매장 재료', 'kg', 'kg', 1, 1000, 1);
insert into inventory (ingredient_id, current_qty, updated_at, is_short) values (900, 5, now(), false);
insert into purchase_order (order_id, ingredient_id, ordered_by, order_qty, is_adjusted, status, ordered_at)
values (9000, 900, 1, 5, false, '대기', now());

-- ── 1. 비로그인(anon): 아무것도 읽거나 실행하지 못한다 ───────────────────────────
select _t.as_anon();
do $$
declare t text;
begin
  foreach t in array array['ingredient','inventory','menu','store','order_recommendation','purchase_order','correction_coefficient',
                           'attendance','payroll','work_schedule','shift_assignment','shortage_report','notification','forecast_error','sales_summary'] loop
    assert _t.rows(t) <= 0, format('anon 이 %s 를 읽을 수 있음', t);
  end loop;
  assert _t.rows('user_account') <= 0, 'anon 이 user_account 를 읽을 수 있음';

  assert _t.denied('select record_stock_adjustment(1, ''폐기'', 1, 2)'), 'anon: record_stock_adjustment';
  assert _t.denied('select submit_shortage_report(1, 3)'), 'anon: submit_shortage_report';
  assert _t.denied('select resolve_shortage_report(1)'), 'anon: resolve_shortage_report';
  assert _t.denied('select mark_notifications_read(1)'), 'anon: mark_notifications_read';
  assert _t.denied('select calculate_order_recommendations()'), 'anon: calculate_order_recommendations';
  assert _t.denied('select place_purchase_order(1, ''[]''::jsonb)'), 'anon: place_purchase_order';
  assert _t.denied('select receive_purchase_order(1, ''[]''::jsonb)'), 'anon: receive_purchase_order';
  assert _t.denied('select run_period_close()'), 'anon: run_period_close';
  assert _t.denied('select clock_in(3)'), 'anon: clock_in';
  assert _t.denied('select clock_out(3)'), 'anon: clock_out';
  assert _t.denied('select get_availability(3)'), 'anon: get_availability';
  assert _t.denied('select save_availability(3, ''[]''::jsonb, 10)'), 'anon: save_availability';
  assert _t.denied('select get_schedule(1, date ''2026-10-26'')'), 'anon: get_schedule';
  assert _t.denied('select generate_schedule_draft(1, date ''2026-10-26'')'), 'anon: generate_schedule_draft';
  -- 내부용 함수도 직접 호출 불가
  assert _t.denied('select apply_stock_delta(1, 1)'), 'anon: apply_stock_delta';
  assert _t.denied('select run_weekly_jobs()'), 'anon: run_weekly_jobs';
  assert _t.denied('select record_stock_adjustment_impl(1, ''폐기'', 1, 2, null)'), 'anon: _impl';
end $$;
select 'anon 차단: OK' as step;

-- ── 2. 알바생(jung = user 3): 본인 것만, 관리 기능은 거부 ─────────────────────────
select _t.as_user('jung@example.com');
do $$
begin
  -- 관리·점주 전용
  assert _t.denied('select record_stock_adjustment(1, ''폐기'', 1, 3)'), '알바생: 실사·폐기';
  assert _t.denied('select resolve_shortage_report(1)'), '알바생: 신고 확인';
  assert _t.denied('select calculate_order_recommendations()'), '알바생: 권장량 계산';
  assert _t.denied('select place_purchase_order(3, ''[{"ingredient_id":1,"qty":1}]''::jsonb)'), '알바생: 발주';
  assert _t.denied('select receive_purchase_order(3, ''[]''::jsonb)'), '알바생: 입고';
  assert _t.denied('select run_period_close()'), '알바생: 마감';
  assert _t.denied('select generate_schedule_draft(1, date ''2026-10-26'')'), '알바생: 초안 생성';
  -- 남의 id 로는 안 됨
  assert _t.denied('select clock_in(4)'), '알바생: 남의 출근';
  assert _t.denied('select clock_out(4)'), '알바생: 남의 퇴근';
  assert _t.denied('select mark_notifications_read(1)'), '알바생: 남의 알림 읽음';
  assert _t.denied('select submit_shortage_report(1, 4)'), '알바생: 남의 이름으로 신고';
  assert _t.denied('select save_availability(4, ''[]''::jsonb, 10)'), '알바생: 남의 가능시간 저장';
  assert _t.denied('select get_availability(4)'), '알바생: 남의 가능시간 조회';
  -- 다른 매장
  assert _t.denied('select submit_shortage_report(900, 3)'), '알바생: 다른 매장 재료 신고';
  assert _t.denied('select get_schedule(2, date ''2026-10-26'')'), '알바생: 다른 매장 스케줄';
  -- 본인 것은 가능
  assert not _t.denied('select submit_shortage_report(1, 3, ''거의 없음'', ''테스트'')'), '알바생: 본인 신고는 가능해야 함';
  assert not _t.denied('select mark_notifications_read(3)'), '알바생: 본인 알림 읽음은 가능해야 함';
  assert not _t.denied('select get_availability(3)'), '알바생: 본인 가능시간 조회는 가능해야 함';
  assert not _t.denied('select clock_in(3)'), '알바생: 본인 출근은 가능해야 함';
  assert not _t.denied('select clock_out(3)'), '알바생: 본인 퇴근은 가능해야 함';
  -- 우회 경로(직접 쓰기)도 닫혀 있어야 함
  assert _t.denied('insert into attendance (user_id, clock_in) values (3, now())'), '알바생: 출퇴근 직접 INSERT';
  assert _t.affected('update attendance set clock_out = now() where user_id = 3') = 0, '알바생: 출퇴근 직접 UPDATE';
  assert _t.denied('insert into notification (recipient_id, type, source, content, sent_at, is_read) values (1, ''x'', ''x'', ''spam'', now(), false)'), '알바생: 알림 직접 INSERT';
  assert _t.denied('insert into shortage_report (ingredient_id, reporter_id, reported_at, status) values (1, 3, now(), ''접수'')'), '알바생: 신고 직접 INSERT';
  assert _t.affected('update inventory set current_qty = 9999') = 0, '알바생: 재고 직접 UPDATE';
  -- 읽기 범위: 매출은 못 보고, 급여는 본인 것만
  assert _t.rows('sale') = 0, '알바생이 매출을 볼 수 있음';
  assert _t.rows('sales_summary') = 0, '알바생이 매출 집계를 볼 수 있음';
  assert (select count(*) from payroll where user_id <> 3) = 0, '알바생이 남의 급여를 볼 수 있음';
  assert _t.rows('inventory') > 0, '알바생도 재고는 볼 수 있어야 함';
end $$;
select 'alba role: OK' as step;

-- ── 3. 매니저(jang = user 2): 재고·입고·검토는 가능, 발주·마감은 불가 ─────────────
select _t.as_user('jang@example.com');
do $$
begin
  assert not _t.denied('select record_stock_adjustment(1, ''실사 보정'', 4, 2)'), '매니저: 실사는 가능해야 함';
  assert _t.denied('select record_stock_adjustment(1, ''실사 보정'', 4, 3)'), '매니저: 남의 id 로 실사';
  assert _t.denied('select record_stock_adjustment(900, ''실사 보정'', 1, 2)'), '매니저: 다른 매장 재료 실사';
  assert not _t.denied('select resolve_shortage_report(report_id) from shortage_report limit 1'), '매니저: 신고 확인은 가능해야 함';
  assert _t.denied('select place_purchase_order(2, ''[{"ingredient_id":1,"qty":1}]''::jsonb)'), '매니저: 발주는 점주만';
  assert _t.denied('select calculate_order_recommendations()'), '매니저: 권장량 계산은 점주만';
  assert _t.denied('select run_period_close()'), '매니저: 마감은 점주만';
  assert _t.denied('select generate_schedule_draft(1, date ''2026-10-26'')'), '매니저: 초안 생성은 점주만';
  assert _t.denied('select receive_purchase_order(2, ''[{"order_id":9000,"received_qty":5}]''::jsonb)'), '매니저: 다른 매장 발주 입고';
  assert not _t.denied('select get_availability(3)'), '매니저: 직원 가능시간 조회는 가능해야 함';
  assert _t.affected('update inventory set current_qty = 9999') = 0, '매니저: 재고 직접 UPDATE';
  assert _t.denied('insert into receipt (order_id, handled_by, received_qty, received_at) values (1, 2, 1, now())'), '매니저: 입고 직접 INSERT';
end $$;
select 'manager role: OK' as step;

-- ── 4. 점주(owner = user 1): 발주·마감·초안 생성은 가능, 다른 매장은 불가 ───────────
select _t.as_user('owner@example.com');
do $$
begin
  assert not _t.denied('select calculate_order_recommendations(date ''2026-10-26'')'), '점주: 권장량 계산';
  assert not _t.denied('select place_purchase_order(1, jsonb_build_array(jsonb_build_object(''ingredient_id'',1,''qty'',1)))'), '점주: 발주';
  assert _t.denied('select place_purchase_order(2, ''[{"ingredient_id":1,"qty":1}]''::jsonb)'), '점주: 남의 id 로 발주';
  assert _t.denied('select place_purchase_order(1, ''[{"ingredient_id":900,"qty":1}]''::jsonb)'), '점주: 다른 매장 재료 발주';
  assert not _t.denied('select run_period_close(date ''2026-10-12'')'), '점주: 마감';
  assert not _t.denied('select generate_schedule_draft(1, date ''2026-11-02'')'), '점주: 초안 생성';
  assert _t.denied('select generate_schedule_draft(2, date ''2026-11-02'')'), '점주: 다른 매장 초안 생성';
  assert _t.denied('select get_schedule(2, date ''2026-11-02'')'), '점주: 다른 매장 스케줄 조회';
  assert not _t.denied('select get_schedule(1, date ''2026-11-02'')'), '점주: 스케줄 조회';
end $$;
select 'owner role: OK' as step;

-- ── 5. 알바생의 스케줄 조회: 초안은 안 보이고, 확정되면 보인다(직원 목록은 비워서 준다) ──
select _t.as_user('jung@example.com');
do $$
declare r jsonb;
begin
  r := get_schedule(1, date '2026-11-02');
  assert r is null, '알바생에게 초안 스케줄이 보임';
end $$;
select _t.as_system();
update work_schedule set status = '확정', is_published = true, confirmed_by = 1, confirmed_at = now(), published_at = now() where target_week = '2026-11-02';
select _t.as_user('jung@example.com');
do $$
declare r jsonb;
begin
  r := get_schedule(1, date '2026-11-02');
  assert r is not null and r->>'status' = '확정', '알바생에게 확정 스케줄이 보이지 않음';
  assert jsonb_array_length(r->'staff') = 0, '알바생에게 직원 가능시간 목록이 노출됨';
end $$;
select 'schedule visibility: OK' as step;

-- ── 6. 시스템 호출(스케줄러, JWT 없음): 점주 전용 함수도 실행되고, 로그인한 알바생은 여전히 거부 ─
select _t.as_system();
do $$
begin
  assert not _t.denied('select run_period_close(date ''2026-10-19'')'), '시스템: 마감';
  assert not _t.denied('select calculate_order_recommendations(date ''2026-11-09'')'), '시스템: 권장량 계산';
  assert not _t.denied('select run_weekly_jobs()'), '시스템: 주간 정산';
end $$;
select _t.as_user('jung@example.com');
do $$ begin assert _t.denied('select run_period_close()'), '시스템 호출 이후에도 알바생은 거부되어야 함'; end $$;
select 'system calls: OK' as step;

-- ── 7. anon 이 실행할 수 있는 public 함수는 하나도 없어야 한다 ─────────────────────
select _t.as_system();
do $$
declare bad text;
begin
  select string_agg(proname, ', ') into bad from pg_proc
   where pronamespace = 'public'::regnamespace and prokind = 'f' and has_function_privilege('anon', oid, 'execute');
  assert bad is null, 'anon 이 실행 가능한 public 함수: ' || coalesce(bad, '');
end $$;
select 'anon function sweep: OK' as step;

select 'PASS' as result;
rollback;
