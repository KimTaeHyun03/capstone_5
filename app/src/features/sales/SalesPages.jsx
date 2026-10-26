import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, EmptyState, PageHead, Panel, SampleTag, Segment, StatCard, Icon, useToast } from '../../components/ui/index.jsx';
import { Heatmap, ForecastBars } from '../../components/charts/index.jsx';
import { DAYS, HOURS, NEXT_RANGE, TODAY, OWNER } from '../../mocks/data.js';
import { man, pct, recommendQty, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { AiInsight } from '../ai/AiInsight.jsx';
import { generateForecast, nextWeekStart, rangeLabel, useSales } from './useSales.js';

const sum = (rows) => rows.flat().reduce((a, b) => a + b, 0);
const peakOf = (rows) => {
  const flat = rows.flat();
  const i = flat.indexOf(Math.max(...flat));
  return { di: Math.floor(i / HOURS.length), day: DAYS[Math.floor(i / HOURS.length)], hour: HOURS[i % HOURS.length], hi: i % HOURS.length, v: flat[i] };
};
const change = (next, last) => (last ? ((next - last) / last) * 100 : 0);
// 예시 모드는 고정 문구, 연동 모드는 데이터의 실제 주차
const forecastRange = (sales) => (sales.demo ? NEXT_RANGE : rangeLabel(sales.forecast.dates));

function Loading() {
  return <p className="auth-loading" role="status">매출 데이터를 불러오는 중…</p>;
}
function LoadError({ message, onRetry }) {
  return <Alert tone="danger" title="매출 데이터를 불러오지 못했습니다" action={<Button variant="secondary" icon="refresh" onClick={onRetry}>다시 시도</Button>}>{message}</Alert>;
}
const DataTag = ({ demo }) => (demo ? <SampleTag /> : null);

/* 대시보드 — 점주 홈 */
export function OwnerDashboard() {
  const { lowStock, reports, schedState, inventory, notifications } = useApp();
  const { account } = useAuth();
  const sales = useSales();
  const orderCount = inventory.filter((i) => recommendQty(i) > 0).length;
  const schedBadge = { none: ['gray', '초안 없음'], draft: ['orange', '초안 작성 중'], review: ['blue', '매니저 검토 중'], published: ['green', '확정·공개됨'] }[schedState];

  const fc = sales.forecast;
  const peak = fc && peakOf(fc.matrix);
  const diff = fc && sales.last ? change(sum(fc.matrix), sum(sales.last.matrix)) : null;

  return (
    <>
      <PageHead eyebrow={`오늘 ${TODAY.label}`} title={`안녕하세요, ${(account || OWNER).name} 점주님`}
        desc={fc ? `${forecastRange(sales)} 예측과 오늘 처리할 일을 모았습니다.` : '오늘 처리할 일을 모았습니다.'}
        actions={<Button icon="calendar" to="/owner/work/schedule">스케줄 편성</Button>} />

      <div className="stack-lg">
        {sales.error && <LoadError message={sales.error} onRetry={sales.reload} />}
        {(lowStock.length > 0 || reports.length > 0) && (
          <Alert tone="danger" title={`재고 부족 ${lowStock.length}건 · 직원 신고 ${reports.length}건`}
            action={<Button variant="secondary" to="/owner/stock/alerts">확인하기</Button>}>
            {lowStock.map((i) => i.name).join(', ')}이(가) 최소 보유량보다 적습니다.
          </Alert>
        )}

        <div className="grid-4">
          <StatCard label="예측 매출" value={fc ? man(sum(fc.matrix)) : '—'} unit={fc ? '만원' : undefined}
            sub={diff !== null ? <><span className={diff >= 0 ? 'delta-up' : 'delta-down'}>{pct(diff)}</span> 최근 실적 주 대비</> : '예측 없음'} to="/owner/sales/forecast" />
          <StatCard label="예측 피크타임" value={peak ? `${peak.day} ${peak.hour}시` : '—'}
            sub={peak ? `시간당 ${peak.v}천원 · 필요 ${fc.staff[peak.di][peak.hi]}명` : '예측 없음'} to="/owner/sales/forecast" />
          <StatCard label="다음 주 근무표" value={<Badge tone={schedBadge[0]}>{schedBadge[1]}</Badge>} sub="가능시간 제출 6명 중 5명" to="/owner/work/schedule" />
          <StatCard label="권장 발주 품목" value={orderCount} unit="개" sub="보정 계수 반영" to="/owner/order/recommend" />
        </div>

        <div className="grid-2">
          <Panel id="db-fc" title="시간대별 예측" meta="예측 매출 · 필요 인원" actions={<DataTag demo={sales.demo} />}>
            {sales.loading ? <Loading /> : fc ? <ForecastBars forecast={fc} initialDay={peak.di} />
              : <EmptyState icon="chart" title="아직 매출 예측이 없습니다" action={<Button variant="secondary" to="/owner/sales/forecast">예측 화면으로</Button>} />}
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
  const sales = useSales();
  const [range, setRange] = useState('last');
  const head = (
    <PageHead eyebrow="매출 분석 · 1-2" title="매출 현황" desc="요일·시간대별로 언제 손님이 몰리는지 확인합니다."
      actions={sales.last && <Segment label="기간" value={range} onChange={setRange}
        options={[{ value: 'last', label: `최근 주 ${sales.last.dates[0]}~` }, { value: 'avg', label: `최근 ${sales.avg.weeks}주 평균` }]} />} />
  );
  if (sales.loading) return <>{head}<Loading /></>;
  if (sales.error) return <>{head}<LoadError message={sales.error} onRetry={sales.reload} /></>;
  if (!sales.last) {
    return <>{head}<EmptyState icon="chart" title="확정된 매출 집계가 없습니다">판매 기록이 쌓이고 주간 마감이 되면 요일·시간대별 매출이 표시됩니다.</EmptyState></>;
  }

  const data = range === 'last' ? sales.last.matrix : sales.avg.matrix;
  const total = sum(data);
  const byDay = data.map((r) => r.reduce((a, b) => a + b, 0));
  const maxDay = Math.max(...byDay);
  const menus = [...sales.menuSales].sort((a, b) => b.amount - a.amount);
  const menuTotal = menus.reduce((a, m) => a + m.amount, 0);
  const caption = range === 'last' ? `${rangeLabel(sales.last.dates)} 요일·시간대별 매출(천원)` : `최근 ${sales.avg.weeks}주 평균 요일·시간대별 매출(천원)`;

  return (
    <>
      {head}
      <div className="stack-lg">
        <Alert tone="info" title="판매 기록 출처는 아직 정하지 않았습니다">
          POS 연동·직접 입력·파일 업로드 중 방식이 정해지면 1-1 판매 기록 수집 화면이 추가됩니다.{sales.demo ? ' 지금은 예시 매출입니다.' : ' 지금은 확정된 매출 집계(sales_summary)를 보여 줍니다.'}
        </Alert>
        <div className="grid-3">
          <StatCard label="주간 매출" value={man(total)} unit="만원" />
          <StatCard label="하루 평균" value={man(total / 7)} unit="만원" />
          <StatCard label="최고 매출 요일" value={`${DAYS[byDay.indexOf(maxDay)]}요일`} sub={`${man(maxDay)}만원`} />
        </div>
        <Panel id="ss-hm" title="요일 × 시간대 매출" meta="단위: 천원" actions={<DataTag demo={sales.demo} />}>
          <Heatmap data={data} caption={caption} />
        </Panel>
        <Panel id="ss-menu" title="메뉴별 판매" meta={sales.demo ? '지난주' : rangeLabel(sales.last.dates)}>
          {menus.length === 0 ? (
            <EmptyState icon="inbox" title="이 기간의 판매 기록이 없습니다">메뉴별 판매는 1-1 판매 기록이 저장되면 표시됩니다.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">메뉴</th><th scope="col">분류</th><th scope="col" className="num">판매 수량</th><th scope="col" className="num">매출</th><th scope="col" className="num">비중</th></tr></thead>
                <tbody>
                  {menus.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">{m.name}</th>
                      <td>{m.category}</td>
                      <td className="num">{m.qty.toLocaleString()}잔</td>
                      <td className="num">{won(m.amount)}</td>
                      <td className="num">{((m.amount / menuTotal) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

/* 1-3 · 피크타임·예측 매출 확인 */
export function ForecastPage() {
  const sales = useSales();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const target = nextWeekStart();

  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const n = await generateForecast(target);
      toast(`다음 주 예측을 계산했습니다 (${n}개 시간대)`);
      sales.reload();
    } catch (e) {
      setRunError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };
  const runButton = !sales.demo && (
    <Button variant="secondary" icon="refresh" onClick={run} disabled={running}>{running ? '계산 중…' : '다음 주 예측 계산'}</Button>
  );

  const fc = sales.forecast;
  const head = (
    <PageHead eyebrow="매출 분석 · 1-3" title="매출 예측"
      desc={fc ? `${forecastRange(sales)} 예측입니다. 최근 4주 같은 요일·시간대 매출 평균에 증감률을 곱해 계산합니다.` : '최근 4주 같은 요일·시간대 매출 평균에 증감률을 곱해 다음 주 매출을 예측합니다.'}
      actions={<>{runButton}<Button icon="calendar" to="/owner/work/schedule">이 예측으로 근무표 만들기</Button></>} />
  );
  if (sales.loading) return <>{head}<Loading /></>;
  if (sales.error) return <>{head}<LoadError message={sales.error} onRetry={sales.reload} /></>;

  const runAlert = runError && <Alert tone="danger" title="예측을 계산하지 못했습니다">{runError}</Alert>;
  if (!fc) {
    return <>{head}<div className="stack-lg">{runAlert}<EmptyState icon="chart" title="아직 매출 예측이 없습니다">{sales.last ? '‘다음 주 예측 계산’을 누르면 최근 매출로 예측을 만듭니다.' : '확정된 매출 집계가 있어야 예측할 수 있습니다.'}</EmptyState></div></>;
  }

  const last = sales.last?.matrix;
  const nextTotal = sum(fc.matrix);
  const lastTotal = last ? sum(last) : 0;
  const peak = peakOf(fc.matrix);
  const lastPeak = last && peakOf(last);
  const peakUp = lastPeak ? change(peak.v, lastPeak.v) : 0;
  const maxStaff = Math.max(...fc.staff.flat());
  const moreSlots = fc.more.flatMap((r, di) => r.map((m, hi) => (m ? `${DAYS[di]} ${HOURS[hi]}시` : null))).filter(Boolean);
  const stale = !sales.demo && fc.start < target;
  const dayTotals = fc.matrix.map((r, di) => ({ d: DAYS[di], next: r.reduce((a, b) => a + b, 0), last: last ? last[di].reduce((a, b) => a + b, 0) : 0 }));
  const dayMax = Math.max(...dayTotals.map((x) => Math.max(x.next, x.last))) || 1;

  return (
    <>
      {head}
      <div className="stack-lg">
        {runAlert}
        <AiInsight kind="forecast_brief" title="AI 주간 브리핑" hint="다음 주 예측을 직전 주 실적과 비교해 피크 요일·시간대와 증원 검토 시간대를 요약합니다." />
        {stale && (
          <Alert tone="info" title="다음 주 예측이 아직 없습니다">
            지금 보이는 것은 {rangeLabel(fc.dates)} 예측입니다. ‘다음 주 예측 계산’을 누르면 최근 매출로 새 예측을 만듭니다.
          </Alert>
        )}
        {(peakUp > 0 || moreSlots.length > 0) && (
          <Alert tone="warning" title={peakUp > 0 ? `피크 매출이 최근 실적보다 ${peakUp.toFixed(0)}% 높게 예측됩니다` : '필요 인원이 늘어나는 시간대가 있습니다'}>
            {peak.day}요일 {peak.hour}시에 {fc.staff[peak.di][peak.hi]}명이 필요합니다.
            {moreSlots.length > 0 && ` 증원 검토: ${moreSlots.slice(0, 5).join(', ')}${moreSlots.length > 5 ? ` 외 ${moreSlots.length - 5}곳` : ''}.`} 근무표 초안에 자동 반영됩니다.
          </Alert>
        )}
        <div className="grid-3">
          <StatCard label="예측 매출" value={man(nextTotal)} unit="만원"
            sub={last ? <><span className={nextTotal >= lastTotal ? 'delta-up' : 'delta-down'}>{pct(change(nextTotal, lastTotal))}</span> 최근 실적 주 대비</> : '비교할 실적 없음'} />
          <StatCard label="예측 피크타임" value={`${peak.day} ${peak.hour}시`} sub={lastPeak ? `${peak.v}천원 · 최근 피크 ${lastPeak.day} ${lastPeak.hour}시` : `${peak.v}천원`} />
          <StatCard label="최대 필요 인원" value={maxStaff} unit="명" sub="시간당 10만원 이상 = 3명" />
        </div>
        <Panel id="fc-bars" title="요일별 시간대 예측" actions={<DataTag demo={sales.demo} />}>
          <ForecastBars forecast={fc} initialDay={peak.di} />
        </Panel>
        <Panel id="fc-day" title="요일별 합계 비교" meta="단위: 만원">
          <div className="compare-bars">
            {dayTotals.map((r) => (
              <div className="cb-row" key={r.d}>
                <strong>{r.d}요일</strong>
                <div className="cb-track" aria-hidden="true">
                  <span className="cb-bar cb-plan" style={{ width: `${(r.last / dayMax) * 100}%` }} />
                  <span className="cb-bar cb-actual" style={{ width: `${(r.next / dayMax) * 100}%` }} />
                </div>
                <span className="num">{man(r.next)} <span className="muted">/ {man(r.last)}</span></span>
              </div>
            ))}
          </div>
          <div className="legend"><span className="legend-swatch cb-plan" />최근 실적{sales.last && !sales.demo ? ` (${rangeLabel(sales.last.dates)})` : ''}<span className="legend-swatch cb-actual" style={{ marginLeft: 12 }} />예측</div>
        </Panel>
        <p className="help"><Icon name="info" size="sm" /> 필요 인원 기준: 시간당 예측 매출 5만원 미만 1명 · 10만원 미만 2명 · 그 이상 3명 (점주 설정값 예시)</p>
        <Link to="/owner/sales/status" className="btn btn-text" style={{ alignSelf: 'flex-start' }}>지난 매출 현황 보기</Link>
      </div>
    </>
  );
}
