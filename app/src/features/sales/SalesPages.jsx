import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, PageHead, Panel, SampleTag, Segment, StatCard, Icon } from '../../components/ui/index.jsx';
import { Heatmap, ForecastBars } from '../../components/charts/index.jsx';
import { DAYS, HOURS, LAST_WEEK, AVG_4W, FORECAST, MENUS, NEXT_RANGE, THIS_DATES, TODAY } from '../../mocks/data.js';
import { man, needStaff, pct, recommendQty, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';

const sum = (rows) => rows.flat().reduce((a, b) => a + b, 0);
const peakOf = (rows) => {
  const flat = rows.flat();
  const i = flat.indexOf(Math.max(...flat));
  return { day: DAYS[Math.floor(i / HOURS.length)], hour: HOURS[i % HOURS.length], v: flat[i] };
};

/* 대시보드 — 점주 홈 */
export function OwnerDashboard() {
  const { lowStock, reports, schedState, inventory, notifications } = useApp();
  const lastTotal = sum(LAST_WEEK);
  const nextTotal = sum(FORECAST);
  const diff = ((nextTotal - lastTotal) / lastTotal) * 100;
  const peak = peakOf(FORECAST);
  const orderCount = inventory.filter((i) => recommendQty(i) > 0).length;
  const schedBadge = { none: ['gray', '초안 없음'], draft: ['orange', '초안 작성 중'], review: ['blue', '매니저 검토 중'], published: ['green', '확정·공개됨'] }[schedState];

  return (
    <>
      <PageHead eyebrow={`오늘 ${TODAY.label}`} title="안녕하세요, 김찬영 점주님"
        desc={`다음 주(${NEXT_RANGE}) 예측과 오늘 처리할 일을 모았습니다.`}
        actions={<Button icon="calendar" to="/owner/work/schedule">스케줄 편성</Button>} />

      <div className="stack-lg">
        {(lowStock.length > 0 || reports.length > 0) && (
          <Alert tone="danger" title={`재고 부족 ${lowStock.length}건 · 직원 신고 ${reports.length}건`}
            action={<Button variant="secondary" to="/owner/stock/alerts">확인하기</Button>}>
            {lowStock.map((i) => i.name).join(', ')}이(가) 최소 보유량보다 적습니다.
          </Alert>
        )}

        <div className="grid-4">
          <StatCard label="다음 주 예측 매출" value={man(nextTotal)} unit="만원" sub={<><span className={diff >= 0 ? 'delta-up' : 'delta-down'}>{pct(diff)}</span> 지난주 대비</>} to="/owner/sales/forecast" />
          <StatCard label="예측 피크타임" value={`${peak.day} ${peak.hour}시`} sub={`시간당 ${peak.v}천원 · 필요 ${needStaff(peak.v)}명`} to="/owner/sales/forecast" />
          <StatCard label="다음 주 근무표" value={<Badge tone={schedBadge[0]}>{schedBadge[1]}</Badge>} sub="가능시간 제출 6명 중 5명" to="/owner/work/schedule" />
          <StatCard label="권장 발주 품목" value={orderCount} unit="개" sub="보정 계수 반영" to="/owner/order/recommend" />
        </div>

        <div className="grid-2">
          <Panel id="db-fc" title="다음 주 시간대별 예측" meta="예측 매출 · 필요 인원" actions={<SampleTag />}>
            <ForecastBars />
          </Panel>
          <Panel id="db-todo" title="최근 알림" actions={<Button variant="text" to="/owner/stock/alerts">전체 보기</Button>}>
            <div className="list">
              {notifications.slice(0, 5).map((n) => (
                <div className="list-row" key={n.id}>
                  <div className="list-main">
                    <span className="list-title">{n.title}</span>
                    <span className="list-sub">{n.at}</span>
                  </div>
                  {!n.read && <Badge tone="blue">새 알림</Badge>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* 1-2 · 요일·시간대별 매출 조회 */
export function SalesStatusPage() {
  const [range, setRange] = useState('last');
  const data = range === 'last' ? LAST_WEEK : AVG_4W;
  const total = sum(data);
  const byDay = data.map((r) => r.reduce((a, b) => a + b, 0));
  const maxDay = Math.max(...byDay);
  const menuTotal = MENUS.reduce((a, m) => a + m.sold * m.price, 0);
  return (
    <>
      <PageHead eyebrow="매출 분석 · 1-2" title="매출 현황" desc="요일·시간대별로 언제 손님이 몰리는지 확인합니다."
        actions={<Segment label="기간" value={range} onChange={setRange} options={[{ value: 'last', label: `지난주 ${THIS_DATES[0]}~` }, { value: 'avg', label: '최근 4주 평균' }]} />} />
      <div className="stack-lg">
        <Alert tone="info" title="판매 기록 출처는 아직 정하지 않았습니다">
          POS 연동·직접 입력·파일 업로드 중 방식이 정해지면 1-1 판매 기록 수집 화면이 추가됩니다. 지금은 예시 매출입니다.
        </Alert>
        <div className="grid-3">
          <StatCard label="주간 매출" value={man(total)} unit="만원" />
          <StatCard label="하루 평균" value={man(total / 7)} unit="만원" />
          <StatCard label="최고 매출 요일" value={`${DAYS[byDay.indexOf(maxDay)]}요일`} sub={`${man(maxDay)}만원`} />
        </div>
        <Panel id="ss-hm" title="요일 × 시간대 매출" meta="단위: 천원" actions={<SampleTag />}>
          <Heatmap data={data} caption={range === 'last' ? '지난주 요일·시간대별 매출(천원)' : '최근 4주 평균 요일·시간대별 매출(천원)'} />
        </Panel>
        <Panel id="ss-menu" title="메뉴별 판매" meta="지난주">
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">메뉴</th><th scope="col">분류</th><th scope="col" className="num">판매 수량</th><th scope="col" className="num">매출</th><th scope="col" className="num">비중</th></tr></thead>
              <tbody>
                {MENUS.filter((m) => m.onSale).sort((a, b) => b.sold * b.price - a.sold * a.price).map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.name}</th>
                    <td>{m.category}</td>
                    <td className="num">{m.sold.toLocaleString()}잔</td>
                    <td className="num">{won(m.sold * m.price)}</td>
                    <td className="num">{((m.sold * m.price / menuTotal) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* 1-3 · 피크타임·예측 매출 확인 */
export function ForecastPage() {
  const lastTotal = sum(LAST_WEEK);
  const nextTotal = sum(FORECAST);
  const peak = peakOf(FORECAST);
  const lastPeak = peakOf(LAST_WEEK);
  const peakUp = ((peak.v - lastPeak.v) / lastPeak.v) * 100;
  const dayTotals = FORECAST.map((r, di) => ({ d: DAYS[di], next: r.reduce((a, b) => a + b, 0), last: LAST_WEEK[di].reduce((a, b) => a + b, 0) }));
  return (
    <>
      <PageHead eyebrow="매출 분석 · 1-3" title="매출 예측" desc={`${NEXT_RANGE} 예측입니다. 최근 4주 같은 요일·시간대 매출에 보정 계수를 곱해 계산합니다.`}
        actions={<Button icon="calendar" to="/owner/work/schedule">이 예측으로 근무표 만들기</Button>} />
      <div className="stack-lg">
        {peakUp > 0 && (
          <Alert tone="warning" title={`피크 매출이 지난주보다 ${peakUp.toFixed(0)}% 높게 예측됩니다`}>
            {peak.day}요일 {peak.hour}시에 {needStaff(peak.v)}명이 필요합니다. 근무표 초안에 자동 반영됩니다.
          </Alert>
        )}
        <div className="grid-3">
          <StatCard label="다음 주 예측 매출" value={man(nextTotal)} unit="만원" sub={<><span className="delta-up">{pct(((nextTotal - lastTotal) / lastTotal) * 100)}</span> 지난주 대비</>} />
          <StatCard label="예측 피크타임" value={`${peak.day} ${peak.hour}시`} sub={`${peak.v}천원 · 지난주 피크 ${lastPeak.day} ${lastPeak.hour}시`} />
          <StatCard label="최대 필요 인원" value={needStaff(peak.v)} unit="명" sub="시간당 10만원 이상 = 3명" />
        </div>
        <Panel id="fc-bars" title="요일별 시간대 예측" actions={<SampleTag />}>
          <ForecastBars />
        </Panel>
        <Panel id="fc-day" title="요일별 합계 비교" meta="단위: 만원">
          <div className="compare-bars">
            {dayTotals.map((r) => {
              const max = Math.max(...dayTotals.map((x) => Math.max(x.next, x.last)));
              return (
                <div className="cb-row" key={r.d}>
                  <strong>{r.d}요일</strong>
                  <div className="cb-track" aria-hidden="true">
                    <span className="cb-bar cb-plan" style={{ width: `${(r.last / max) * 100}%` }} />
                    <span className="cb-bar cb-actual" style={{ width: `${(r.next / max) * 100}%` }} />
                  </div>
                  <span className="num">{man(r.next)} <span className="muted">/ {man(r.last)}</span></span>
                </div>
              );
            })}
          </div>
          <div className="legend"><span className="legend-swatch cb-plan" />지난주 실적<span className="legend-swatch cb-actual" style={{ marginLeft: 12 }} />다음 주 예측</div>
        </Panel>
        <p className="help"><Icon name="info" size="sm" /> 필요 인원 기준: 시간당 예측 매출 5만원 미만 1명 · 10만원 미만 2명 · 그 이상 3명 (점주 설정값 예시)</p>
        <Link to="/owner/sales/status" className="btn btn-text" style={{ alignSelf: 'flex-start' }}>지난 매출 현황 보기</Link>
      </div>
    </>
  );
}
