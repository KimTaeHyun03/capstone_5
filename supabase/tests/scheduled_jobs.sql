-- 15단계 스케줄러 함수 검증 — 끝에 rollback 하므로 데이터가 남지 않는다. (스케줄 등록 자체는 아래 확인 쿼리로 본다)
-- 기대 1) 30분 뒤 시작하는 확정 근무 → 알림 1건, 한 번 더 실행해도 0건(중복 방지)
-- 기대 2) 3시간 뒤 근무 / 이미 출근한 배정 / 초안 근무표의 배정 → 알림 없음
-- 기대 3) run_weekly_jobs() 가 오류 없이 payroll_users·period_close·recommendations 결과를 돌려줌
begin;

-- 1) 30분 뒤 시작: 날짜와 시각을 같은 시점에서 뽑아 자정 근처에도 안전하다
insert into work_schedule (store_id, target_week, status, created_at, confirmed_by, confirmed_at, is_published, published_at)
values (1, '2027-01-04', '확정', now(), 1, now(), true, now()),
       (1, '2027-01-11', '초안', now(), null, null, false, null);
with t as (select (now() at time zone 'Asia/Seoul') as k)
insert into shift_assignment (schedule_id, user_id, work_date, planned_start, planned_end, is_modified, has_warning)
select (select schedule_id from work_schedule where target_week = '2027-01-04'), 3, (k + interval '30 minutes')::date, (k + interval '30 minutes')::time, time '23:59', false, false from t
union all  -- 3시간 뒤: 아직 알림 대상 아님
select (select schedule_id from work_schedule where target_week = '2027-01-04'), 4, (k + interval '3 hours')::date, (k + interval '3 hours')::time, time '23:59', false, false from t
union all  -- 초안 근무표: 대상 아님
select (select schedule_id from work_schedule where target_week = '2027-01-11'), 5, (k + interval '30 minutes')::date, (k + interval '30 minutes')::time, time '23:59', false, false from t
union all  -- 이미 출근한 배정: 대상 아님
select (select schedule_id from work_schedule where target_week = '2027-01-04'), 6, (k + interval '20 minutes')::date, (k + interval '20 minutes')::time, time '23:59', false, false from t;
insert into attendance (user_id, assignment_id, clock_in)
select 6, assignment_id, now() from shift_assignment where user_id = 6 and schedule_id = (select schedule_id from work_schedule where target_week = '2027-01-04');

select send_shift_reminders() as first_run;
select recipient_id, type, content from notification where type = '근무 리마인드' order by recipient_id;
select send_shift_reminders() as second_run;

-- 3) 주간 정산
select run_weekly_jobs() as weekly;

-- 스케줄 등록 확인: pg_cron 이 있는 DB 에서만 두 줄이 나온다(shift-reminders, weekly-jobs)
select to_regclass('cron.job') is not null as has_cron;

rollback;
