// DB 호출에 쓰는 로그인 사용자 id (user_account.user_id).
// 체험 로그인이거나 로그인 전이면 null — 이때는 DB 를 부르지 않고 예시 데이터를 쓴다.
import { useAuth } from './auth.jsx';

export function useDbUserId() {
  const { account, demo } = useAuth();
  return account && !demo ? account.id : null;
}
