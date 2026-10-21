-- 15단계 스케줄러: 근무 전 리마인드(이벤트 2-E6)와 주간 정산(급여·기간 마감·권장 발주량)을 정해진 시각에 자동 실행한다.
-- 테이블은 추가하지 않는다(22개 유지). pg_cron 은 UTC 기준이라 한국 시간으로 환산해 등록한다.
--   shift-reminders : 10분마다 — 한 시간 안에 시작하는 확정 근무를 본인에게 알림
--   weekly-jobs     : 매주 월요일 00:30 KST(= 일요일 15:30 UTC) — 지난주 급여 계산 → 지난주 마감·보정 계수 → 다음 주 권장 발주량
-- ※ 주간 매출 마감·예측 실행(이벤트 1-E2)은 매출 예측 담당 기능(1~2단계)이 함수로 만들어지면 run_weekly_jobs 에 추가한다.

-- 2-E6 근무 전 리마인드: 확정 근무표에서 한 시간 안에 시작하고 아직 출근하지 않은 배정에 알림을 보낸다.
-- 같은 배정에 같은 날 두 번 보내지 않는다. 보낸 알림 수 반환.
create or replace function send_shift_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_start  timestamptz;
  v_text   text;
  v_n      integer := 0;
begin
  for r in
    select sa.assignment_id, sa.user_id, sa.work_date, sa.planned_start, sa.planned_end
      from shift_assignment sa
      join work_schedule ws using (schedule_id)
      join user_account u on u.user_id = sa.user_id
     where ws.status = '확정' and u.status = '활성'
       and sa.work_date between (now() at time zone 'Asia/Seoul')::date and (now() at time zone 'Asia/Seoul')::date + 1
       and not exists (select 1 from attendance a where a.assignment_id = sa.assignment_id)
  loop
    v_start := (r.work_date + r.planned_start)::timestamp at time zone 'Asia/Seoul';
    continue when v_start < now() or v_start > now() + interval '60 minutes';

    v_text := format('%s 근무가 곧 시작합니다. (%s–%s)', to_char(r.work_date, 'FMMM.DD'),
                     to_char(r.planned_start, 'HH24:MI'), to_char(r.planned_end, 'HH24:MI'));
    continue when exists (select 1 from notification
                           where recipient_id = r.user_id and type = '근무 리마인드' and content = v_text);

    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    values (r.user_id, null, '근무 리마인드', '자동 감지', v_text, now(), false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 주간 정산. 하나가 실패해도 나머지는 계속 실행하고, 실패는 결과에 남긴다. 기간을 정하지 않으면 지난주/다음 주 기준이다.
create or replace function run_weekly_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  begin
    v_result := v_result || jsonb_build_object('payroll_users', calculate_payroll());
  exception when others then
    v_result := v_result || jsonb_build_object('payroll_error', sqlerrm);
    raise warning 'weekly-jobs 급여 계산 실패: %', sqlerrm;
  end;
  begin
    v_result := v_result || jsonb_build_object('period_close', run_period_close());
  exception when others then
    v_result := v_result || jsonb_build_object('period_close_error', sqlerrm);
    raise warning 'weekly-jobs 기간 마감 실패: %', sqlerrm;
  end;
  begin
    -- 보정 계수가 반영된 뒤 다음 주 권장 발주량을 계산한다(순서 중요).
    v_result := v_result || jsonb_build_object('recommendations', calculate_order_recommendations());
  exception when others then
    v_result := v_result || jsonb_build_object('recommendations_error', sqlerrm);
    raise warning 'weekly-jobs 권장 발주량 계산 실패: %', sqlerrm;
  end;
  return v_result;
end;
$$;

revoke all on function send_shift_reminders() from public, anon, authenticated;
revoke all on function run_weekly_jobs() from public, anon, authenticated;

-- 스케줄 등록: pg_cron 확장이 있는 DB(Supabase)에서만 한다. 같은 이름의 작업은 지우고 다시 등록한다(재실행 안전).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('shift-reminders', 'weekly-jobs');
    perform cron.schedule('shift-reminders', '*/10 * * * *', $job$select send_shift_reminders()$job$);
    perform cron.schedule('weekly-jobs', '30 15 * * 0', $job$select run_weekly_jobs()$job$);
  else
    raise notice 'pg_cron 확장을 사용할 수 없어 스케줄 등록을 건너뜁니다. Supabase 대시보드의 Database > Extensions 에서 pg_cron 을 켠 뒤 이 마이그레이션을 다시 실행하세요.';
  end if;
end $$;
