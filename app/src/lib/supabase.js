// Supabase 클라이언트 — 공개용(publishable/anon) 키만 사용한다. 시크릿 키는 절대 넣지 않는다.
// 값은 Vercel 환경변수 NEXT_PUBLIC_* (로컬은 app/.env.local) 에서 읽는다.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const key = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// 환경변수가 없으면 null — 호출하는 쪽에서 예시 데이터로 대체한다.
export const supabase = url && key ? createClient(url, key) : null;
