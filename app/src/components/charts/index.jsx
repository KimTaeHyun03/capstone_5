import { useState } from 'react';
import { DAYS, HOURS, FORECAST, NEXT_DATES } from '../../mocks/data.js';
import { needStaff, man } from '../../domain/index.js';
import { Segment } from '../ui/index.jsx';

/* 1-2 · 요일·시간대별 매출 히트맵 */
export function Heatmap({ data, caption }) {
  const flat = data.flat();
  const max = Math.max(...flat);
  const min = Math.min(...flat);
  const peakIdx = flat.indexOf(max);
  const level = (v) => Math.min(5, Math.floor(((v - min) / (max - min || 1)) * 6));
  return (
    <>
      <div className="heatmap-wrap" tabIndex={0} role="region" aria-label={`${caption}, 가로로 스크롤할 수 있습니다`}>
        <div className="heatmap" role="table" aria-label={caption}>
          <div role="row" style={{ display: 'contents' }}>
            <span className="hm-colhead" role="columnheader"><span className="sr-only">요일</span></span>
            {HOURS.map((h) => <span key={h} className="hm-colhead" role="columnheader">{h}시</span>)}
          </div>
          {DAYS.map((d, di) => (
            <div role="row" key={d} style={{ display: 'contents' }}>
              <span className="hm-rowhead" role="rowheader">{d}</span>
              {data[di].map((v, hi) => {
                const isPeak = di * HOURS.length + hi === peakIdx;
                return (
                  <span key={hi} role="cell" className={`hm-cell hm-l${level(v)} ${isPeak ? 'is-peak' : ''}`}
                    aria-label={`${d}요일 ${HOURS[hi]}시 ${v}천원${isPeak ? ', 최고 매출' : ''}`}>{v}</span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="legend" aria-hidden="true">
        <span>낮음</span>
        {[0, 1, 2, 3, 4, 5].map((l) => <span key={l} className={`legend-swatch hm-l${l}`} />)}
        <span>높음</span>
        <span className="push">단위: 천원 · 굵은 테두리 = 최고 매출 칸</span>
      </div>
    </>
  );
}

/* 1-3 · 다음 주 시간대별 예측 + 필요 인원
   forecast = { matrix(천원), staff(명), dates } — 비우면 예시 데이터 */
const DEMO_FORECAST = { matrix: FORECAST, staff: FORECAST.map((r) => r.map(needStaff)), dates: NEXT_DATES };
export function ForecastBars({ forecast = DEMO_FORECAST, initialDay = 5 }) {
  const [day, setDay] = useState(initialDay);
  const row = forecast.matrix[day];
  const staff = forecast.staff[day];
  const max = Math.max(...forecast.matrix.flat()) || 1;
  const peak = Math.max(...row);
  const total = row.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="od-cluster" style={{ '--od-gap': '12px' }}>
        <Segment label="요일 선택" value={day} onChange={setDay} options={DAYS.map((d, i) => ({ value: i, label: d }))} />
        <span className="panel-meta push">{forecast.dates[day]}({DAYS[day]}) · 합계 <strong className="od-nowrap">{man(total)}만원</strong></span>
      </div>
      <div className="bars" aria-hidden="true">
        {row.map((v, i) => (
          <div className="bar-col" key={`${day}-${i}`}>
            <span className="bar-val">{v}</span>
            <span className="bar-track"><span className={`bar ${v === peak ? 'is-peak' : ''}`} style={{ height: `${(v / max) * 100}%`, animationDelay: `${i * 30}ms` }} /></span>
            <span className="bar-x">{HOURS[i]}</span>
          </div>
        ))}
      </div>
      <div className="staff-row" aria-hidden="true">
        {staff.map((n, i) => <span key={i} className="staff-dot">{n}</span>)}
      </div>
      <p className="help" style={{ marginTop: 8 }}>막대 = 예측 매출(천원), 아래 숫자 = 필요 인원(명) · 파란 막대 = 그날 피크</p>
      <table className="sr-only">
        <caption>{DAYS[day]}요일 시간대별 예측 매출과 필요 인원</caption>
        <thead><tr><th>시간</th><th>예측 매출(천원)</th><th>필요 인원</th></tr></thead>
        <tbody>{row.map((v, i) => <tr key={i}><td>{HOURS[i]}시</td><td>{v}</td><td>{staff[i]}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
