// 개발용 임시 — 로그인(0단계) 전까지 역할별로 고정된 사용자(supabase/seed.sql 의 user_account.user_id)를 쓴다.
// 인증이 붙으면 이 파일을 지우고 로그인한 사용자의 user_id 로 바꾼다.
export const DEV_USER_ID = { owner: 1, manager: 2, staff: 3 };

// useBase() 값('/owner' | '/manager' | '/staff') → user_id
export const devUserIdFor = (base) => DEV_USER_ID[String(base).replace('/', '')] ?? DEV_USER_ID.owner;
