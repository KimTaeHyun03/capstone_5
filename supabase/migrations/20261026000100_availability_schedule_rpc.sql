-- =====================================================================
-- 3단계 2-1 가능시간 등록·수정 / 4단계 2-3 스케줄 초안 자동 생성 (이벤트 2-E3) — DB 함수
-- 테이블은 추가하지 않는다(22개 확정안). availability · work_schedule · shift_assignment 만 쓴다.
--
-- 권한: 0단계(인증) 전이라 anon 은 이 함수로만 접근한다. 테이블 RLS 정책은 그대로(직접 읽기·쓰기 불가)이고,
--       security definer 함수가 필요한 범위만 처리한다.
--       TODO(0단계): p_user_id 를 auth.uid() ↔ user_account 로 검증하고, 2-3 은 점주만 실행하도록 막는다.
-- 시간 단위: 화면의 시프트·가능시간이 정시 단위라 함수 인자/반환값은 '시(hour)' 정수로 주고받는다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 공용: 사용자 1명의 가능시간 + 주 최대 근무시간
-- ---------------------------------------------------------------------
create or replace function availability_of(p_user_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'user_id',          u.user_id,
    'max_weekly_hours', u.max_weekly_hours,
    'registered_at',    (select max(a.registered_at) from availability a where a.user_id = u.user_id),
    'ranges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day',   a.day_of_week,
               'start', extract(hour from a.start_time)::int,
               'end',   extract(hour from a.end_time)::int)
             order by a.day_of_week, a.start_time)
      from availability a where a.user_id = u.user_id), '[]'::jsonb))
  from user_account u
  where u.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------
-- 2-1 · 내 가능시간 조회
-- ---------------------------------------------------------------------
create or replace function get_availability(p_user_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$ select availability_of(p_user_id); $$;

-- ---------------------------------------------------------------------
-- 2-1 · 가능시간 등록·수정
-- availability 에는 주차 컬럼이 없으므로 '사용자의 현재 가능시간'으로 보고 통째로 교체한다.
-- p_ranges: [{"day":0..6, "start":8, "end":12}, ...]   (요일 0=월 … 6=일)
-- ---------------------------------------------------------------------
create or replace function save_availability(p_user_id bigint, p_ranges jsonb, p_max_weekly_hours numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r jsonb;
begin
  if not exists (select 1 from user_account where user_id = p_user_id and role in ('매니저', '알바생')) then
    raise exception '가능시간을 등록할 수 없는 사용자입니다 (user_id=%)', p_user_id;
  end if;
  if p_max_weekly_hours is null or p_max_weekly_hours < 4 or p_max_weekly_hours > 40 then
    raise exception '주 최대 근무시간은 4–40시간 사이여야 합니다';
  end if;
  if jsonb_typeof(p_ranges) <> 'array' or jsonb_array_length(p_ranges) = 0 then
    raise exception '가능시간을 하나 이상 선택해야 합니다';
  end if;
  for r in select * from jsonb_array_elements(p_ranges) loop
    if (r->>'day')::int not between 0 and 6
       or (r->>'start')::int not between 0 and 23
       or (r->>'end')::int not between 1 and 23
       or (r->>'start')::int >= (r->>'end')::int then
      raise exception '잘못된 가능시간입니다: %', r;
    end if;
  end loop;

  delete from availability where user_id = p_user_id;
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at)
  select p_user_id, (e->>'day')::smallint, make_time((e->>'start')::int, 0, 0), make_time((e->>'end')::int, 0, 0), now()
  from jsonb_array_elements(p_ranges) e;

  update user_account set max_weekly_hours = p_max_weekly_hours where user_id = p_user_id;

  return availability_of(p_user_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 2-3 · 근무 스케줄 조회 (화면 형식: 요일 × 시프트 칸마다 필요 인원·배정 인원)
-- 없으면 null. need 는 sales_forecast.required_staff 의 시프트 내 최댓값(예측 없으면 1).
-- ---------------------------------------------------------------------
create or replace function get_schedule(
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
      select coalesce(jsonb_agg(availability_of(u.user_id) order by u.user_id), '[]'::jsonb)
      from user_account u where u.store_id = p_store_id and u.role in ('매니저', '알바생')))
  from ws;
$$;

-- ---------------------------------------------------------------------
-- 2-3 · 스케줄 초안 자동 생성 (이벤트 2-E3: 가능시간·주 최대 근무시간 제약)
-- 규칙(app/src/domain/index.js generateDraft 와 동일):
--   1) 필요 인원이 많은 칸부터, 같으면 뒤 요일부터 채운다
--   2) 그 시프트 전체가 가능시간 안이고 남은 주 근무시간이 시프트 길이 이상인 직원 중
--      남은 시간이 많은 사람부터 필요 인원만큼 배정한다 (같으면 user_id 순)
-- 같은 주차 스케줄이 있으면 배정을 지우고 다시 만든다. '확정'된 주차는 다시 만들지 않는다.
-- ---------------------------------------------------------------------
create or replace function generate_schedule_draft(
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

-- anon(0단계 전 임시)·authenticated 가 RPC 로 호출할 수 있게 한다
grant execute on function get_availability(bigint)                         to anon, authenticated;
grant execute on function save_availability(bigint, jsonb, numeric)        to anon, authenticated;
grant execute on function get_schedule(bigint, date, jsonb)                to anon, authenticated;
grant execute on function generate_schedule_draft(bigint, date, jsonb)     to anon, authenticated;
revoke execute on function availability_of(bigint) from public;
