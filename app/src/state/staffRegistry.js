/* 화면 직원 목록 레지스트리 — DB 에서 읽은 직원으로만 채운다.
   화면 전체가 같은 객체를 읽으므로 STAFF·staffById·staffByDbId 는 제자리에서 채우고 비운다. */
export const STAFF = [];
export const staffById = {};
export const staffByDbId = {};

export const clearStaffRegistry = () => {
  STAFF.length = 0;
  Object.keys(staffById).forEach((k) => delete staffById[k]);
  Object.keys(staffByDbId).forEach((k) => delete staffByDbId[k]);
};

// DB 에서 읽은 직원 중 목록에 없는 직원을 추가한다. 새로 추가했으면 true.
export function registerStaff(rows) {
  let added = false;
  (rows ?? []).forEach((r) => {
    if (!r?.name || staffByDbId[r.user_id]) return;
    const s = { id: `d${r.user_id}`, userId: r.user_id, dbId: r.user_id, name: r.name, role: r.role, wage: Number(r.hourly_wage ?? 0),
      maxHours: Number(r.max_weekly_hours ?? 0), status: r.status ?? '활성', phone: '', avail: {} };
    STAFF.push(s); staffById[s.id] = s; staffByDbId[s.dbId] = s; added = true;
  });
  return added;
}
