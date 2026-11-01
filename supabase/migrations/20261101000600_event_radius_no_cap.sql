-- 행사 반경 상한(100~5000m) 제거: 1m 이상이면 점주가 원하는 값으로 정할 수 있다.
alter table public.store drop constraint if exists store_event_radius_m_check;
alter table public.store add constraint store_event_radius_m_check check (event_radius_m >= 1);
