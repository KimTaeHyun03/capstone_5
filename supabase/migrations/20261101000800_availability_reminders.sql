-- 가능시간 미제출 리마인드 (이벤트): 새 테이블 없이 notification 에 기록한다.
--   금요일 10:00 KST : 다음 주 가능시간을 아직 안 낸 매니저·알바생 본인에게 "오늘 18시까지 제출" 알림
--   토요일 09:00 KST : 점주·매니저에게 미제출자 명단 요약 (미제출자는 모든 시간 가능으로 보고 배정된다는 안내 포함)
-- '제출'의 기준은 초안 자동 생성과 같다: 그 주(target_week)의 availability 행이 하나라도 있으면 제출.
-- 같은 사람에게 같은 주 같은 알림은 한 번만 보낸다. 주간 정산(run_weekly_jobs)은 건드리지 않는다.

create or replace function public.send_availability_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_week  date := (date_trunc('week', now() at time zone 'Asia/Seoul'))::date + 7;
  v_label text := to_char(v_week, 'FMMM.DD') || '~' || to_char(v_week + 6, 'FMMM.DD');
  v_text  text := '다음 주(' || to_char(v_week, 'FMMM.DD') || '~' || to_char(v_week + 6, 'FMMM.DD') || ') 근무 가능시간을 아직 제출하지 않았습니다. 금요일 18시까지 제출해 주세요.';
  v_n     integer;
begin
  insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, null, '가능시간 미제출', '자동 감지', v_text, now(), false
    from user_account u
   where u.role in ('매니저', '알바생') and u.status = '활성'
     and not exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = v_week)
     and not exists (select 1 from notification n where n.recipient_id = u.user_id and n.type = '가능시간 미제출' and n.content = v_text);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.send_availability_summary()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_week date := (date_trunc('week', now() at time zone 'Asia/Seoul'))::date + 7;
  s record;
  v_names text;
  v_cnt integer;
  v_text text;
  v_n integer := 0;
  v_ins integer;
begin
  for s in select store_id from store loop
    select string_agg(u.name, ', ' order by u.name), count(*) into v_names, v_cnt
      from user_account u
     where u.store_id = s.store_id and u.role in ('매니저', '알바생') and u.status = '활성'
       and not exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = v_week);
    continue when coalesce(v_cnt, 0) = 0;
    v_text := '다음 주(' || to_char(v_week, 'FMMM.DD') || '~' || to_char(v_week + 6, 'FMMM.DD') || ') 가능시간 미제출 ' || v_cnt || '명: ' || v_names
              || '. 미제출자는 모든 시간 가능으로 보고 배정됩니다.';
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '가능시간 미제출', '자동 감지', left(v_text, 500), now(), false
      from user_account u
     where u.store_id = s.store_id and u.role in ('점주', '매니저') and u.status = '활성'
       and not exists (select 1 from notification n where n.recipient_id = u.user_id and n.type = '가능시간 미제출' and n.content = left(v_text, 500));
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end loop;
  return v_n;
end $$;

revoke all on function public.send_availability_reminders() from public, anon, authenticated;
revoke all on function public.send_availability_summary() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('availability-reminder', 'availability-summary');
    -- pg_cron 은 UTC: 금 10:00 KST = 금 01:00 UTC, 토 09:00 KST = 토 00:00 UTC
    perform cron.schedule('availability-reminder', '0 1 * * 5', $job$select public.send_availability_reminders()$job$);
    perform cron.schedule('availability-summary', '0 0 * * 6', $job$select public.send_availability_summary()$job$);
  end if;
end $$;
