/* 한국 시간(KST) 기준 "오늘"과 이번 주·다음 주 계산.
   값은 호출할 때마다 새로 계산한다(탭을 열어 둔 채 날짜가 바뀌어도 다음 렌더링에서 따라간다).
   '이번 주' = 오늘이 속한 월~일, '다음 주' = 그 다음 주 */
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const pad = (n) => String(n).padStart(2, '0');
const addDays = (date, n) => new Date(date.getTime() + n * 86400e3);
const md = (date) => `${date.getUTCMonth() + 1}.${pad(date.getUTCDate())}`;
const ymd = (date) => date.toISOString().slice(0, 10);

export function getCalendar() {
  // 한국 시간으로 옮긴 시각의 UTC 필드를 KST 값으로 읽는다(브라우저 시간대와 무관)
  const kstNow = new Date(Date.now() + 9 * 3600e3);
  const dayIdx = (kstNow.getUTCDay() + 6) % 7;
  const monday = (offset) => new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - dayIdx + offset * 7));
  const dates = (start) => Array.from({ length: 7 }, (_, i) => md(addDays(start, i)));
  const thisMon = monday(0);
  const nextMon = monday(1);
  return {
    TODAY: { label: `${md(kstNow)}(${WEEKDAYS[dayIdx]})`, dayIndex: dayIdx, time: `${pad(kstNow.getUTCHours())}:${pad(kstNow.getUTCMinutes())}` },
    THIS_DATES: dates(thisMon),
    NEXT_DATES: dates(nextMon),
    NEXT_RANGE: `${md(nextMon)}(월) – ${md(addDays(nextMon, 6))}(일)`,
    THIS_WEEK_START: ymd(thisMon), // work_schedule.target_week 형식(주 시작 월요일)
    NEXT_WEEK_START: ymd(nextMon),
  };
}
