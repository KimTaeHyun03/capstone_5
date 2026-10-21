// DB 함수(RPC) 호출 — 테이블을 직접 읽고 쓰지 않고 supabase/migrations 의 security definer 함수를 부른다.
// supabase 가 null(환경변수 없음)이면 호출하지 않는다. 호출 여부 판단은 AppState 가 한다.
import { supabase } from './supabase.js';

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// 2-1 · 가능시간 (ranges: [{ day, start, end }], 시 단위)
export const fetchAvailability = (userId) => rpc('get_availability', { p_user_id: userId });
export const saveAvailability = (userId, ranges, maxWeeklyHours) =>
  rpc('save_availability', { p_user_id: userId, p_ranges: ranges, p_max_weekly_hours: maxWeeklyHours });

// 2-3 · 근무 스케줄 (shifts: [{ id, start, end }])
export const fetchSchedule = (storeId, targetWeek, shifts) =>
  rpc('get_schedule', { p_store_id: storeId, p_target_week: targetWeek, p_shifts: shifts });
export const generateScheduleDraft = (storeId, targetWeek, shifts) =>
  rpc('generate_schedule_draft', { p_store_id: storeId, p_target_week: targetWeek, p_shifts: shifts });
