import { useEffect, useState } from 'react';
import { Badge, PageHead, Panel, SampleTag, StatCard, Tabs } from '../../components/ui/index.jsx';
import { ATTENDANCE, DAYS, PAYROLL, THIS_DATES, staffById } from '../../mocks/data.js';
import { attendanceFlags, pct, won, workedHours } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { fetchLabor } from '../../lib/attendance.js';

/* 3-3 · 예정·실제 인건비 비교 + 이번 주 출퇴근 기록 (점주) */
// 예시 데이터(체험 모드·DB 조회 실패 시). 실제 매장 로그인에서는 직원 목록(staffById)이 DB 직원으로 바뀌므로 로드 시점에 한 번만 만든다.
const SAMPLE = {
  rows: PAYROLL.map((r) => ({ key: r.staffId, name: staffById[r.staffId].name, wage: staffById[r.staffId].wage, planHours: r.planHours, actualHours: r.actualHours })),
  att: ATTENDANCE.map((a) => ({ id: a.id, name: staffById[a.staffId].name, dateLabel: `${THIS_DATES[a.day]}(${DAYS[a.day]})`, plan: a.plan, actual: a.actual, flags: attendanceFlags(a), hours: workedHours(a) })),
  month: 10, weekRange: `${THIS_DATES[0]} – ${THIS_DATES[6]}`,
};

export default function LaborPage() {
  const { inventorySource } = useApp();
  const [tab, setTab] = useState('labor');
  // DB 연결 시: 이번 달 예정(확정 근무 배정)·실제(출퇴근) 시간과 이번 주 출퇴근 기록을 DB에서 읽는다. 아니면 예시 데이터.
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (inventorySource === 'db') fetchLabor().then(setLive).catch((e) => console.warn('인건비 조회 실패, 예시 데이터 사용:', e.message));
  }, [inventorySource]);
  const data = live ?? SAMPLE;
  const rows = data.rows.map((r) => ({ ...r, plan: r.planHours * r.wage, actual: r.actualHours * r.wage }));
  const plan = rows.reduce((a, r) => a + r.plan, 0);
  const actual = rows.reduce((a, r) => a + r.actual, 0);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.plan, r.actual)));
  const lateCount = data.att.filter((a) => a.flags.length).length;

  return (
    <>
      <PageHead eyebrow="근무 관리" title="출퇴근·인건비" desc="확정 근무표의 예정 인건비와 출퇴근 기록으로 계산한 실제 인건비를 비교합니다." />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label={`${data.month}월 예정 인건비`} value={won(plan)} sub="근무 배정 × 시급" />
          <StatCard label={`${data.month}월 실제 인건비`} value={won(actual)} sub={plan > 0 ? <><span className={actual > plan ? 'delta-down' : 'delta-up'}>{pct(((actual - plan) / plan) * 100)}</span> 예정 대비</> : '예정 근무 없음'} />
          <StatCard label="이번 주 지각·조퇴" value={lateCount} unit="건" sub="출퇴근 기록 자동 판정" />
        </div>
        <Tabs label="보기 선택" value={tab} onChange={setTab} tabs={[{ id: 'labor', label: '직원별 인건비' }, { id: 'att', label: '이번 주 출퇴근 기록' }]} />
        {tab === 'labor' ? (
          <Panel id="lb" title="직원별 예정 vs 실제" meta={`${data.month}월 1일 – 오늘`} actions={live ? null : <SampleTag />}>
            <div className="compare-bars" style={{ marginBottom: 24 }}>
              {rows.map((r) => (
                <div className="cb-row" key={r.key}>
                  <strong>{r.name}</strong>
                  <div className="cb-track" aria-hidden="true">
                    <span className="cb-bar cb-plan" style={{ width: `${(r.plan / max) * 100}%` }} />
                    <span className="cb-bar cb-actual" style={{ width: `${(r.actual / max) * 100}%` }} />
                  </div>
                  <span className="num">{won(r.actual)}</span>
                </div>
              ))}
              <div className="legend"><span className="legend-swatch cb-plan" />예정<span className="legend-swatch cb-actual" style={{ marginLeft: 12 }} />실제</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">이름</th><th scope="col" className="num">시급</th><th scope="col" className="num">예정 시간</th><th scope="col" className="num">실제 시간</th><th scope="col" className="num">예정 인건비</th><th scope="col" className="num">실제 인건비</th><th scope="col" className="num">차이</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.name}</th>
                      <td className="num">{won(r.wage)}</td>
                      <td className="num">{r.planHours}시간</td>
                      <td className="num">{r.actualHours}시간</td>
                      <td className="num">{won(r.plan)}</td>
                      <td className="num">{won(r.actual)}</td>
                      <td className="num">{r.actual === r.plan ? '—' : <span className={r.actual > r.plan ? 'delta-down' : 'delta-up'}>{r.actual > r.plan ? '+' : '−'}{won(Math.abs(r.actual - r.plan))}</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th scope="row" colSpan={4}>합계</th><td className="num">{won(plan)}</td><td className="num">{won(actual)}</td><td className="num">{won(actual - plan)}</td></tr></tfoot>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel id="att" title="이번 주 출퇴근 기록" meta={data.weekRange}>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">날짜</th><th scope="col">이름</th><th scope="col" className="num">예정</th><th scope="col" className="num">출근</th><th scope="col" className="num">퇴근</th><th scope="col" className="num">실 근무</th><th scope="col">판정</th></tr></thead>
                <tbody>
                  {data.att.length === 0 && <tr><td colSpan={7} className="muted">이번 주 출퇴근 기록이 없습니다.</td></tr>}
                  {data.att.map((a) => {
                    const flags = a.flags;
                    const h = a.hours;
                    return (
                      <tr key={a.id}>
                        <td className="od-nowrap">{a.dateLabel}</td>
                        <th scope="row">{a.name}</th>
                        <td className="num">{a.plan ? a.plan.join('–') : '예정 없음'}</td>
                        <td className="num">{a.actual[0] || '—'}</td>
                        <td className="num">{a.actual[1] || '근무 중'}</td>
                        <td className="num">{h == null ? '—' : `${h.toFixed(1)}시간`}</td>
                        <td>{a.actual[1] == null ? <Badge tone="blue">근무 중</Badge> : flags.length ? flags.map((f) => <Badge key={f} tone="orange">{f}</Badge>) : <Badge tone="green">정상</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
