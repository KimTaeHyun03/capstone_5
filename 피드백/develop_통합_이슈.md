# develop 통합 이슈 (yunsu 병합 후)

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
