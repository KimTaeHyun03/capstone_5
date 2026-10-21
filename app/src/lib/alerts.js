// 4-4 부족 신고 · 4-5 알림 — shortage_report / notification 조회와 쓰기(RPC)
import { supabase } from './supabase.js';

const db = () => {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  return supabase;
};
const rpc = async (name, args) => {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
};

// '오늘 08:10' / '10.17 15:20' (화면 예시 데이터와 같은 표기)
const pad = (n) => String(n).padStart(2, '0');
export function fmtAt(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? `오늘 ${hm}` : `${d.getMonth() + 1}.${pad(d.getDate())} ${hm}`;
}

// 처리 대기('접수') 신고만. ingredientId 는 재고 화면과 같은 'i{id}' 형식.
export async function fetchReports() {
  const { data, error } = await db()
    .from('shortage_report')
    .select('report_id, ingredient_id, memo, reported_at, reporter:user_account!reporter_id(name)')
    .eq('status', '접수')
    .order('reported_at', { ascending: false });
  if (error) throw error;
  return data.map((r) => ({
    id: `r${r.report_id}`,
    reportId: r.report_id,
    ingredientId: `i${r.ingredient_id}`,
    by: r.reporter?.name ?? '',
    at: fmtAt(r.reported_at),
    note: r.memo ?? '',
  }));
}

export async function fetchNotifications(userId) {
  const { data, error } = await db()
    .from('notification')
    .select('notification_id, source, content, sent_at, is_read')
    .eq('recipient_id', userId)
    .order('sent_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((n) => ({
    id: `n${n.notification_id}`,
    kind: n.source === '수동 신고' ? 'report' : 'stock',
    title: n.content,
    at: fmtAt(n.sent_at),
    read: n.is_read,
  }));
}

export const submitShortageReport = ({ ingredientId, reporterId, memo }) =>
  rpc('submit_shortage_report', { p_ingredient_id: ingredientId, p_reporter_id: reporterId, p_memo: memo || null });

export const resolveShortageReport = (reportId) => rpc('resolve_shortage_report', { p_report_id: reportId });

export const markNotificationsRead = (userId) => rpc('mark_notifications_read', { p_user_id: userId });
