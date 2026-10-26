-- =====================================================================
-- 1) 필요 인원 기준 완화: 시간당 예측 매출 8만원 미만 1명 · 12만원 미만 2명 · 그 이상 3명
--    (이전 5만/10만이면 이 가게 규모에서 필요 근무시간이 직원 최대 근무시간 합계보다 훨씬 많았다. 화면 needStaff 와 같은 기준)
--    이미 만들어 둔 이번 주 이후 예측은 새 기준으로 다시 계산한다.
-- 2) 초안을 만든 뒤에도 인원이 부족한 시프트가 있으면 점주·매니저에게 "알바생 추가 모집 또는 점주 근무 필요" 알림을 보낸다.
-- =====================================================================

create or replace function app.required_staff(p_amount integer) returns integer
language sql immutable set search_path = '' as $$
  select case when p_amount < 80000 then 1 when p_amount < 120000 then 2 else 3 end
$$;

do $$
declare r record;
begin
  for r in select distinct store_id, target_week from public.sales_forecast
            where target_week >= date_trunc('week', (now() at time zone 'Asia/Seoul')::date)::date loop
    begin
      perform app.generate_sales_forecast_for(r.store_id, r.target_week);
    exception when others then
      raise warning '예측 다시 계산 실패(매장 %, %주): %', r.store_id, r.target_week, sqlerrm;
    end;
  end loop;
end $$;

create or replace function public.generate_schedule_draft_impl(
  p_store_id    bigint,
  p_target_week date,
  p_shifts      jsonb default '[{"id":"am","start":8,"end":12},{"id":"mid","start":12,"end":17},{"id":"pm","start":17,"end":22}]'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_schedule_id bigint;
  v_status      varchar(20);
  v_week        date;
  c             record;
begin
  if extract(isodow from p_target_week) <> 1 then
    raise exception '대상 주차는 월요일 날짜여야 합니다 (%)', p_target_week;
  end if;

  select schedule_id, status into v_schedule_id, v_status
  from work_schedule where store_id = p_store_id and target_week = p_target_week
  for update;
  if v_status = '확정' then
    raise exception '이미 확정된 근무표는 다시 생성할 수 없습니다 (%)', p_target_week;
  end if;

  if v_schedule_id is null then
    insert into work_schedule (store_id, target_week, status, created_at, is_published)
    values (p_store_id, p_target_week, '초안', now(), false)
    returning schedule_id into v_schedule_id;
  else
    update work_schedule
       set status = '초안', created_at = now(), confirmed_by = null, confirmed_at = null, is_published = false, published_at = null
     where schedule_id = v_schedule_id;
    delete from shift_assignment where schedule_id = v_schedule_id;
  end if;

  select max(target_week) into v_week from sales_forecast where store_id = p_store_id and target_week <= p_target_week;

  -- 남은 주 근무시간
  drop table if exists _remain;
  create temp table _remain on commit drop as
    select u.user_id, coalesce(u.max_weekly_hours, 0)::numeric as remain
    from user_account u
    where u.store_id = p_store_id and u.role in ('매니저', '알바생') and u.status in ('활성', '초대됨');

  for c in
    select d.di, s.ord, (s.v->>'start')::int as s_start, (s.v->>'end')::int as s_end,
           coalesce((select max(f.required_staff) from sales_forecast f
                     where f.store_id = p_store_id and f.target_week = v_week and f.day_of_week = d.di
                       and f.time_slot >= (s.v->>'start')::int and f.time_slot < (s.v->>'end')::int), 1) as need
    from generate_series(0, 6) d(di), jsonb_array_elements(p_shifts) with ordinality s(v, ord)
    order by need desc, d.di desc, s.ord
  loop
    with picked as (
      insert into shift_assignment (schedule_id, user_id, work_date, planned_start, planned_end, is_modified, modified_by, has_warning)
      select v_schedule_id, r.user_id, p_target_week + c.di, make_time(c.s_start, 0, 0), make_time(c.s_end, 0, 0), false, null, false
      from _remain r
      where r.remain >= c.s_end - c.s_start
        and (
          -- 그 주에 제출한 가능시간이 시프트 전체를 덮는 경우 ("불가" 표시는 제외)
          exists (select 1 from availability a
                  where a.user_id = r.user_id and a.day_of_week = c.di
                    and a.target_week = p_target_week and not a.is_unavailable
                    and a.start_time <= make_time(c.s_start, 0, 0) and a.end_time >= make_time(c.s_end, 0, 0))
          -- 또는 그 주에 아무것도 제출하지 않은 경우: 모든 시간 가능으로 본다
          or not exists (select 1 from availability a where a.user_id = r.user_id and a.target_week = p_target_week)
        )
      order by r.remain desc, r.user_id
      limit c.need
      returning user_id
    )
    update _remain r set remain = r.remain - (c.s_end - c.s_start)
    from picked p where p.user_id = r.user_id;
  end loop;

  -- 인원이 부족한 시프트가 남으면 점주·매니저에게 알린다(알바생 추가 모집 또는 점주 근무 필요). 같은 주 안내는 다시 생성할 때마다 최신 값으로 바꾼다.
  declare
    v_label   text := to_char(p_target_week, 'FMMM.DD');
    v_days    text[] := array['월','화','수','목','금','토','일'];
    v_cells   integer;
    v_missing integer;
    v_sample  text;
  begin
    with cells as (
      select d.di, (s.v->>'start')::int as s_start, (s.v->>'end')::int as s_end,
             coalesce((select max(f.required_staff) from sales_forecast f
                       where f.store_id = p_store_id and f.target_week = v_week and f.day_of_week = d.di
                         and f.time_slot >= (s.v->>'start')::int and f.time_slot < (s.v->>'end')::int), 1) as need
      from generate_series(0, 6) d(di), jsonb_array_elements(p_shifts) s(v)
    ), got as (
      select cl.*, (select count(*) from shift_assignment sa
                    where sa.schedule_id = v_schedule_id and sa.work_date = p_target_week + cl.di
                      and sa.planned_start = make_time(cl.s_start, 0, 0) and sa.planned_end = make_time(cl.s_end, 0, 0)) as n
      from cells cl
    )
    select count(*) filter (where need > n), coalesce(sum(greatest(need - n, 0)), 0),
           array_to_string((array_agg(v_days[di + 1] || ' ' || s_start || '–' || s_end || '시 ' || (need - n) || '명'
                                      order by need - n desc, di, s_start) filter (where need > n))[1:3], ', ')
      into v_cells, v_missing, v_sample
      from got;

    delete from notification n
     using user_account u
     where n.recipient_id = u.user_id and u.store_id = p_store_id and n.type = '인원 부족'
       and not n.is_read and n.content like v_label || ' 주 %';

    if v_cells > 0 then
      insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
      select u.user_id, null, '인원 부족', '자동 감지',
             format('%s 주 근무표 초안에 인원이 부족한 시프트가 %s곳(총 %s명) 있습니다. (예: %s) 알바생을 추가로 모집하거나 점주가 직접 근무해야 합니다.',
                    v_label, v_cells, v_missing, v_sample),
             now(), false
        from user_account u
       where u.store_id = p_store_id and u.role in ('점주', '매니저') and u.status = '활성';
    end if;
  end;

  return get_schedule(p_store_id, p_target_week, p_shifts);
end;
$$;

revoke all on function public.generate_schedule_draft_impl(bigint, date, jsonb) from public, anon, authenticated;
