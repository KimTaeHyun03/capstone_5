-- =====================================================================
-- 스케줄 초안 자동 생성·조회를 "주차 기준 가능시간"으로 바꾼다.
-- 지금까지는 직원의 모든 가능시간 행(주차 무관, "불가" 표시 포함)을 배정에 썼다. 그래서 그 주에 가능시간을 내지 않은 직원에게
-- 과거(시드) 가능시간이 그대로 적용됐고, 가능시간 현황 화면(해당 주차 제출자만 집계)과 결과가 달랐다.
-- 바뀐 규칙: 대상 주차에 제출한 가능시간만 쓴다. 미제출자는 배정 후보에서 빠지고(가능시간 0), "불가" 표시는 가능시간으로 세지 않는다.
-- get_schedule 의 staff 항목에 submitted(그 주 제출 여부)를 함께 내려 화면이 "미제출 N명"을 안내할 수 있게 한다.
-- 이전 방식(주차 무관) get_availability/availability_of(bigint)는 그대로 둔다.
-- =====================================================================

create or replace function public.availability_of(p_user_id bigint, p_target_week date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'user_id',          u.user_id,
    'max_weekly_hours', u.max_weekly_hours,
    'registered_at',    (select max(a.registered_at) from availability a where a.user_id = u.user_id and a.target_week = p_target_week),
    'submitted',        exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = p_target_week),
    'ranges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',   a.day_of_week,
               'start', extract(hour from a.start_time)::int,
               'end',   extract(hour from a.end_time)::int)
             order by a.day_of_week, a.start_time)
      from availability a
     where a.user_id = u.user_id and a.target_week = p_target_week and not a.is_unavailable), '[]'::jsonb))
  from user_account u
  where u.user_id = p_user_id;
$$;
revoke all on function public.availability_of(bigint, date) from public, anon, authenticated;

create or replace function public.get_schedule_impl(
  p_store_id    bigint,
  p_target_week date,
  p_shifts      jsonb default '[{"id":"am","start":8,"end":12},{"id":"mid","start":12,"end":17},{"id":"pm","start":17,"end":22}]'
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with ws as (
    select * from work_schedule where store_id = p_store_id and target_week = p_target_week
  ),
  -- 필요 인원 근거 주차: 대상 주 예측, 없으면 그 이전 가장 최근 예측 (1-3 예측 실행 전 임시 대체)
  fw as (
    select max(target_week) as week from sales_forecast where store_id = p_store_id and target_week <= p_target_week
  ),
  cells as (
    select d.di, s.v->>'id' as shift_id, (s.v->>'start')::int as s_start, (s.v->>'end')::int as s_end,
           coalesce((select max(f.required_staff) from sales_forecast f, fw
                     where f.store_id = p_store_id and f.target_week = fw.week and f.day_of_week = d.di
                       and f.time_slot >= (s.v->>'start')::int and f.time_slot < (s.v->>'end')::int), 1) as need
    from generate_series(0, 6) d(di), jsonb_array_elements(p_shifts) s(v)
  )
  select jsonb_build_object(
    'schedule_id',   ws.schedule_id,
    'status',        ws.status,
    'created_at',    ws.created_at,
    'forecast_week', (select week from fw),
    'cells', (
      select jsonb_agg(jsonb_build_object(
               'day', c.di, 'shift', c.shift_id, 'need', c.need,
               'user_ids', coalesce((select jsonb_agg(sa.user_id order by sa.user_id) from shift_assignment sa
                                     where sa.schedule_id = ws.schedule_id and sa.work_date = p_target_week + c.di
                                       and sa.planned_start = make_time(c.s_start, 0, 0)
                                       and sa.planned_end = make_time(c.s_end, 0, 0)), '[]'::jsonb))
             order by c.di, c.s_start)
      from cells c),
    -- 배정 판단에 쓴 직원별 가능시간·주 최대 근무시간 (화면 재검증 E4 와 같은 기준을 쓰도록 함께 내려준다)
    'staff', (
      select coalesce(jsonb_agg(availability_of(u.user_id, p_target_week) order by u.user_id), '[]'::jsonb)
      from user_account u where u.store_id = p_store_id and u.role in ('매니저', '알바생')))
  from ws;
$$;

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
        and exists (select 1 from availability a
                    where a.user_id = r.user_id and a.day_of_week = c.di
                      and a.target_week = p_target_week and not a.is_unavailable
                      and a.start_time <= make_time(c.s_start, 0, 0) and a.end_time >= make_time(c.s_end, 0, 0))
      order by r.remain desc, r.user_id
      limit c.need
      returning user_id
    )
    update _remain r set remain = r.remain - (c.s_end - c.s_start)
    from picked p where p.user_id = r.user_id;
  end loop;

  return get_schedule(p_store_id, p_target_week, p_shifts);
end;
$$;

revoke all on function public.get_schedule_impl(bigint, date, jsonb) from public, anon, authenticated;
revoke all on function public.generate_schedule_draft_impl(bigint, date, jsonb) from public, anon, authenticated;
