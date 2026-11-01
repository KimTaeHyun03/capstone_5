// DB 호출에 쓰는 로그인 사용자 id (user_account.user_id). 로그인 전이면 null.
import { useAuth } from './auth.jsx';

export function useDbUserId() {
  const { account } = useAuth();
  return account ? account.id : null;
}
