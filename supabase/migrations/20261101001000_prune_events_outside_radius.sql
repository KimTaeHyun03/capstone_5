-- 행사 반경을 줄여도 예전 검색 결과가 그대로 남던 문제 수정.
-- 수집한 행사는 한 번 저장되면 지워지지 않았다. 반경을 바꾸거나 다시 불러오면 반경 밖의 '제안·제외' 행사를 지운다.

create or replace function public.set_store_location(p_lat numeric, p_lon numeric, p_radius integer default 1000)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if app.my_store_id() is null or not app.is_owner() then raise exception '점주만 매장 위치를 바꿀 수 있습니다' using errcode = '42501'; end if;
  if p_lat not between 33 and 39 or p_lon not between 124 and 132 then raise exception '국내 좌표를 입력하세요'; end if;
  update public.store set latitude = p_lat, longitude = p_lon, event_radius_m = coalesce(p_radius, event_radius_m) where store_id = app.my_store_id();
  -- 거리 다시 계산
  update public.local_event set distance_m = app.haversine_m(p_lat, p_lon, latitude, longitude)
   where store_id = app.my_store_id() and latitude is not null;
  -- 반경 밖의 수집 행사 중 아직 반영하지 않은 것(제안·제외)은 지운다. 점주가 '반영'한 행사와 직접 등록한 행사는 남긴다.
  delete from public.local_event
   where store_id = app.my_store_id() and source = 'api' and status in ('제안', '제외')
     and distance_m is not null and distance_m > (select event_radius_m from public.store where store_id = app.my_store_id());
end $$;

create or replace function public.upsert_synced_events(p_store bigint, p_events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_s public.store%rowtype; v_new integer := 0; v_dist integer; v_id bigint;
begin
  select * into v_s from public.store where store_id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다'; end if;
  -- 반경을 줄였을 때 예전 결과가 남지 않게: 반경 밖의 수집 행사 중 아직 반영하지 않은 것(제안·제외)은 지운다
  delete from public.local_event
   where store_id = p_store and source = 'api' and status in ('제안', '제외') and distance_m is not null and distance_m > v_s.event_radius_m;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_dist := case when v_s.latitude is not null and nullif(e ->> 'latitude', '') is not null
                   then app.haversine_m(v_s.latitude, v_s.longitude, (e ->> 'latitude')::numeric, (e ->> 'longitude')::numeric) end;
    if v_dist is not null and v_dist > v_s.event_radius_m then continue; end if;
    insert into public.local_event (store_id, source, external_id, title, start_date, end_date, start_time, end_time, latitude, longitude, distance_m, scale)
    values (p_store, 'api', e ->> 'external_id', left(e ->> 'title', 200), (e ->> 'start_date')::date, (e ->> 'end_date')::date,
            nullif(e ->> 'start_time', '')::time, nullif(e ->> 'end_time', '')::time,
            nullif(e ->> 'latitude', '')::numeric, nullif(e ->> 'longitude', '')::numeric, v_dist, 'medium')
    on conflict (store_id, external_id) do update
      set title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
          start_time = excluded.start_time, end_time = excluded.end_time,
          latitude = excluded.latitude, longitude = excluded.longitude, distance_m = excluded.distance_m
    returning event_id into v_id;
    if (select created_at >= now() - interval '1 minute' from public.local_event where event_id = v_id) then v_new := v_new + 1; end if;
  end loop;
  if v_new > 0 then
    insert into public.notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select o.user_id, null, '주변 행사 제안', '자동 감지',
           format('매장 주변에서 새 행사 %s건을 찾았습니다. 행사 관리에서 확인하고 반영하세요.', v_new), now(), false
      from public.user_account o where o.store_id = p_store and o.role = '점주' and o.status = '활성';
  end if;
  return v_new;
end $$;
