-- 시연용 직원 2명 추가 + 11.02 주 가능시간 (모두 가짜 데이터). 인원 부족 시연을 줄이기 위한 보강이다.
-- 실행: npx supabase db query --linked -f seed_demo_staff.sql  (재실행 안전: 이미 있으면 건너뜀)
-- 참고: 스케줄 화면의 직원 목록은 get_schedule 이 내려 주는 DB 직원으로 채워진다(화면 코드에 직원을 추가할 필요 없음).

begin;

insert into user_account (store_id, login_id, password_hash, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status)
select (select min(store_id) from store), v.login, null, v.name, '알바생', 10320, 20, 20, v.phone, '활성'
  from (values ('song@example.com', '송다은', '010-0000-0008'), ('yoon@example.com', '윤태오', '010-0000-0009')) v(login, name, phone)
 where not exists (select 1 from user_account u where u.login_id = v.login);

delete from availability
 where target_week = date '2026-11-02' and user_id in (select user_id from user_account where login_id in ('song@example.com', 'yoon@example.com'));
insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week)
select u.user_id, a.dow, a.s::time, a.e::time, timestamptz '2026-10-25 11:00+09', date '2026-11-02'
  from (values
    ('song@example.com', 1, '12:00', '22:00'), ('song@example.com', 2, '12:00', '22:00'), ('song@example.com', 3, '12:00', '22:00'), ('song@example.com', 6, '08:00', '17:00'),
    ('yoon@example.com', 3, '08:00', '17:00'), ('yoon@example.com', 4, '14:00', '22:00'), ('yoon@example.com', 5, '08:00', '17:00')
  ) as a(login, dow, s, e)
  join user_account u on u.login_id = a.login;
update user_account set availability_week = date '2026-11-02' where login_id in ('song@example.com', 'yoon@example.com');

commit;
