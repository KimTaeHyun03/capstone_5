// 주변 행사 — local_event 조회, 점주 입력·상태 변경(RPC), 공공 API 수집(Edge Function sync-local-events)
import { supabase } from './supabase.js';

const db = () => {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  return supabase;
};

async function rpc(fn, args) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchStoreLocation() {
  const { data, error } = await db().from('store').select('address, latitude, longitude, event_radius_m').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// 오늘 이후에 끝나는 행사만, 시작일 순
export async function fetchEvents() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const { data, error } = await db().from('local_event')
    .select('event_id, source, title, start_date, end_date, start_time, end_time, distance_m, scale, uplift_rate, status, actual_ratio')
    .gte('end_date', today).order('start_date').limit(200);
  if (error) throw new Error(error.message);
  return data;
}

export const saveEvent = (event) => rpc('save_local_event', { p_event: event });
export const setEventStatus = (id, status) => rpc('set_local_event_status', { p_event: id, p_status: status });
export const deleteEvent = (id) => rpc('delete_local_event', { p_event: id });
export const refreshForecast = () => rpc('refresh_forecast_with_events', { p_target_week: null });
export const saveLocation = (lat, lon, radius) => rpc('set_store_location', { p_lat: lat, p_lon: lon, p_radius: radius });

async function callSync(body) {
  const { data, error } = await db().functions.invoke('sync-local-events', { body });
  if (error) {
    let res = null;
    try { res = await error.context?.json(); } catch { /* 본문이 JSON 이 아님 */ }
    const e = new Error(res?.error || '행사를 불러오지 못했습니다.');
    e.code = res?.code;
    throw e;
  }
  return data;
}
export const geocodeStore = () => callSync({ action: 'geocode' });
export const syncEvents = (days = 28) => callSync({ action: 'sync', days });
