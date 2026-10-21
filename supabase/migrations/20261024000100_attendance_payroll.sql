-- 3-1 출근·퇴근 기록 (이벤트 3-E1 실 근무시간 산출, 3-E2 지각·조퇴 표시)
-- 3-2 급여 확인 (이벤트 3-E3 급여 갱신 알림), 3-3 예정·실제 인건비 비교용 급여 집계
-- 테이블은 추가하지 않는다(22개 유지). 화면의 쓰기는 함수(RPC)를 통한다.
--
-- 판정(한국 시간 기준, 분 단위): 출근이 예정 시작보다 늦으면 '지각', 퇴근이 예정 종료보다 이르면 '조퇴', 둘 다면 '지각·조퇴'.
--   예정(근무 배정)이 없는 출근은 판정하지 않고 '정상'으로 둔다. 예정은 '확정' 근무표의 오늘 배정만 연결한다.
-- 실 근무시간 = 퇴근 − 출근 (시간, 소수 둘째 자리).
-- 급여(주 단위, 월~일): 기본급 = 주간 근무시간 × 시급(반올림), 주 15시간 이상이면 주휴수당 대상이고
--   주휴수당 = 기본급 ÷ 5 (시드 payroll 과 같은 계산), 합계 = 기본급 + 주휴수당. (user_id, period_start) 로 갱신(UPSERT).

-- 3-E1·E2: 출퇴근 기록이 저장될 때 근무시간과 판정을 채운다.
create or replace function judge_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a      shift_assignment%rowtype;
  v_ps   timestamptz;
  v_pe   timestamptz;
  v_late boolean;
  v_early boolean;
begin
  if new.assignment_id is not null then
    select * into a from shift_assignment where assignment_id = new.assignment_id;
    v_ps := (a.work_date + a.planned_start)::timestamp at time zone 'Asia/Seoul';
    v_pe := (a.work_date + a.planned_end)::timestamp at time zone 'Asia/Seoul';
    v_late := date_trunc('minute', new.clock_in) > v_ps;
    v_early := new.clock_out is not null and date_trunc('minute', new.clock_out) < v_pe;
    new.status := case when v_late and v_early then '지각·조퇴' when v_late then '지각' when v_early then '조퇴' else '정상' end;
  else
    new.status := coalesce(new.status, '정상');
  end if;

  if new.clock_out is not null then
    if new.clock_out < new.clock_in then
      raise exception '퇴근 시각이 출근 시각보다 빠릅니다.';
    end if;
    new.actual_hours := round(extract(epoch from (new.clock_out - new.clock_in)) / 3600.0, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_judge on attendance;
create trigger trg_attendance_judge
  before insert or update on attendance
  for each row execute function judge_attendance();

-- 한 직원의 한 주 급여를 다시 계산해 저장한다(근무시간이 없으면 만들지 않는다). 합계 금액 반환(없으면 null).
create or replace function recalc_payroll(p_user_id bigint, p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end    date := p_week_start + 6;
  v_hours  numeric;
  v_wage   integer;
  v_base   integer;
  v_target boolean;
  v_hol    integer;
begin
  select coalesce(sum(actual_hours), 0) into v_hours from attendance
   where user_id = p_user_id and clock_out is not null
     and (clock_in at time zone 'Asia/Seoul')::date between p_week_start and v_end;
  if v_hours = 0 then return null; end if;

  select hourly_wage into v_wage from user_account where user_id = p_user_id;
  if v_wage is null then return null; end if; -- 시급이 없는 계정(점주 등)은 급여를 계산하지 않는다

  v_base := round(v_hours * v_wage);
  v_target := v_hours >= 15;
  v_hol := case when v_target then round(v_base / 5.0) else 0 end;

  insert into payroll (user_id, period_start, period_end, total_hours, applied_wage, base_pay,
                       is_holiday_pay_target, holiday_pay, total_pay, calculated_at)
  values (p_user_id, p_week_start, v_end, v_hours, v_wage, v_base, v_target, v_hol, v_base + v_hol, now())
  on conflict (user_id, period_start) do update
    set period_end = excluded.period_end, total_hours = excluded.total_hours, applied_wage = excluded.applied_wage,
        base_pay = excluded.base_pay, is_holiday_pay_target = excluded.is_holiday_pay_target,
        holiday_pay = excluded.holiday_pay, total_pay = excluded.total_pay, calculated_at = excluded.calculated_at;
  return v_base + v_hol;
end;
$$;

-- 3-E3: 퇴근이 기록되면 그 주 급여를 갱신하고 본인에게 알린다.
create or replace function on_clock_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if old.clock_out is null and new.clock_out is not null then
    v_total := recalc_payroll(new.user_id, date_trunc('week', (new.clock_in at time zone 'Asia/Seoul'))::date);
    if v_total is not null then
      insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
      values (new.user_id, null, '급여 갱신', '자동 감지',
              format('근무 기록이 급여에 반영됐습니다. 이번 주 예상 급여는 %s원입니다.', to_char(v_total, 'FM999,999,999')),
              now(), false);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_clock_out on attendance;
create trigger trg_attendance_clock_out
  after update of clock_out on attendance
  for each row execute function on_clock_out();

-- 주간 급여 일괄 계산(기간을 주지 않으면 지난주). 스케줄러(15단계)가 부른다. 계산한 직원 수 반환.
create or replace function calculate_payroll(p_week_start date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := coalesce(p_week_start, (date_trunc('week', current_date) - interval '7 days')::date);
  r       record;
  v_n     integer := 0;
begin
  for r in select distinct user_id from attendance
            where clock_out is not null and (clock_in at time zone 'Asia/Seoul')::date between v_start and v_start + 6 loop
    if recalc_payroll(r.user_id, v_start) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- 3-1 출근: 오늘(한국 시간)의 확정 배정 중 아직 출근하지 않은 첫 근무에 연결한다. 없으면 예정 없이 기록한다.
create or replace function clock_in(p_user_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign bigint;
  v_id     bigint;
begin
  perform 1 from user_account where user_id = p_user_id;
  if not found then raise exception '없는 사용자입니다: %', p_user_id; end if;
  if exists (select 1 from attendance where user_id = p_user_id and clock_out is null) then
    raise exception '아직 퇴근하지 않은 기록이 있습니다. 매니저에게 수정을 요청하세요.';
  end if;

  select sa.assignment_id into v_assign
    from shift_assignment sa join work_schedule ws using (schedule_id)
   where sa.user_id = p_user_id and ws.status = '확정'
     and sa.work_date = (now() at time zone 'Asia/Seoul')::date
     and not exists (select 1 from attendance t where t.assignment_id = sa.assignment_id)
   order by sa.planned_start limit 1;

  insert into attendance (user_id, assignment_id, clock_in) values (p_user_id, v_assign, now())
  returning attendance_id into v_id;
  return v_id;
end;
$$;

-- 3-1 퇴근: 가장 최근의 미퇴근 기록을 닫는다. 실 근무시간(시간)을 돌려준다.
create or replace function clock_out(p_user_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    bigint;
  v_hours numeric;
begin
  select attendance_id into v_id from attendance
   where user_id = p_user_id and clock_out is null order by clock_in desc limit 1;
  if not found then raise exception '출근 기록이 없습니다.'; end if;

  update attendance set clock_out = now() where attendance_id = v_id returning actual_hours into v_hours;
  return v_hours;
end;
$$;

revoke all on function judge_attendance() from public, anon, authenticated;
revoke all on function recalc_payroll(bigint, date) from public, anon, authenticated;
revoke all on function on_clock_out() from public, anon, authenticated;
revoke all on function calculate_payroll(date) from public, anon, authenticated;
revoke all on function clock_in(bigint) from public, anon, authenticated;
revoke all on function clock_out(bigint) from public, anon, authenticated;
