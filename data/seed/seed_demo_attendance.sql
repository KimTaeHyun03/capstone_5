-- =====================================================================
-- 시연용 근무표·출퇴근·급여 예시 데이터 (모두 가짜). seed_demo_data.sql, seed_demo_staff.sql 실행 뒤에 실행한다.
--   원격 적용: npx supabase db query --linked -f data/seed/seed_demo_attendance.sql
-- 한 트랜잭션이라 중간에 실패하면 아무것도 반영되지 않는다. 이미 실행했으면(10.19 이후 출퇴근 기록이 있으면) 중단한다.
--
-- 하는 일
--  1. 지난주(10.19~10.25)와 이번 주(10.26~) 근무표를 제품의 자동 생성 로직으로 만들고 '확정·공개' 처리한다
--     (가능시간을 제출하지 않은 주차라 모든 직원이 가능으로 간주된다)
--  2. 지난주 모든 배정에 출퇴근 기록을 넣는다. 지각·조퇴·정시가 섞이게 하고(배정 ID 로 결정되는 값이라 재현 가능),
--     판정(지각/조퇴)과 근무시간은 DB 트리거가 채운다
--  3. 오늘(10.26) 이미 끝난 근무는 출퇴근 기록을, 진행 중인 근무는 출근만 넣는다
--  4. 지난주 급여를 계산한다
-- 과거 주차 근무표라 알림(확정·공개, 인원 부족)이 새로 나가면 안 된다 → 해당 트리거는 이 스크립트 안에서만 잠시 끈다.
-- =====================================================================

begin;
set local time zone 'Asia/Seoul';
set local search_path = public;

do $guard$
begin
  if exists (select 1 from attendance where clock_in >= timestamptz '2026-10-19 00:00+09') then
    raise exception '이미 적용된 출퇴근 예시 데이터입니다 (10.19 이후 출퇴근 기록이 있음).';
  end if;
end $guard$;

alter table work_schedule disable trigger trg_notify_schedule_status;

-- 1. 근무표 생성·확정 --------------------------------------------------------------
do $sched$
declare
  v_store bigint := (select min(store_id) from store);
  v_owner_row user_account%rowtype;
  v_week  date;
begin
  select * into v_owner_row from user_account where role = '점주' and store_id = v_store order by user_id limit 1;
  -- 근무표 생성 함수는 로그인한 점주만 쓸 수 있으므로 점주 JWT 로 호출한다
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_row.auth_user_id, 'role', 'authenticated')::text, true);
  foreach v_week in array array[date '2026-10-19', date '2026-10-26'] loop
    perform generate_schedule_draft(v_store, v_week);
    update work_schedule
       set status = '확정', is_published = true, confirmed_by = v_owner_row.user_id,
           confirmed_at = v_week::timestamp - interval '2 days' + time '18:00',
           published_at = v_week::timestamp - interval '2 days' + time '18:00'
     where store_id = v_store and target_week = v_week;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $sched$;

-- 생성 함수가 보낸 '인원 부족' 알림은 과거·이번 주 근무표에는 의미가 없으니 지운다
delete from notification where type = '인원 부족' and sent_at >= now() - interval '10 minutes'
   and (content like '10.19 주 %' or content like '10.26 주 %');

alter table work_schedule enable trigger trg_notify_schedule_status;

-- 2. 지난주 출퇴근 (모든 배정) ----------------------------------------------------------
-- 출근: 15% 지각(+3~12분), 45% 일찍(0~4분 전), 나머지 정시 / 퇴근: 10% 조퇴(10~24분 전), 45% 조금 늦게(0~7분), 나머지 정시
insert into attendance (user_id, assignment_id, clock_in, clock_out)
select s.user_id, s.assignment_id,
       ((s.work_date + s.planned_start)::timestamp at time zone 'Asia/Seoul')
         + make_interval(mins => case when a.v < 15 then 3 + a.v % 10 when a.v < 60 then -(a.v % 5) else 0 end),
       ((s.work_date + s.planned_end)::timestamp at time zone 'Asia/Seoul')
         + make_interval(mins => case when b.w < 10 then -(10 + b.w % 15) when b.w < 55 then b.w % 8 else 0 end)
  from shift_assignment s
  join work_schedule w using (schedule_id)
  cross join lateral (select abs(hashtext(s.assignment_id::text || 'in')) % 100 as v) a
  cross join lateral (select abs(hashtext(s.assignment_id::text || 'out')) % 100 as w) b
 where w.target_week = date '2026-10-19';

-- 3. 오늘(10.26): 이미 끝난 근무는 출퇴근, 진행 중인 근무는 출근만 --------------------------------
insert into attendance (user_id, assignment_id, clock_in, clock_out)
select s.user_id, s.assignment_id,
       ((s.work_date + s.planned_start)::timestamp at time zone 'Asia/Seoul')
         + make_interval(mins => case when a.v < 15 then 3 + a.v % 10 when a.v < 60 then -(a.v % 5) else 0 end),
       case when (s.work_date + s.planned_end)::timestamp at time zone 'Asia/Seoul' <= now()
            then ((s.work_date + s.planned_end)::timestamp at time zone 'Asia/Seoul')
                 + make_interval(mins => case when b.w < 10 then -(10 + b.w % 15) when b.w < 55 then b.w % 8 else 0 end)
            end
  from shift_assignment s
  join work_schedule w using (schedule_id)
  cross join lateral (select abs(hashtext(s.assignment_id::text || 'in')) % 100 as v) a
  cross join lateral (select abs(hashtext(s.assignment_id::text || 'out')) % 100 as w) b
 where w.target_week = date '2026-10-26' and s.work_date = date '2026-10-26'
   and (s.work_date + s.planned_start)::timestamp at time zone 'Asia/Seoul' <= now();

-- 4. 지난주 급여 ---------------------------------------------------------------------
select calculate_payroll(date '2026-10-19');

-- 자체 점검 --------------------------------------------------------------------------
do $check$
begin
  if (select count(*) from work_schedule where target_week in (date '2026-10-19', date '2026-10-26') and status = '확정' and is_published) <> 2 then
    raise exception '10.19·10.26 주 근무표가 확정·공개 상태여야 합니다.';
  end if;
  if (select count(*) from attendance a join shift_assignment s using (assignment_id) join work_schedule w using (schedule_id) where w.target_week = date '2026-10-19')
     <> (select count(*) from shift_assignment s join work_schedule w using (schedule_id) where w.target_week = date '2026-10-19') then
    raise exception '지난주 모든 배정에 출퇴근 기록이 있어야 합니다.';
  end if;
  if not exists (select 1 from attendance where status like '%지각%' and clock_in >= timestamptz '2026-10-19 00:00+09')
     or not exists (select 1 from attendance where status like '%조퇴%' and clock_in >= timestamptz '2026-10-19 00:00+09') then
    raise exception '지각·조퇴 예시가 섞여 있어야 합니다.';
  end if;
  if not exists (select 1 from payroll where period_start = date '2026-10-19') then
    raise exception '지난주 급여가 없습니다.';
  end if;
end $check$;

commit;
