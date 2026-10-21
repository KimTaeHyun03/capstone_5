# develop 통합 이슈

> **최신 상태는 바로 아래 "권한 정리 결과"를 본다.** 그 아래(yunsu·chanyoung 병합 직후 기록)는 정리 전의 문제 목록이라 **대부분 해결됐다**. 남은 항목만 "남은 것"에 다시 적었다.

# 권한 정리 결과 (feature/auth-permissions)

## 한 일
- **함수 14개를 로그인 기준으로 바꿨다.** 원본은 `<이름>_impl`로 이름을 바꿔 아무에게도 실행 권한을 주지 않고, 같은 인자(이름·타입·기본값)의 래퍼가 *로그인 여부 → 역할 → 본인 id → 같은 매장* 순으로 검사한 뒤 호출한다. 래퍼는 `anon`·PUBLIC에서 회수하고 `authenticated`에만 연다.
  - 점주 전용: 권장량 산출, 발주 등록, 기간 마감, 스케줄 초안 생성
  - 점주·매니저: 실사·폐기, 신고 확인, 입고 처리
  - 같은 매장 구성원: 부족 신고(신고자는 본인)
  - 본인만: 출근·퇴근, 알림 읽음, 가능시간 제출·조회(점주·매니저는 같은 매장 직원 가능시간 조회 가능)
  - 스케줄 조회: 같은 매장만. 알바생은 **확정된** 스케줄만, 직원 가능시간 목록은 비워서 받는다
- **스케줄러(pg_cron) 호출은 통과한다.** JWT가 없거나 `service_role`인 호출만 "시스템 호출"로 보고 점주 전용 마감·권장량 함수를 허용한다. 비로그인(`anon`) 요청은 `role='anon'`이고 실행 권한도 없어 통과하지 못한다.
- **개발용·임시 정책 제거:** 내 `dev anon read …` 8개, 팀원 A의 임시 anon 쓰기 정책 7개. `public` 스키마 함수 전체에서 `anon` 실행 권한도 회수(안전망)
- **직접 쓰기 정책 축소 (0단계 RLS 일부, 우회 경로 차단):** 알바생의 출퇴근 직접 INSERT/UPDATE(근무시간·급여 조작 가능), 점주·매니저의 재고·재고 변동 직접 쓰기(오차 집계 근거와 어긋남), 구성원의 알림 직접 생성(스팸), 부족 신고·입고 직접 INSERT, 매니저의 발주 직접 UPDATE를 닫았다. 모두 위 함수·트리거가 대신한다. 점주의 전체 쓰기 정책과 모든 읽기 정책은 그대로다.
- **매니저가 근무표를 확정할 수 있던 구멍을 막았다.** 0단계의 "매니저 UPDATE" 정책은 값 제한이 없어 `status='확정'`으로 직접 바꿀 수 있었다. 트리거(`20261028000200`)로 확정·공개·되돌리기는 점주(또는 시스템)만 하게 했다.
- **프런트:** `devUser.js` 제거. 모든 화면이 로그인한 `account.id`를 쓴다(`lib/currentUser.js`). `AppState`는 로그인 사용자가 바뀔 때만 다시 읽고, 로그아웃·체험 로그인이면 예시 상태로 되돌린다(이전 사용자 데이터 잔존·늦게 온 응답 덮어쓰기 방지).

## 검증
- 새 테스트 `supabase/tests/auth_permissions.sql`(assert 기반, psql 전용 명령 없음, 롤백): 비로그인·알바생·매니저·점주·시스템 호출, 남의 id·다른 매장 거부, 직접 쓰기 우회, 근무표 편집 경로, 알바생의 스케줄 가시성, anon 실행 가능 함수 0개. **권한 마이그레이션을 빼면 실패하는 것까지 확인했다.** 기존 테스트 4개도 로그인 시뮬레이션으로 교체해 7개 모두 통과.
- 원격(Supabase)에 적용 후 같은 테스트를 `supabase db query --linked`로 롤백 트랜잭션 실행 → PASS, 잔존 데이터 없음. 실제 로그인 토큰으로 PostgREST를 직접 호출해 확인(비로그인 401·읽기 0건, 알바생 관리 기능 403, 매니저 정상 실사 200, 남의 id 403).

## 남은 것 ✋
1. **로그인 정보가 약하다.** 세 계정 비밀번호가 `123456`, 이메일도 추측하기 쉽다. 공개 회원가입도 켜져 있다. 팀 밖에 주소를 공유하기 전에 비밀번호 변경·회원가입 끄기(Authentication 설정) 필요
2. **점주(owner)의 직접 쓰기 정책은 남아 있다**(menu·ingredient·recipe·sale·sales_*·work_schedule·attendance·payroll·purchase_order·receipt·order_recommendation·forecast_error·correction_coefficient 등). 점주는 신뢰한다는 0단계 설계지만, 점주 계정이 뚫리면 함수 규칙(예: 입고 시 재고 반영)을 우회해 직접 쓸 수 있다. 점주도 함수로만 쓰게 좁힐지 결정 필요
3. **개인정보 노출(0단계 설계):** `user_account` 읽기 정책이 같은 매장 전원에게 열려 있고 열 권한에 `hourly_wage`·`phone`·`login_id`가 있어 **알바생이 동료의 시급·연락처·이메일을 조회할 수 있다.** 필요하면 본인·점주만 보도록 좁혀야 한다
4. **가능시간(2-1)이 두 방식으로 남아 있다**(3~4단계 RPC / yunsu `ops_availability`). 데이터 모델(`target_week`)이 달라 스케줄 자동 생성이 어느 쪽을 보는지 정해야 한다
5. **알바생 화면에 정윤수 고정 표시가 남아 있다**(`StaffPages`의 `ME`: 이름·시급 등). API 호출은 로그인 사용자 id를 쓰지만, 다른 알바생 계정(박서진 등)으로 로그인하면 화면 일부는 정윤수 정보를 보여 준다. 현재 로그인 계정은 정윤수 1명뿐
6. **새 함수는 `anon` 실행 권한을 직접 회수해야 한다.** Supabase는 새 함수에 `anon` 실행 권한을 기본으로 준다. 마이그레이션마다 `revoke … from public, anon`을 넣고 `auth_permissions.sql`의 마지막 점검(anon 실행 가능 함수 0개)을 같이 돌릴 것
7. yunsu의 직원 초대 Edge Function(`invite-employee`)은 배포하지 않았다(직원 이메일 초대 불가). 그 화면의 Playwright UI 테스트는 실행하지 않았다

---

# (기록) yunsu·chanyoung 병합 직후의 문제 목록 — 위 "권한 정리 결과"로 대체됨


`develop`에 `yunsu`(8~10단계 + 로그인)를 병합한 뒤 확인한 것. **코드는 합쳐지고 빌드도 되지만, 원격 DB에 yunsu 마이그레이션을 적용하는 순간 11~15단계 화면과 3~7단계 화면이 서로 맞지 않는다.** 병합은 코드 그대로 했고(보안 정책을 임의로 되돌리지 않음), 아래 항목은 팀 결정이 필요하다.

## 한 일
- 충돌 2개 해결: `AppState.jsx`(yunsu의 `useOperations`·`ops` 추가), `기능구현순서.md`
- yunsu 마이그레이션을 `20261027000100_operations_8_10.sql`로 이름 변경 (A·B 마이그레이션 `20261026…`, 내 `20261021…~20261025…`과 버전 겹침 방지). `8-10단계_DB반영_안내.md`, `app/tests/database.test.js`의 파일명도 같이 수정
- 검증: 전체 마이그레이션 13개를 시드 위에 적용(Auth 스텁 사용) → 적용 성공. 내 테스트 6개 중 5개 통과, `order_receipt` 1개 실패 (아래 1번)

## 충돌하는 지점 (적용 후 발생)
1. **anon 읽기 정책 삭제 → 11~15단계 읽기가 비어 버림**
   - yunsu 마이그레이션이 `anon read …` 정책 10개를 지운다: store, menu, ingredient, recipe, inventory, sales_summary, sales_forecast, correction_coefficient, order_recommendation, purchase_order
   - 영향: 재고 현황(ingredient+inventory), 권장 발주량, 발주 내역, 보정 계수 조회가 0건이 된다. 재고 화면은 "DB 연결됨 + 재고 0건"이라 빈 표로 보임. `supabase/tests/order_receipt.sql`이 이 이유로 실패(`no rows returned for \gset`)
   - A(5~7단계)의 임시 읽기 정책 2개(`anon read work_schedule/shift_assignment (임시)`)도 이 패턴에 걸려 같이 삭제됨 → `scheduleRepo.fetchSchedule`(수정됨 표시 조회)이 빈 값
2. **로그인한 사용자는 내 함수를 실행할 수 없음**
   - 내 화면용 함수(재고 조정·신고·발주·입고·출퇴근 등)는 `anon`에만 실행 권한을 줬고, 로그인하면 요청이 `authenticated` 역할로 간다. 지금 `authenticated`가 실행할 수 있는 건 yunsu의 `ops_*` 4개뿐
   - 즉, 로그인 화면을 통과해도 11~15단계 쓰기가 막힌다
3. **로그인 게이트가 다른 단계 화면을 가림**
   - `OperationsAuth.jsx`의 `RouteGate`는 실제 DB 모드(Supabase 설정됨 = 배포 환경)에서 `implemented` 목록 밖의 경로를 "아직 예시 데이터 단계입니다" 안내로 막는다. 목록에는 8~10단계 경로 9개만 있어 **스케줄 편성·검토·확정, 재고, 발주, 출퇴근, 급여, 오차 보정 화면이 모두 가려짐**
   - 로컬 체험(데모) 모드에서는 모든 화면이 열린다
4. **가능시간(2-1)이 두 가지로 구현됨**
   - B(3단계): `get_availability`/`save_availability` — 주차 정보 없이 저장, 직원 화면 `StaffAvailability`
   - yunsu(9단계): `ops_availability` — `availability.target_week`·`is_unavailable` 컬럼, 화면 `AvailabilityEditor`. 라우터에서 `/staff/availability`가 `AvailabilityEditor`로 **교체**돼 B의 화면은 연결이 끊김
   - 데이터 충돌: "불가" 표시용 자리 행(0요일 00:00~00:00)을 B의 `availability_of`가 일반 가능시간처럼 읽을 수 있고, B는 `target_week`가 없는 행을 만든다. 스케줄 자동 생성(2-3)이 어느 쪽 가능시간을 기준으로 할지 정해야 함
5. 사용자 식별이 셋으로 갈림: yunsu는 `auth.uid()` 기반(`user_account.auth_user_id`), A·B는 화면 mock의 `userId`/`dbId` 고정, 내 쪽은 `lib/devUser.js` 고정(점주 1·매니저 2·알바생 3)

## 결정이 필요한 것 ✋
- 기준을 어디에 둘지: **yunsu의 로그인(`ops_actor`)을 공통 기반으로 삼고 A·B·내 기능을 맞춘다**(권장) / 개발 중에는 anon 임시 정책을 유지하고 인증은 마지막에 한 번에 붙인다
- 가능시간은 **yunsu 방식(주차 포함)으로 통일**할지, B 방식으로 둘지
- 로그인 게이트 `implemented` 목록에 각 단계 경로를 추가할 시점 (해당 기능이 `authenticated`로 동작하도록 고친 뒤)

## 권장 순서 (제안)
1. 원격에는 yunsu 마이그레이션을 **적용하지 않은 상태로** 위 결정을 먼저 내린다 (지금 원격은 anon 읽기가 살아 있어 11~15단계가 동작 중)
2. 내 쪽: 화면용 함수에 `authenticated` 실행 권한과 역할 검사(`ops_actor` 사용, 점주/매니저/알바생별)를 넣고 임시 정책·`devUser.js` 제거, 읽기는 정식 RLS 정책(같은 매장, 역할별)으로 교체
3. A·B 쪽: 가능시간 모델 통일, 임시 anon 쓰기 정책 제거, `userId`/`dbId`를 로그인 사용자로 교체
4. 각 기능이 로그인 상태에서 동작하면 `implemented`에 경로 추가

---

# 업데이트: chanyoung(0~2단계 인증·RLS) 병합 후

`yunsu`와 `chanyoung`이 각자 인증을 만들어서 `develop`에 로그인 구현이 두 벌 있었다. **로그인·라우트 가드는 chanyoung 것(`lib/auth.jsx`, `RequireRole`, `EntryPage`)을 기준으로 하나로 합쳤다.** 둘 다 같은 `supabase.auth` 세션과 같은 `user_account.auth_user_id` 컬럼을 쓰므로 yunsu의 8~10단계 화면은 같은 로그인 위에서 동작한다. 위의 1~3번(anon 읽기 삭제로 내 화면이 빔, 로그인 게이트가 화면을 가림)은 아래 내용으로 **대체**된다.

## 한 일
- 코드 충돌 3개 해결: `router.jsx`(`RequireRole`·`EntryPage` 사용, `/owner/sales/status`는 chanyoung의 `SalesStatusPage`), `Layouts.jsx`(chanyoung의 `useAuth`/`useLogout`, 알림 수신자는 로그인한 사용자 id), `기능구현순서.md`
- yunsu의 `OperationsAuth.jsx`(`LoginPage`·`RouteGate`)는 더 이상 연결되지 않는다(파일은 남겨 둠). `LogoutButton`은 제거
- 마이그레이션 순서 정리 (버전이 서로 겹치던 것 해소): A·B `20261026000100~200` → **chanyoung `20261026000300~500`** → **yunsu `20261027000100`**. yunsu 파일은 `auth_user_id` 컬럼 추가를 `if not exists`로 바꿔 chanyoung이 먼저 적용돼도 안전
- 17개 마이그레이션을 시드 위에 순서대로 적용 성공. 역할별 접근 시뮬레이션:

| 역할 | 결과 |
|---|---|
| 점주(로그인) | 재고·권장 발주량·보정 계수·신고·본인 알림이 RLS로 정상 조회, yunsu `ops_snapshot` 정상 |
| 알바생(로그인) | 매출 0건(차단), 타인 급여 0건, 본인 급여 1건, 재고 조회 가능 |
| 비로그인 | 재고·메뉴 등 기초 데이터는 0건(차단) |

## 아직 남은 문제 (원격에 적용하기 전에 처리해야 함) ✋
1. **비로그인(anon)이 읽을 수 있는 테이블**: attendance(출퇴근), payroll(급여), work_schedule, shift_assignment, shortage_report, notification, forecast_error, user_account — 내 개발용 정책(`dev anon read …`)과 팀원 A의 임시 정책 때문. 로그인해야 한다는 chanyoung의 설계와 어긋남
2. **비로그인(anon)이 쓸 수 있는 것**: work_schedule·shift_assignment 직접 쓰기(A의 임시 정책), 그리고 anon에 열린 함수 17개 — 내 함수(재고 조정·신고·발주·입고·출퇴근·마감 실행·알림 읽음 등)와 3~4단계 함수(`get_schedule`, `generate_schedule_draft`, `get/save_availability`)
3. **로그인한 사용자는 내 함수를 실행할 수 없음**: 내 함수는 `anon`에만 권한이 있어서 점주로 로그인해도 "permission denied". 즉 11~15단계 **쓰기가 로그인 상태에서 막힌다**(읽기는 RLS로 정상)
4. 내 화면의 사용자는 아직 `lib/devUser.js` 고정값(점주 1·매니저 2·알바생 3)이고, 알림만 로그인 사용자 id를 쓴다 — 출퇴근·신고·발주·입고도 로그인 사용자의 `account.id`로 바꿔야 함
5. 내 테스트 2개가 실패 (`stock_adjust_report`, `order_receipt`) — anon으로 읽던 걸 더는 읽지 못해서. 로그인 사용자 기준으로 고쳐야 함
6. 가능시간(2-1)이 두 방식(3~4단계 RPC / yunsu `ops_availability`)으로 남아 있음, `scheduleRepo`의 직접 쓰기는 anon 정책에 기대고 있음
7. yunsu의 Playwright UI 테스트(`app/tests/ui/operations.spec.js`)는 yunsu의 로그인 화면 기준이라 깨질 수 있음(실행하지 않음). chanyoung의 체험 모드(`VITE_DEMO_LOGIN`)와 yunsu의 로컬 체험은 별개이고, 환경변수가 있으면 yunsu 화면은 실제 DB 모드로 동작해 체험 로그인으로는 데이터가 안 보임

## 제안: 다음 작업
내 쪽 권한을 chanyoung의 역할 모델에 맞춘다 — 함수에 `authenticated` 권한과 역할 검사(`app.my_user_id()`/`app.my_role()`)를 넣고 사용자 id는 로그인 값으로, 내 개발용 정책·`devUser.js` 제거, 테스트를 로그인 시뮬레이션으로 교체. 3~4단계 함수와 A의 임시 정책도 같은 방식으로 정리해야 한다.
