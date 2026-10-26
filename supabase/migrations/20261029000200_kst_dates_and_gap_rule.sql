-- =====================================================================
-- 1) "지난주/다음 주" 기본값을 한국 시간(KST) 기준으로 맞춘다.
--    주간 정산은 일요일 15:30 UTC(= 월요일 00:30 KST)에 돈다. DB 시간대가 UTC 라서 current_date 가 아직 일요일이었고,
--    그래서 "지난주"가 지지난주(10.12–10.18)로, "다음 주"가 이번 주로 잡혔다. (예측·가능시간 함수는 이미 KST 라서 주차가 서로 어긋남)
--    함수 단위로 timezone 을 고정하면 current_date 가 KST 로 계산된다. 화면에서 부르는 경우도 같은 값을 쓴다.
-- 2) 2-E2 빈 시간대: 가능시간 현황 화면의 규칙(해당 주차에 제출한 사람만 집계, 지난 가능시간을 대신 쓰지 않음)과 맞춘다.
-- =====================================================================

alter function public.calculate_order_recommendations_impl(date) set timezone to 'Asia/Seoul';
alter function public.run_period_close_impl(date) set timezone to 'Asia/Seoul';
alter function public.calculate_payroll(date) set timezone to 'Asia/Seoul';
alter function public.run_weekly_jobs() set timezone to 'Asia/Seoul';

create or replace function app.notify_uncovered_slots(p_store bigint, p_target_week date default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_target date := date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date;
  v_label  text := to_char(date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date, 'FMMM.DD');
  v_days   text[] := array['월','화','수','목','금','토','일'];
  v_n      integer;
  v_sample text;
begin
  with staff as (
    select u.user_id from public.user_account u
     where u.store_id = p_store and u.role in ('매니저', '알바생') and u.status = '활성'
  ), eff as (
    -- 대상 주차에 제출한 가능시간만. "불가" 표시(is_unavailable)와 미제출은 가능한 사람으로 세지 않는다.
    select a.user_id, a.day_of_week, a.start_time, a.end_time
      from public.availability a join staff s using (user_id)
     where not a.is_unavailable and a.target_week = v_target
  ), gap as (
    select f.day_of_week, f.time_slot
      from public.sales_forecast f
     where f.store_id = p_store and f.target_week = v_target and coalesce(f.required_staff, 0) > 0
       and not exists (select 1 from eff e
                        where e.day_of_week = f.day_of_week
                          and e.start_time <= make_time(f.time_slot::int, 0, 0) and e.end_time > make_time(f.time_slot::int, 0, 0))
  )
  select count(*), array_to_string((array_agg(v_days[day_of_week + 1] || ' ' || time_slot || '시' order by day_of_week, time_slot))[1:3], ', ')
    into v_n, v_sample from gap;

  if v_n = 0 then return 0; end if;

  insert into public.notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, null, '빈 시간대', '자동 감지',
         format('%s 주 가능시간을 낸 사람이 없는 시간대가 %s개 있습니다. (예: %s) 가능시간 현황을 확인하세요.', v_label, v_n, v_sample),
         now(), false
    from public.user_account u
   where u.store_id = p_store and u.role in ('점주', '매니저') and u.status = '활성'
     and not exists (select 1 from public.notification n
                      where n.recipient_id = u.user_id and n.type = '빈 시간대' and n.content like v_label || ' 주 %');
  return v_n;
end $$;

revoke all on function app.notify_uncovered_slots(bigint, date) from public, anon, authenticated;
