-- ⚠️ 개발용 임시 정책 — 인증(0단계)이 붙으면 제거하고 역할별로 교체한다.
-- 예측 오차 리포트(forecast_error) 읽기와, 화면의 "마감 실행(개발용)" 버튼용 함수 실행 권한이다.
-- 운영에서는 마감·보정을 스케줄러(15단계)만 실행하므로 이 실행 권한은 최종적으로 필요 없다.
create policy "dev anon read forecast_error" on forecast_error for select to anon using (true);
grant execute on function run_period_close(date) to anon;
