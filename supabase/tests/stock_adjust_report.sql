-- 4-3 실사·폐기 / 4-4 부족 신고 / 4-5 알림 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 앞선 마이그레이션(20261021000000·000100·000200)이 적용돼 있어야 한다.
-- 기대 1) 실사: 원두 4 → 5 입력 → 변동 +1 (실사 보정), 부족 해제(is_short=false)
-- 기대 2) 폐기: 우유 18 에서 3 폐기 → 15, 변동 -3, 사유 기록 / 재고보다 많이 폐기하면 오류
-- 기대 3) 신고: 알림 2건(점주·매니저), 신고자 이름 포함, report_id 연결 → 확인 처리 시 status '확인'
-- 기대 4) 권한: 로그인 사용자도 user_account 의 password_hash 는 읽을 수 없고, 신고 테이블에 직접 INSERT 할 수 없다(함수로만)
-- 역할: 실사·폐기·신고 확인은 매니저(jang), 신고는 알바생(jung) 로그인으로 실행한다.
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

select _t.as_user('jang@example.com');

-- 1) 실사 (매니저)
select record_stock_adjustment(1, '실사 보정', 5, 2) as after_count;
select ingredient_id, current_qty, is_short from inventory where ingredient_id = 1;

-- 2) 폐기 (매니저)
select record_stock_adjustment(2, '폐기', 3, 2, '유통기한 경과') as after_waste;
select change_type, change_qty, reason, handled_by from inventory_change where ingredient_id = 2 and change_type = '폐기';
do $$ begin
  perform record_stock_adjustment(2, '폐기', 9999, 2, '테스트');
  raise exception '오류가 나야 하는데 통과했습니다';
exception when others then
  if sqlerrm like '현재 재고%' then raise notice '폐기 초과 거부 OK: %', sqlerrm; else raise; end if;
end $$;

-- 3) 신고 (알바생) → 알림은 점주·매니저에게 → 확인 처리 (매니저)
select _t.as_user('jung@example.com');
select submit_shortage_report(4, 3, '거의 없음', '오후 케이크용') as report_id \gset
reset role;
select count(*) as noti_for_report from notification where report_id = :report_id;
select recipient_id, source, content from notification where report_id = :report_id order by recipient_id;
select _t.as_user('jang@example.com');
select resolve_shortage_report(:report_id);
reset role;
select status from shortage_report where report_id = :report_id;

-- 4) 권한 (로그인 사용자)
select _t.as_user('jung@example.com');
select user_id, name, role from user_account order by user_id limit 3;
do $$ begin
  perform password_hash from user_account limit 1;
  raise exception 'password_hash 가 읽혔습니다';
exception when insufficient_privilege then raise notice 'password_hash 차단 OK'; end $$;
do $$ begin
  insert into shortage_report (ingredient_id, reporter_id, reported_at, status) values (1, 3, now(), '접수');
  raise exception '직접 INSERT 가 통과했습니다';
exception when insufficient_privilege then raise notice '직접 INSERT 차단 OK'; end $$;

reset role;
rollback;
