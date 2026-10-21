-- 3-1 출퇴근 / 3-2 급여 / 3-E2 지각·조퇴 판정 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 기대 1) 시드 재현: calculate_payroll('2026-10-05') 가 시드 급여와 같음 (정윤수 186,379원 · 장윤서 61,920원)
-- 기대 2) 판정: 예정 17:00~22:00 에 17:07 출근 → 지각, 21:30 퇴근 → 조퇴, 둘 다 → 지각·조퇴, 정시 → 정상. 근무시간 소수 둘째 자리
-- 기대 3) 퇴근 기록 시 그 주 급여 자동 갱신 + 본인 알림. 주 15시간 이상이면 주휴수당(기본급 ÷ 5)
-- 기대 4) anon 으로 출근 → 퇴근 가능, 퇴근 전 재출근·출근 없는 퇴근은 오류
begin;

-- 1) 시드 재현
select calculate_payroll('2026-10-05') as users;
select user_id, total_hours, applied_wage, base_pay, is_holiday_pay_target, holiday_pay, total_pay from payroll
 where period_start = '2026-10-05' order by user_id;

-- 2~3) 새 확정 근무표(10.26 주)에서 정윤수 5시간 × 4일 (정시 2일 · 지각 1일 · 지각+조퇴 1일)
insert into work_schedule (store_id, target_week, status, created_at, confirmed_by, confirmed_at, is_published, published_at)
values (1, '2026-10-26', '확정', now(), 1, now(), true, now());
insert into shift_assignment (schedule_id, user_id, work_date, planned_start, planned_end, is_modified, has_warning)
select (select schedule_id from work_schedule where target_week = '2026-10-26'), 3, d, '17:00', '22:00', false, false
  from (values (date '2026-10-26'), ('2026-10-27'), ('2026-10-28'), ('2026-10-29')) v(d);

-- 정시 / 지각(7분) / 지각+조퇴 — 출근만 기록한 뒤 퇴근을 UPDATE 해서 트리거 경로를 탄다
insert into attendance (user_id, assignment_id, clock_in)
select 3, assignment_id, (work_date::text || case work_date when '2026-10-27' then ' 17:07:00+09' when '2026-10-28' then ' 17:20:00+09' else ' 17:00:00+09' end)::timestamptz
  from shift_assignment where schedule_id = (select schedule_id from work_schedule where target_week = '2026-10-26');
select a.attendance_id, s.work_date, a.status as status_at_clock_in from attendance a join shift_assignment s using (assignment_id)
 where s.schedule_id = (select schedule_id from work_schedule where target_week = '2026-10-26') order by s.work_date;

select count(*) as noti_before from notification where recipient_id = 3;
update attendance set clock_out = (select (work_date::text || ' 22:00:00+09')::timestamptz from shift_assignment where assignment_id = attendance.assignment_id)
 where assignment_id in (select assignment_id from shift_assignment where work_date in ('2026-10-26', '2026-10-29') and user_id = 3);
update attendance set clock_out = (select (work_date::text || ' 22:00:00+09')::timestamptz from shift_assignment where assignment_id = attendance.assignment_id)
 where assignment_id in (select assignment_id from shift_assignment where work_date = '2026-10-27' and user_id = 3);
update attendance set clock_out = (select (work_date::text || ' 21:30:00+09')::timestamptz from shift_assignment where assignment_id = attendance.assignment_id)
 where assignment_id in (select assignment_id from shift_assignment where work_date = '2026-10-28' and user_id = 3);

select s.work_date, a.status, a.actual_hours from attendance a join shift_assignment s using (assignment_id)
 where s.schedule_id = (select schedule_id from work_schedule where target_week = '2026-10-26') order by s.work_date;
select total_hours, base_pay, is_holiday_pay_target, holiday_pay, total_pay from payroll where user_id = 3 and period_start = '2026-10-26';
select count(*) as noti_after from notification where recipient_id = 3;
select content from notification where recipient_id = 3 and type = '급여 갱신' order by notification_id desc limit 1;

-- 4) anon 출퇴근 (예정 없는 출근)
set local role anon;
select clock_in(4) as attendance_id \gset
do $$ begin
  perform clock_in(4);
  raise exception '재출근이 통과했습니다';
exception when others then
  if sqlerrm like '아직 퇴근하지%' then raise notice '재출근 거부 OK'; else raise; end if;
end $$;
select clock_out(4) as hours_worked;
do $$ begin
  perform clock_out(4);
  raise exception '출근 없는 퇴근이 통과했습니다';
exception when others then
  if sqlerrm like '출근 기록이 없습니다%' then raise notice '출근 없는 퇴근 거부 OK'; else raise; end if;
end $$;
reset role;
select assignment_id is null as no_plan, status from attendance where attendance_id = :attendance_id;

rollback;
