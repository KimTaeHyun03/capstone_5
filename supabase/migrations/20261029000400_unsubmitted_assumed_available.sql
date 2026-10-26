-- =====================================================================
-- 가능시간 미제출 직원은 "모든 시간 가능"으로 보고 배정한다 (20261029000300 의 "미제출은 제외" 규칙을 대체).
--   - 그 주에 가능시간을 아예 제출하지 않은 직원: 영업시간 내 전 요일·전 시간 가능으로 본다. 주 최대 근무시간 제한은 그대로 적용.
--   - 제출했지만 "불가"로 표시한 직원: 배정하지 않는다.
--   - 일부만 제출한 직원: 제출한 시간만 쓴다(안 낸 시간까지 가능으로 보지 않는다).
-- get_schedule 의 staff 항목: 미제출 직원은 가능시간 범위를 전 시간으로 내려 주고(submitted = false 는 그대로),
-- 화면의 규칙 검사(E4)가 서버 배정과 같은 기준을 쓰게 한다.
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
    'ranges', case
      when not exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = p_target_week) then
        -- 미제출: 영업시간 내 모든 요일 가능
        (select jsonb_agg(jsonb_build_object('day', d.day, 'start', coalesce(extract(hour from s.open_time)::int, 8), 'end', coalesce(extract(hour from s.close_time)::int, 22)) order by d.day)
           from generate_series(0, 6) d(day), store s where s.store_id = u.store_id)
      else coalesce((
        select jsonb_agg(jsonb_build_object(
                 'day',   a.day_of_week,
                 'start', extract(hour from a.start_time)::int,
                 'end',   extract(hour from a.end_time)::int)
               order by a.day_of_week, a.start_time)
          from availability a
         where a.user_id = u.user_id and a.target_week = p_target_week and not a.is_unavailable), '[]'::jsonb)
    end)
  from user_account u
  where u.user_id = p_user_id;
$$;
revoke all on function public.availability_of(bigint, date) from public, anon, authenticated;

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

  return get_schedule(p_store_id, p_target_week, p_shifts);
end;
$$;

revoke all on function public.generate_schedule_draft_impl(bigint, date, jsonb) from public, anon, authenticated;
