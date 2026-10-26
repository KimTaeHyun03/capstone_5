// AI 요약 호출 — Edge Function `ai-insight`(OpenAI) 한 곳만 부른다. 키는 서버 secret 에만 있고 여기에는 없다.
// kind: 'correction_report'(6-1) · 'forecast_brief'(1-3) · 'order_explain'(5-1)
import { supabase } from './supabase.js';

export async function fetchAiInsight(kind) {
  if (!supabase) throw new Error('DB에 연결된 상태에서만 사용할 수 있습니다.');
  const { data, error } = await supabase.functions.invoke('ai-insight', { body: { kind } });
  if (error) {
    // 2xx 가 아니면 본문의 { error, code } 를 꺼내 사용자에게 이유를 보여 준다.
    let body = null;
    try { body = await error.context?.json(); } catch { /* 본문이 JSON 이 아님 */ }
    const e = new Error(body?.error || 'AI 요약을 불러오지 못했습니다.');
    e.code = body?.code;
    throw e;
  }
  return data; // { text, model, generated_at }
}
