import { Badge, Button, PageHead, Panel, StatCard } from '../../components/ui/index.jsx';
import { TODAY } from '../../mocks/data.js';
import { useApp } from '../../state/AppState.jsx';
import { useAuth } from '../../lib/auth.jsx';

/* 매니저 홈 — 오늘 처리할 일 모음 */
export default function ManagerHome() {
  const { account } = useAuth();
  const { schedState, lowStock, reports, orders } = useApp();
  const waiting = orders.filter((o) => o.status === '대기');
  const todos = [
    schedState === 'review' && { title: '다음 주 근무표 초안 검토', sub: '점주가 검토를 요청했습니다 · 2-4', to: '/manager/schedule', tone: 'blue', tag: '검토 요청' },
    waiting.length > 0 && { title: `입고 대기 ${waiting.length}건 처리`, sub: waiting.map((o) => o.id).join(', ') + ' · 5-3', to: '/manager/receive', tone: 'orange', tag: '입고 대기' },
    lowStock.length + reports.length > 0 && { title: `부족 재료 ${lowStock.length + reports.length}건 확인`, sub: '최소 보유량 미달·직원 신고 · 4-5', to: '/manager/alerts', tone: 'red', tag: '부족' },
    { title: '주간 재고 실사', sub: '매주 일요일 마감 전 · 4-3', to: '/manager/stocktake', tone: 'gray', tag: '정기' },
  ].filter(Boolean);
  return (
    <>
      <PageHead eyebrow={`오늘 ${TODAY.label}`} title={`안녕하세요, ${account?.name ?? ''} 매니저님`} desc="오늘 처리할 일입니다. 항목을 누르면 해당 화면으로 이동합니다." />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="근무표 상태" value={{ none: '초안 전', draft: '점주 작성 중', review: '검토 요청', published: '확정' }[schedState]} to="/manager/schedule" />
          <StatCard label="입고 대기" value={waiting.length} unit="건" to="/manager/receive" />
          <StatCard label="부족 재료" value={lowStock.length + reports.length} unit="건" to="/manager/alerts" />
        </div>
        <Panel id="mg-todo" title="할 일" meta={`${todos.length}건`}>
          <div className="list">
            {todos.map((t) => (
              <div className="list-row" key={t.title}>
                <div className="list-main">
                  <span className="list-title">{t.title}</span>
                  <span className="list-sub">{t.sub}</span>
                </div>
                <Badge tone={t.tone}>{t.tag}</Badge>
                <Button variant="secondary" to={t.to}>열기</Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
