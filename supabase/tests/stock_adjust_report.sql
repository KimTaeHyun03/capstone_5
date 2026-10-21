-- 4-3 실사·폐기 / 4-4 부족 신고 / 4-5 알림 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 앞선 마이그레이션(20261021000000·000100·000200)이 적용돼 있어야 한다.
-- 기대 1) 실사: 원두 4 → 5 입력 → 변동 +1 (실사 보정), 부족 해제(is_short=false)
-- 기대 2) 폐기: 우유 18 에서 3 폐기 → 15, 변동 -3, 사유 기록 / 재고보다 많이 폐기하면 오류
-- 기대 3) 신고: 알림 2건(점주·매니저), 신고자 이름 포함, report_id 연결 → 확인 처리 시 status '확인'
-- 기대 4) anon 권한: user_account 의 password_hash 읽기 거부, 이름은 읽힘, 테이블 직접 INSERT 거부
begin;
set local role anon;

-- 1) 실사
select record_stock_adjustment(1, '실사 보정', 5, 2) as after_count;
select ingredient_id, current_qty, is_short from inventory where ingredient_id = 1;

-- 2) 폐기
select record_stock_adjustment(2, '폐기', 3, 2, '유통기한 경과') as after_waste;
select change_type, change_qty, reason, handled_by from inventory_change where ingredient_id = 2 and change_type = '폐기';
do $$ begin
  perform record_stock_adjustment(2, '폐기', 9999, 2, '테스트');
  raise exception '오류가 나야 하는데 통과했습니다';
exception when others then
  if sqlerrm like '현재 재고%' then raise notice '폐기 초과 거부 OK: %', sqlerrm; else raise; end if;
end $$;

-- 3) 신고
select submit_shortage_report(4, 3, '거의 없음', '오후 케이크용') as report_id \gset
select count(*) as noti_for_report from notification where report_id = :report_id;
select recipient_id, source, content from notification where report_id = :report_id order by recipient_id;
select resolve_shortage_report(:report_id);
select status from shortage_report where report_id = :report_id;

-- 4) 권한
select user_id, name, role from user_account order by user_id limit 3;
do $$ begin
  perform password_hash from user_account limit 1;
  raise exception 'password_hash 가 읽혔습니다';
exception when insufficient_privilege then raise notice 'password_hash 차단 OK'; end $$;
do $$ begin
  insert into shortage_report (ingredient_id, reporter_id, reported_at, status) values (1, 1, now(), '접수');
  raise exception '직접 INSERT 가 통과했습니다';
exception when insufficient_privilege then raise notice '직접 INSERT 차단 OK'; end $$;

reset role;
rollback;
