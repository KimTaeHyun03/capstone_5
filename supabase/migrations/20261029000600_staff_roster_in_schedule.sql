-- 스케줄 화면의 직원 목록을 DB에서 읽을 수 있게 get_schedule 의 staff 항목에 이름·역할·상태·시급을 함께 내려 준다.
-- (전에는 화면 코드의 직원 목록(mocks/data.js)에 없는 직원은 배정돼 있어도 표시되지 않았다.)
-- 알바생에게는 get_schedule 래퍼가 staff 항목을 비워서 내려 주므로(20261028000100) 시급이 노출되지 않는다.
create or replace function public.availability_of(p_user_id bigint, p_target_week date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'user_id',          u.user_id,
    'name',             u.name,
    'role',             u.role,
    'status',           u.status,
    'hourly_wage',      u.hourly_wage,
    'max_weekly_hours', u.max_weekly_hours,
    'registered_at',    (select max(a.registered_at) from availability a where a.user_id = u.user_id and a.target_week = p_target_week),
    'submitted',        exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = p_target_week),
    'ranges', case
      when not exists (select 1 from availability a where a.user_id = u.user_id and a.target_week = p_target_week) then
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
