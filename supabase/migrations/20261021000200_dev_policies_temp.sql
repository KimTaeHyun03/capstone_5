-- ⚠️ 개발용 임시 정책 — 인증(0단계)이 붙으면 이 파일의 내용을 모두 제거하고 역할별 정책으로 교체한다.
-- 로그인 없이(anon 키만으로) 12단계 재고 기능을 화면에서 쓰게 하려는 임시 개방이다.
-- 제거 방법: 아래 정책 drop + 함수 revoke execute from anon + user_account 컬럼 권한 원복 (새 마이그레이션으로).

-- 읽기: 부족 신고·알림 (알림은 화면에서 recipient_id 로 거른다)
create policy "dev anon read shortage_report" on shortage_report for select to anon using (true);
create policy "dev anon read notification"    on notification    for select to anon using (true);

-- 신고자 이름 표시용: user_account 는 컬럼 단위로만 읽게 한다(password_hash·시급·연락처는 막는다).
revoke all on user_account from anon;
grant select (user_id, name, role, status) on user_account to anon;
create policy "dev anon read user_account basic" on user_account for select to anon using (true);

-- 쓰기: 모두 함수(RPC)로만. 직접 INSERT/UPDATE 정책은 열지 않는다.
grant execute on function record_stock_adjustment(bigint, text, numeric, bigint, text) to anon;
grant execute on function submit_shortage_report(bigint, bigint, text, text) to anon;
grant execute on function resolve_shortage_report(bigint) to anon;
grant execute on function mark_notifications_read(bigint) to anon;
