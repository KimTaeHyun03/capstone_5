-- ⚠️ 개발용 임시 정책 — 인증(0단계)이 붙으면 제거하고 역할별로 교체한다.
--   알바생: 본인 출퇴근·급여·배정만 / 점주·매니저: 매장 전체 (시급은 점주만)
-- 읽기: 출퇴근·급여·근무 배정·근무표. 쓰기는 함수(RPC)로만 하고 직접 INSERT/UPDATE 는 열지 않는다.
create policy "dev anon read attendance"      on attendance      for select to anon using (true);
create policy "dev anon read payroll"         on payroll         for select to anon using (true);
create policy "dev anon read shift_assignment" on shift_assignment for select to anon using (true);
create policy "dev anon read work_schedule"   on work_schedule   for select to anon using (true);

-- 인건비 계산(3-3)에 시급이 필요해 user_account 의 읽기 가능 컬럼에 hourly_wage 를 추가한다.
-- (password_hash·연락처·주 최대 근무시간은 계속 막는다.)
grant select (hourly_wage) on user_account to anon;

grant execute on function clock_in(bigint) to anon;
grant execute on function clock_out(bigint) to anon;
