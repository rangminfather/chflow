// 실시간 예배 시간표 → 라이브가 어느 예배인지 판별.
//
// 실제 일정 (KST):
//   주일 2부 09:00 / 3부 11:00 / 4부 13:40 / 젊은이예배 13:40
//   수요일 1부 10:00 / 2부 19:30
//
// 방송이 정시에 딱 시작되지 않으므로 각 예배의 "구간"으로 판별한다. 구간 경계는
// 인접 예배 시각의 중간값을 쓰되, 앞뒤로 준비 시간을 여유 있게 둔다.
// 어느 구간에도 안 들어가면 회차 없이 일반 문구를 쓴다.

export type WorshipSession = {
  /** 안정적인 식별자 (로그·통계용) */
  key: string;
  /** 사용자에게 보여줄 이름 — 예: "주일 3부 예배" */
  label: string;
};

/** UTC 기준 Date 를 KST 의 요일·분 단위 시각으로 변환 */
function toKst(date: Date): { day: number; minutes: number } {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    day: kst.getUTCDay(), // 0=일 … 3=수 … 6=토
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

const HM = (h: number, m = 0) => h * 60 + m;

type Window = { key: string; label: string; day: number; from: number; to: number };

// 구간은 위에서부터 먼저 맞는 것을 쓴다.
const WINDOWS: Window[] = [
  // 주일 2부 09:00 — 3부와의 중간 10:00 까지
  { key: "sun_2", label: "주일 2부 예배", day: 0, from: HM(7, 30), to: HM(10, 0) },
  // 주일 3부 11:00 — 4부와의 중간 12:15 까지
  { key: "sun_3", label: "주일 3부 예배", day: 0, from: HM(10, 0), to: HM(12, 15) },
  // 주일 4부 13:40 / 젊은이예배 13:40
  { key: "sun_4", label: "주일 4부 예배", day: 0, from: HM(12, 15), to: HM(15, 30) },
  // 수요일 1부 오전 10:00
  { key: "wed_am", label: "수요일 1부 예배", day: 3, from: HM(8, 0), to: HM(12, 0) },
  // 수요일 2부 오후 7:30
  { key: "wed_pm", label: "수요일 2부 예배", day: 3, from: HM(17, 0), to: HM(22, 0) },
];

/**
 * 방송 시작 시각으로 예배 회차를 판별한다.
 * 시간표에 없는 시각이면 null — 이때는 회차 없이 "실시간 예배" 같은 일반 문구를 쓴다.
 */
export function detectWorshipSession(at: Date = new Date()): WorshipSession | null {
  const { day, minutes } = toKst(at);
  const hit = WINDOWS.find((w) => w.day === day && minutes >= w.from && minutes < w.to);
  return hit ? { key: hit.key, label: hit.label } : null;
}

/** 알림 제목 — 회차를 알면 "주일 3부 예배가 시작되었습니다" */
export function worshipStartedTitle(at: Date = new Date()): string {
  const s = detectWorshipSession(at);
  return s ? `${s.label}가 시작되었습니다` : "실시간 예배가 시작되었습니다";
}

/** 화면 상단 표시용 — 회차를 모르면 "실시간 예배" */
export function worshipNowLabel(at: Date = new Date()): string {
  return detectWorshipSession(at)?.label ?? "실시간 예배";
}

/** 예배 메뉴에 표시할 전체 예배 일정. */
export type WorshipGuideItem = {
  label?: string;
  time: string;
  note?: string;
  live?: boolean;
};

/** 예배 메뉴에서 보여줄 전체 예배 일정. live가 true인 항목만 생방송 배지를 표시한다. */
export const WORSHIP_GUIDE_TEXT: Array<{
  when: string;
  items: WorshipGuideItem[];
}> = [
  {
    when: "새벽기도회",
    items: [
      { label: "1부", time: "오전 5:00" },
      { label: "2부", time: "오전 6:00" },
    ],
  },
  {
    when: "주일예배",
    items: [
      { label: "1부", time: "오전 7:00" },
      { label: "2부", time: "오전 9:00", live: true },
      { label: "3부", time: "오전 11:00", live: true },
      { label: "4부", time: "오후 1:40", note: "젊은이예배", live: true },
      { label: "오후", time: "오후 1:40", note: "온세대연합 오후찬양예배" },
    ],
  },
  {
    when: "수요예배",
    items: [
      { label: "1부", time: "오전 10:00", live: true },
      { label: "2부", time: "오후 7:30", live: true },
    ],
  },
  {
    when: "금요기도회",
    items: [{ time: "오후 11:00" }],
  },
];

/** 관리자 화면에서 사용하는 실시간 중계 예배 일정. */
export const WORSHIP_SCHEDULE_TEXT = [
  { when: "주일", items: ["2부 오전 9:00", "3부 오전 11:00", "4부 오후 1:40", "젊은이예배 오후 1:40"] },
  { when: "수요일", items: ["1부 오전 10:00", "2부 오후 7:30"] },
];
