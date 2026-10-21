-- 6-1 기간 마감 집계 / 6-2 보정 계수 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 시나리오: 10.26~11.01 기간의 권장량을 계산 → 그 주에 카페라떼 20잔 판매 + 우유 5L 폐기 → 마감 실행
-- 역할: 마감 실행은 점주(owner) 로그인으로 한다(스케줄러는 JWT 없이 같은 함수를 부른다).
-- 기대 1) 원두: 기초 4, 실제 소진 0.36 (= 0.018 × 20), 기말 3.64, 예측은 권장량 기록의 예상 소진량(13.3)
-- 기대 2) 우유: 실제 소진 = 판매 4 + 폐기 5 = 9, 폐기량 5
-- 기대 3) 보정 계수: 최근 3기간(시드 10.05~10.11 + 이번 기간) 합산 비율이 0.8 미만이라 하한 0.80, effective_from 11.02, 이력 새 행
-- 기대 4) 다시 실행해도 새로 만들어지는 것 없음(건수 0, 알림 추가 없음)
-- 기대 5) 다음 주(11.02) 권장 발주량 계산이 새 계수 0.8 을 사용
begin;

-- ── 로그인 시뮬레이션 도우미 (이 트랜잭션 안에서만 존재). 원격에는 Auth 사용자 4명이 있어야 한다 ──
create schema _t;
grant usage on schema _t to public;
create table _t.uid (email text primary key, id uuid not null);
grant select on _t.uid to public;
insert into auth.users (email, email_confirmed_at)
select e, now() from unnest(array['owner@example.com','jang@example.com','jung@example.com','park@example.com']) e
 where not exists (select 1 from auth.users a where lower(a.email) = e);
insert into _t.uid select lower(email), id from auth.users
 where lower(email) in ('owner@example.com','jang@example.com','jung@example.com','park@example.com');
create function _t.as_user(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  execute 'reset role';
  select id into v from _t.uid where email = p_email;
  if v is null then raise exception '테스트 사용자 없음: %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on all functions in schema _t to public;

select calculate_order_recommendations('2026-10-26') as recs_made;
insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('TEST-C1', 2, '2026-10-27 10:00:00+09', 20, 100000);
insert into inventory_change (ingredient_id, change_type, change_qty, reason, handled_by, changed_at)
values (2, '폐기', -5, '유통기한 경과', 2, '2026-10-28 18:00:00+09');
update inventory set current_qty = current_qty - 5 where ingredient_id = 2;

select count(*) as noti_before from notification;
select _t.as_user('owner@example.com');
select run_period_close('2026-10-26') as result;
reset role;

select i.ingredient_name, e.opening_stock, e.closing_stock, e.actual_usage, e.forecast_usage, e.error_qty, e.error_rate, e.waste_qty
  from forecast_error e join ingredient i using (ingredient_id)
 where e.period_start = '2026-10-26' and e.ingredient_id in (1, 2) order by e.ingredient_id;
select i.ingredient_name, c.previous_value, c.coefficient, c.effective_from, (c.error_id is not null) as linked
  from correction_coefficient c join ingredient i using (ingredient_id)
 where c.effective_from = '2026-11-02' order by c.ingredient_id;
select count(*) as noti_after from notification;
select type, content from notification where type in ('오차 리포트', '보정 계수') order by notification_id;

select _t.as_user('owner@example.com');
select run_period_close('2026-10-26') as second_run;
reset role;
select count(*) as noti_after_second_run from notification;

select calculate_order_recommendations('2026-11-02') as recs_next;
select i.ingredient_name, r.forecast_usage, c.coefficient as factor, r.recommended_qty
  from order_recommendation r join ingredient i using (ingredient_id) left join correction_coefficient c using (coefficient_id)
 where r.period_start = '2026-11-02' and r.ingredient_id in (1, 2) order by r.ingredient_id;

rollback;
