import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/index.jsx';
import { BrandMark } from '../../layouts/Layouts.jsx';
import { OWNER, STAFF, STORE } from '../../mocks/data.js';

// 로그인 화면 자리 — 인증 연동 전까지 역할 카드로 각 화면에 들어간다 (7-1 계정 등록 후 교체)
const ROLES = [
  { to: '/owner', icon: 'store', name: '점주', person: `${OWNER.name} · ${OWNER.email}`, desc: '매출 예측을 보고 근무표를 확정하고, 권장 발주량으로 발주합니다.' },
  { to: '/manager', icon: 'clipboard', name: '매니저', person: `${STAFF[0].name} · 재고 담당`, desc: '근무표 초안을 검토하고 재고 실사·입고·부족 알림을 처리합니다.' },
  { to: '/staff', icon: 'user', name: '알바생', person: `${STAFF[1].name} · 모바일`, desc: '가능시간을 등록하고 확정 근무표, 출퇴근, 급여를 확인합니다.' },
];

export default function EntryPage() {
  useEffect(() => { document.title = '로그인 · 카페 온기 운영 관리'; }, []);
  return (
    <main className="entry">
      <div className="entry-inner">
        <div className="entry-brand">
          <BrandMark />
          <h1 className="entry-title">감이 아니라 데이터로<br />발주하고 근무표 짜기</h1>
          <p className="entry-desc">{STORE.name}의 매출 패턴으로 다음 주 필요 인원과 재료 발주량을 계산합니다. 사용할 계정을 고르세요.</p>
        </div>
        <div className="role-grid">
          {ROLES.map((r) => (
            <Link key={r.to} className="role-card" to={r.to}>
              <span className="role-icon"><Icon name={r.icon} /></span>
              <span className="role-name">{r.name}</span>
              <span className="role-person">{r.person}</span>
              <span className="role-desc">{r.desc}</span>
              <span className="role-go">{r.name} 화면으로<Icon name="chevron" /></span>
            </Link>
          ))}
        </div>
        <p className="entry-foot">프로토타입 단계 · 모든 화면은 예시 데이터로 동작하며 DB에 저장되지 않습니다.</p>
      </div>
    </main>
  );
}
